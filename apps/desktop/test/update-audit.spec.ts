import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { assetMatchesRelease, isSafeAssetFileName, isTrustedReleaseAssetUrl, selectAsset } from '../src/release-artifacts.js'
import { buildDownloadCandidates, checkLatest, compareVersions, parseSha256Sums } from '../src/update-checker.js'
import { digestsEqual, presentUpdateCheck, UpdateOfferStore } from '../src/update-session.js'

const name = 'DSH-Editor-Setup-0.3.6-win-x64.exe'
const url = `https://github.com/klarkxy/dsh-editor/releases/download/v0.3.6/${name}`
const asset = { name, url, size: 10, digest: 'a'.repeat(64) }
const offer = { id: `v0.3.6:${name}`, version: '0.3.6', tag: 'v0.3.6', asset }

describe('release and update audit regressions', () => {
  it('compares prereleases numerically, with a stable release above its candidates', () => {
    assert.equal(compareVersions('0.3.6-rc.2', '0.3.6-rc.10'), -1)
    assert.equal(compareVersions('0.3.6-rc.2', '0.3.6'), -1)
    assert.equal(compareVersions('0.3.7', '0.3.6'), 1)
    assert.equal(compareVersions('0.3.6+build.1', '0.3.6+build.2'), 0)
  })
  it('does not call malformed, draft or prerelease metadata an available stable update', async () => {
    for (const metadata of [{ tag_name: 'v0.3.7oops' }, { tag_name: 'v0.3.7', draft: true }, { tag_name: 'v0.3.7-rc.1', prerelease: true }]) {
      const result = await checkLatest('0.3.6', async () => ({ status: 200, json: async () => metadata }))
      assert.equal(result.status, 'error')
    }
  })
  it('uses only the canonical release page instead of server-supplied external links', async () => {
    const result = await checkLatest('0.3.5', async () => ({ status: 200, json: async () => ({ tag_name: 'v0.3.6', html_url: 'https://evil.example' }) }))
    assert.equal(result.latest?.url, 'https://github.com/klarkxy/dsh-editor/releases/tag/v0.3.6')
  })
  it('rejects unsafe Windows filenames and product/architecture mismatches', () => {
    for (const file of ['CON.exe', 'nul', 'lpt1.txt', 'trailing.', 'foo\n.exe', '../a.exe', 'a\\b.exe']) assert.equal(isSafeAssetFileName(file), false)
    assert.equal(selectAsset([{ name: 'Other-Setup-0.3.6-win-x64.exe' }], 'win32', false), null)
    assert.equal(selectAsset([asset], 'win32', false, 'arm64'), null)
    assert.equal(selectAsset([{ name: 'DSH-Editor-0.3.6-mac-arm64.dmg' }], 'darwin', false, 'x64'), null)
  })
  it('rejects query/hash, encoded separators and a different release tag or basename', () => {
    assert.equal(isTrustedReleaseAssetUrl(url), true)
    for (const bad of [url + '?download=1', url + '#x', url.replace(name, '%2e%2e%2Fevil.exe'), url.replace('github.com', 'github.com.evil.example')]) assert.equal(isTrustedReleaseAssetUrl(bad), false)
    assert.equal(assetMatchesRelease(url, 'v0.3.5', name), false)
    assert.equal(assetMatchesRelease(url, 'v0.3.6', 'other.exe'), false)
  })
  it('deduplicates mirrors and ignores insecure or credential-bearing optional prefixes', () => {
    const candidates = buildDownloadCandidates(url, 'http://unsafe.example,https://u:p@private.example,https://ghproxy.net/,https://ghproxy.net')
    assert.equal(candidates.filter((candidate) => candidate.label === 'ghproxy.net').length, 1)
    assert.equal(candidates.some((candidate) => candidate.url.includes('unsafe.example') || candidate.url.includes('private.example')), false)
    assert.equal(candidates.at(-1)?.url, url)
  })
  it('rejects conflicting checksums and non-hex digests', () => {
    assert.equal(parseSha256Sums(`${'a'.repeat(64)}  ${name}\n${'b'.repeat(64)}  ${name}`).has(name), false)
    assert.equal(digestsEqual('a'.repeat(60) + 'xxxx', 'a'.repeat(60) + 'xxxx'), false)
    assert.equal(digestsEqual('a'.repeat(64), 'A'.repeat(64)), true)
  })
  it('invalidates a receipt when the same named release asset is replaced', () => {
    for (const patch of [{ digest: 'b'.repeat(64) }, { size: 11 }, { url: url + '?other' }]) {
      const store = new UpdateOfferStore()
      store.replaceOffer(offer)
      store.recordDownload({ id: offer.id, path: '/cache/file.exe', name, digest: asset.digest })
      store.replaceOffer({ ...offer, asset: { ...asset, ...patch } })
      assert.equal(store.downloaded, null)
    }
  })
  it('retains a verified download on a transient check failure', async () => {
    const store = new UpdateOfferStore()
    store.replaceOffer(offer)
    store.recordDownload({ id: offer.id, path: '/cache/file.exe', name, digest: asset.digest })
    const result = await presentUpdateCheck({ status: 'error', currentVersion: '0.3.5', error: 'offline' }, { platform: 'win32', portable: false, store })
    assert.equal(result.status, 'error')
    assert.equal(store.requireDownload(offer.id).digest, asset.digest)
  })
  it('does not offer a validly hashed asset from the wrong release version', async () => {
    const store = new UpdateOfferStore()
    const result = await presentUpdateCheck({ status: 'update-available', currentVersion: '0.3.5', latest: {
      version: '0.3.7', tag: 'v0.3.7', name: '', publishedAt: '', url: '', body: '', assets: [asset],
    } }, { platform: 'win32', portable: false, store })
    assert.equal(result.latest?.asset, null)
  })
})
