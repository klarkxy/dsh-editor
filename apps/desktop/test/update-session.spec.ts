import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertUpdateFileMatches,
  presentUpdateCheck,
  resolveUpdateFilePath,
  UpdateOfferStore,
} from '../src/update-session.js'

const DIGEST = 'a'.repeat(64)
const SETUP = {
  name: 'DSH-Editor-Setup-0.3.0-win-x64.exe',
  url: 'https://github.com/klarkxy/dsh-editor/releases/download/v0.3.0/DSH-Editor-Setup-0.3.0-win-x64.exe',
  size: 12,
  digest: DIGEST,
}
const PORTABLE = {
  name: 'DSH-Editor-0.3.0-win-x64.exe',
  url: 'https://github.com/klarkxy/dsh-editor/releases/download/v0.3.0/DSH-Editor-0.3.0-win-x64.exe',
  size: 8,
  digest: 'b'.repeat(64),
}

function available(assets = [SETUP, PORTABLE]) {
  return {
    status: 'update-available' as const,
    currentVersion: '0.2.0',
    latest: {
      version: '0.3.0',
      tag: 'v0.3.0',
      name: '0.3.0',
      publishedAt: '2026-09-18T00:00:00Z',
      url: 'https://github.com/klarkxy/dsh-editor/releases/tag/v0.3.0',
      body: 'notes',
      assets,
    },
  }
}

describe('update session trust boundary', () => {
  it('exposes only an id/name/size asset when GitHub digest is present', async () => {
    const store = new UpdateOfferStore()
    const publicResult = await presentUpdateCheck(available(), {
      platform: 'win32',
      portable: false,
      store,
    })
    expect(publicResult.latest?.asset).toEqual({
      id: 'v0.3.0:DSH-Editor-Setup-0.3.0-win-x64.exe',
      name: SETUP.name,
      size: SETUP.size,
    })
    expect(JSON.stringify(publicResult)).not.toContain('browser_download_url')
    expect(JSON.stringify(publicResult)).not.toContain(SETUP.url)
    expect(store.requireOffer('v0.3.0:DSH-Editor-Setup-0.3.0-win-x64.exe').asset.url).toBe(SETUP.url)
  })

  it('stops automatic install when the official digest is missing and sums are empty', async () => {
    const store = new UpdateOfferStore()
    const publicResult = await presentUpdateCheck(available([{ ...SETUP, digest: undefined }]), {
      platform: 'win32',
      portable: false,
      store,
      fetchImpl: async () => ({ status: 200, text: async () => '<html>mirror error page</html>' }),
    })
    expect(publicResult.latest?.asset).toBeNull()
    expect(publicResult.latest?.installBlockedReason).toBe('missing-integrity')
    expect(() => store.requireOffer('v0.3.0:DSH-Editor-Setup-0.3.0-win-x64.exe')).toThrow('已验证更新')
  })

  it('can recover a digest from official sha256sums.txt, but not from a non-GitHub URL', async () => {
    const store = new UpdateOfferStore()
    const sums = `${DIGEST}  ${SETUP.name}\n`
    const recovered = await presentUpdateCheck(available([{ ...SETUP, digest: undefined }]), {
      platform: 'win32',
      portable: false,
      store,
      fetchImpl: async () => ({ status: 200, text: async () => sums }),
    })
    expect(recovered.latest?.asset?.id).toBe('v0.3.0:DSH-Editor-Setup-0.3.0-win-x64.exe')
    expect(store.offer?.asset.digest).toBe(DIGEST)

    const rejected = await presentUpdateCheck(
      available([{ ...SETUP, digest: undefined, url: 'https://evil.example/DSH-Editor-Setup-0.3.0-win-x64.exe' }]),
      { platform: 'win32', portable: false, store: new UpdateOfferStore() },
    )
    expect(rejected.latest?.asset).toBeNull()
    expect(rejected.latest?.installBlockedReason).toBe('missing-integrity')
  })

  it('rejects renderer-controlled file names that escape the update directory', () => {
    const dir = join('C:', 'Users', 'me', 'AppData', 'Local', 'Temp', 'dsh-editor-update')
    expect(() => resolveUpdateFilePath(dir, String.raw`..\..\Windows\evil.exe`)).toThrow('非法的更新文件名')
    expect(() => resolveUpdateFilePath(dir, '../evil.exe')).toThrow('非法的更新文件名')
    expect(() => resolveUpdateFilePath(dir, 'DSH-Editor-0.3.0-win-x64.exe')).not.toThrow()
  })

  it('binds download and install to the store id, not to a caller-supplied path', () => {
    const store = new UpdateOfferStore()
    store.replaceOffer({
      id: 'v0.3.0:setup',
      version: '0.3.0',
      tag: 'v0.3.0',
      asset: { ...SETUP, digest: DIGEST },
    })
    expect(() => store.requireOffer('other')).toThrow('已验证更新')
    expect(() => store.requireDownload('v0.3.0:setup')).toThrow('请先下载')
    store.recordDownload({ id: 'v0.3.0:setup', path: 'C:\\temp\\setup.exe', digest: DIGEST, name: SETUP.name })
    expect(store.requireDownload('v0.3.0:setup').path).toBe('C:\\temp\\setup.exe')
    store.replaceOffer({
      id: 'v0.4.0:setup',
      version: '0.4.0',
      tag: 'v0.4.0',
      asset: { ...SETUP, name: 'DSH-Editor-Setup-0.4.0-win-x64.exe', digest: DIGEST },
    })
    expect(() => store.requireDownload('v0.4.0:setup')).toThrow('请先下载')
  })

  it('never skips SHA-256 verification when size happens to match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-update-verify-'))
    const file = join(dir, 'payload.bin')
    await writeFile(file, 'hello world!')
    await expect(assertUpdateFileMatches(file, { size: 12, digest: DIGEST }, {
      sha256: async () => 'c'.repeat(64),
      size: async () => 12,
    })).rejects.toThrow('SHA-256')
    await expect(assertUpdateFileMatches(file, { size: 12, digest: '' }, {
      sha256: async () => DIGEST,
      size: async () => 12,
    })).rejects.toThrow('可信校验')
  })
})
