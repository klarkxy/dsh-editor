import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { checkLatest } from '../src/update-checker.js'
import { presentUpdateCheck, UpdateOfferStore } from '../src/update-session.js'

const mocks = vi.hoisted(() => ({
  temp: '', quit: vi.fn(), showItemInFolder: vi.fn(), openPath: vi.fn(), launch: vi.fn(), rm: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.temp, quit: mocks.quit, isPackaged: true },
  shell: { showItemInFolder: mocks.showItemInFolder, openPath: mocks.openPath },
}))
vi.mock('../src/update-install.js', () => ({ launchWindowsUpdate: mocks.launch }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rm: mocks.rm.mockImplementation(actual.rm) }
})
import { cancelUpdateDownload, downloadUpdate, getDownloadedUpdate, installUpdate, openUpdateFolder, revealDownloadedUpdate } from '../src/update-download.js'

const bytes = Buffer.from('verified latest release payload')
const digest = createHash('sha256').update(bytes).digest('hex')
const name = 'DSH-Editor-Setup-0.3.6-win-x64.exe'
const id = `v0.3.6:${name}`
const url = `https://github.com/klarkxy/dsh-editor/releases/download/v0.3.6/${name}`
const sender = { isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
let store: UpdateOfferStore
let fetchMock: ReturnType<typeof vi.fn>
let realRm: typeof rm
const originalPlatform = process.platform

beforeEach(async () => {
  mocks.temp = await mkdtemp(join(tmpdir(), 'dsh-update-test-'))
  realRm = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm
  mocks.rm.mockReset().mockImplementation(realRm)
  mocks.quit.mockReset()
  mocks.showItemInFolder.mockReset()
  mocks.openPath.mockReset().mockResolvedValue('')
  mocks.launch.mockReset().mockImplementation(async () => ({
    directory: 'helper', commit: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), finished: Promise.resolve(),
  }))
  vi.mocked(sender.send).mockClear()
  vi.stubEnv('DSH_UPDATE_MIRRORS', '')
  vi.stubEnv('PORTABLE_EXECUTABLE_FILE', '')
  fetchMock = vi.fn(async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }))
  vi.stubGlobal('fetch', fetchMock)
  store = new UpdateOfferStore()
  store.replaceOffer({ id, tag: 'v0.3.6', version: '0.3.6', asset: { name, url, size: bytes.length, digest } })
})
afterEach(async () => {
  cancelUpdateDownload()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await realRm(mocks.temp, { recursive: true, force: true })
})

describe('update download and install lifecycle', () => {
  it('updates 0.3.1 directly to the latest release with its verified installer', async () => {
    const result = await checkLatest('0.3.1', async () => ({ status: 200, json: async () => ({
      tag_name: 'v0.3.6', assets: [{ name, browser_download_url: url, size: bytes.length, digest: `sha256:${digest}` }],
    }) }))
    const offered = await presentUpdateCheck(result, { platform: 'win32', portable: false, store })
    expect(offered.status).toBe('update-available')
    expect(offered.latest?.version).toBe('0.3.6')
    const downloaded = await downloadUpdate(offered.latest!.asset!.id, sender, store)
    expect(await readFile(store.requireDownload(id).path)).toEqual(bytes)
    expect(downloaded.filePath).toBe(store.requireDownload(id).path)
    expect(fetchMock.mock.calls[0][0]).toContain('/v0.3.6/')
  })
  it('never deletes an old locked installer and uses a new path for retries', async () => {
    const root = join(mocks.temp, 'dsh-editor-update')
    await mkdir(root)
    const old = join(root, name)
    await writeFile(old, 'old locked installer')
    mocks.rm.mockImplementation(async (path, options) => {
      if (path === old) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return realRm(path, options)
    })
    await downloadUpdate(id, sender, store)
    const first = store.requireDownload(id).path
    await downloadUpdate(id, sender, store)
    expect(store.requireDownload(id).path).not.toBe(first)
    expect(await readFile(old, 'utf8')).toBe('old locked installer')
    expect(mocks.rm).not.toHaveBeenCalledWith(old, expect.anything())
  })
  it('continues to another source even when a failed partial file cannot be removed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('corrupt'))
    mocks.rm.mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
    await downloadUpdate(id, sender, store)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await readFile(store.requireDownload(id).path)).toEqual(bytes)
  })
  it('keeps integrity failures as the reported error when cleanup is locked', async () => {
    fetchMock.mockImplementation(async () => new Response(Buffer.alloc(bytes.length)))
    mocks.rm.mockRejectedValue(new Error('EBUSY'))
    await expect(downloadUpdate(id, sender, store)).rejects.toThrow('SHA-256')
    expect(store.downloaded).toBeNull()
    expect(mocks.launch).not.toHaveBeenCalled()
  })
  it('cancels a pending response and permits a fresh retry', async () => {
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = downloadUpdate(id, sender, store)
    const rejected = expect(pending).rejects.toThrow('下载已取消')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await expect(downloadUpdate(id, sender, store)).rejects.toThrow('已有更新操作')
    await expect(installUpdate(id, store)).rejects.toThrow('已有更新操作')
    cancelUpdateDownload()
    await rejected
    expect(store.downloaded).toBeNull()
    await downloadUpdate(id, sender, store)
    expect(store.downloaded).not.toBeNull()
  })
  it('falls back when a source stalls before responding', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = downloadUpdate(id, sender, store)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(30_000)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.downloaded).not.toBeNull()
  })
  it('cancels while reading a response body and does not record a partial file', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 5)) },
    })))
    const pending = downloadUpdate(id, sender, store)
    const rejected = expect(pending).rejects.toThrow('下载已取消')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    cancelUpdateDownload()
    await rejected
    expect(store.downloaded).toBeNull()
  })
  it('reports helper launch failure without quitting and permits retry', async () => {
    await downloadUpdate(id, sender, store)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    mocks.launch.mockRejectedValueOnce(new Error('EACCES'))
    await expect(installUpdate(id, store)).rejects.toThrow('EACCES')
    expect(mocks.quit).not.toHaveBeenCalled()
    await expect(installUpdate(id, store)).resolves.toBe('restarting')
    expect(mocks.launch).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'setup', source: store.requireDownload(id).path, target: process.execPath, digest,
    }))
    expect(mocks.quit).toHaveBeenCalledOnce()
  })
  it('waits for helper readiness and commit before quitting', async () => {
    await downloadUpdate(id, sender, store)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const commit = vi.fn().mockResolvedValue(undefined)
    let ready!: (helper: object) => void
    mocks.launch.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve }))
    const pending = installUpdate(id, store)
    await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledOnce())
    expect(mocks.quit).not.toHaveBeenCalled()
    ready({ commit, cancel: vi.fn(), finished: Promise.resolve() })
    await pending
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.quit.mock.invocationCallOrder[0]!)
  })
  it('does not quit if the helper dies before commit', async () => {
    await downloadUpdate(id, sender, store)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const cancel = vi.fn().mockResolvedValue(undefined)
    mocks.launch.mockResolvedValueOnce({ commit: vi.fn().mockRejectedValue(new Error('helper exited')), cancel, finished: Promise.resolve() })
    await expect(installUpdate(id, store)).rejects.toThrow('helper exited')
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.quit).not.toHaveBeenCalled()
  })
  // Actual Windows command-line quoting (including raw NSIS /D), replacement
  // and rollback are tested with real child processes in windows-update-helper.spec.ts.
  it('re-verifies the downloaded bytes before any installer is launched', async () => {
    await downloadUpdate(id, sender, store)
    await writeFile(store.requireDownload(id).path, Buffer.alloc(bytes.length))
    await expect(installUpdate(id, store)).rejects.toThrow('SHA-256')
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })
  it('rejects oversized bodies even when Content-Length is absent', async () => {
    fetchMock.mockImplementation(async () => new Response(Buffer.alloc(bytes.length + 1)))
    await expect(downloadUpdate(id, sender, store)).rejects.toThrow('超过发布记录')
    expect(store.downloaded).toBeNull()
  })
  it('keeps a previous verified package when another download fails', async () => {
    await downloadUpdate(id, sender, store)
    const first = store.requireDownload(id).path
    fetchMock.mockImplementation(async () => new Response(Buffer.alloc(bytes.length)))
    await expect(downloadUpdate(id, sender, store)).rejects.toThrow('SHA-256')
    expect(store.requireDownload(id).path).toBe(first)
    expect(await readFile(first)).toEqual(bytes)
  })
  it('restores an existing package into a new session only after re-verification', async () => {
    const downloaded = await downloadUpdate(id, sender, store)
    const restored = new UpdateOfferStore()
    restored.replaceOffer(store.offer)
    await expect(getDownloadedUpdate(id, restored)).resolves.toEqual(downloaded)
    await writeFile(downloaded.filePath, 'corrupted')
    await expect(getDownloadedUpdate(id, restored)).resolves.toBeNull()
    expect(restored.downloaded).toBeNull()
  })
  it('reveals the verified package and opens the recovery folder without a caller-supplied path', async () => {
    const downloaded = await downloadUpdate(id, sender, store)
    await revealDownloadedUpdate(id, store)
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(downloaded.filePath)
    await openUpdateFolder()
    expect(mocks.openPath).toHaveBeenCalledWith(join(mocks.temp, 'dsh-editor-update'))
    await expect(revealDownloadedUpdate('untrusted-id', store)).rejects.toThrow('已验证更新')
  })
  it('keeps macOS installation manual and never quits the editor', async () => {
    await downloadUpdate(id, sender, store)
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    await expect(installUpdate(id, store)).resolves.toBe('revealed')
    await expect(installUpdate(id, store)).resolves.toBe('revealed')
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
  })
})
