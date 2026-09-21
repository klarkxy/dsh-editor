import { describe, expect, it, vi } from 'vitest'
import { packageContentHash, planPackage, publishAndConfirm, orderReleaseTargets } from './npm-release-policy.mjs'
const name = '@klarkxy/dsh-zhihu'
const manifest = { name, version: '0.1.0', dependencies: { zod: '^4.1.5' } }
const entries = (pkg = manifest, code = 'export const ok = true') => new Map([
  ['package/package.json', JSON.stringify(pkg)], ['package/lib/index.js', code], ['package/README.md', 'Install this plugin'],
])
const registry = (version = '0.1.0', contentHash = 'old', versions = {}) => ({
  'dist-tags': { latest: version }, versions: { ...versions, [version]: { name, version, dshRelease: { contentHash } } },
})

describe('npm release content identity and versions', () => {
  it('first publication uses the checked-in version', () => {
    expect(planPackage(manifest, null, 'new')).toMatchObject({ action: 'publish', version: '0.1.0' })
  })
  it('ignores only generated release fields, retaining packed dependency and API changes', () => {
    const hash = packageContentHash(entries())
    expect(packageContentHash(entries({ ...manifest, version: '0.1.3', gitHead: 'new-sha', dshRelease: { contentHash: hash } }))).toBe(hash)
    expect(packageContentHash(entries({ ...manifest, dependencies: { zod: '^4.2.0' } }))).not.toBe(hash)
    expect(packageContentHash(entries({ ...manifest, exports: { '.': './other.js' } }))).not.toBe(hash)
    expect(packageContentHash(entries({ ...manifest, devDependencies: { typescript: '5.9.3' } }))).not.toBe(hash)
    expect(packageContentHash(entries(manifest, 'export const ok = false'))).not.toBe(hash)
  })
  it('is insensitive to tar ordering and JSON property ordering', () => {
    expect(packageContentHash(new Map([...entries()].reverse()))).toBe(packageContentHash(entries()))
    expect(packageContentHash(entries({ dependencies: manifest.dependencies, version: manifest.version, name }))).toBe(packageContentHash(entries()))
  })
  it('skips unchanged artifacts and recovers missing version writeback without publishing', () => {
    const hash = packageContentHash(entries())
    expect(planPackage(manifest, registry('0.1.4', hash), hash)).toMatchObject({ action: 'skip', version: '0.1.4' })
    expect(planPackage({ ...manifest, version: '0.1.4', dshRelease: { contentHash: hash } }, registry('0.1.4', hash), hash).action).toBe('skip')
  })
  it('increments independently for changed packages, even if the source version is stale', () => {
    expect(planPackage(manifest, registry('0.1.9'), 'new').version).toBe('0.1.10')
    expect(planPackage(manifest, registry('0.1.9', 'same'), 'same').action).toBe('skip')
  })
  it('avoids versions already published under other tags and always increments patch', () => {
    expect(planPackage(manifest, registry('0.1.9', 'old', { '0.1.12': {} }), 'new').version).toBe('0.1.13')
    expect(planPackage({ ...manifest, version: '0.2.0' }, registry(), 'new').version).toBe('0.1.1')
  })
  it('fails closed on malformed registry metadata or prerelease source versions', () => {
    expect(() => planPackage(manifest, { versions: {} }, 'new')).toThrow('Invalid latest')
    expect(() => planPackage({ ...manifest, version: '0.2.0-rc.1' }, null, 'new')).toThrow('stable')
  })
})

describe('npm publication receipt recovery', () => {
  const expected = { name, version: '0.1.0', integrity: 'sha512-exact', contentHash: 'sha256-content' }
  const remote = { name, version: '0.1.0', dist: { integrity: expected.integrity }, dshRelease: { contentHash: expected.contentHash } }
  const io = (options = {}) => ({ publish: vi.fn(), readVersion: vi.fn().mockResolvedValue(remote), wait: vi.fn(), ...options })
  it('confirms a normal publish with registry integrity', async () => {
    const calls = io()
    await expect(publishAndConfirm(expected, calls)).resolves.toEqual({ recovered: false })
    expect(calls.publish).toHaveBeenCalledTimes(1)
  })
  it('recovers an accepted PUT whose CLI response failed, without publishing twice', async () => {
    const calls = io({ publish: vi.fn().mockRejectedValue(new Error('connection lost')) })
    await expect(publishAndConfirm(expected, calls)).resolves.toEqual({ recovered: true })
    expect(calls.publish).toHaveBeenCalledTimes(1)
  })
  it('waits for registry propagation and rejects mismatched or unavailable receipts', async () => {
    const calls = io({ readVersion: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(remote) })
    await expect(publishAndConfirm(expected, calls)).resolves.toEqual({ recovered: false })
    expect(calls.wait).toHaveBeenCalledTimes(1)
    for (const readVersion of [vi.fn().mockRejectedValue(new Error('HTTP 503')), vi.fn().mockResolvedValue({ ...remote, dist: { integrity: 'different' } })]) {
      await expect(publishAndConfirm(expected, io({ readVersion }))).rejects.toThrow('unconfirmed')
    }
  })
  it('allows delayed visibility without uploading again', async () => {
    let reads = 0
    const readVersion = vi.fn().mockImplementation(async () => ++reads < 10 ? null : remote)
    const calls = io({ readVersion })
    await expect(publishAndConfirm(expected, calls)).resolves.toEqual({ recovered: false })
    expect(calls.publish).toHaveBeenCalledTimes(1)
    expect(calls.wait.mock.calls.flat()).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000])
  })
  it('keeps independently confirmed package evidence when the other package fails', async () => {
    const results = await Promise.allSettled([
      publishAndConfirm(expected, io()),
      publishAndConfirm({ ...expected, name: '@klarkxy/dsh-web-search-manager' }, io({ readVersion: vi.fn().mockResolvedValue(null) })),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  })
})

describe('discovering future public packages', () => {
  const item = (name, extra = {}) => ({ directory: 'packages/' + name.split('/').at(-1), manifest: { name, version: '0.1.0', publishConfig: { access: 'public' }, ...extra } })
  it('automatically includes newly opted-in scoped packages without publishing other workspace packages', () => {
    const targets = orderReleaseTargets([item('@klarkxy/new-plugin'), item('@klarkxy/private', { private: true }), item('@klarkxy/internal', { publishConfig: undefined }), item('dsh-manuscript'), item('@elsewhere/plugin')])
    expect(targets.map(x => x.name)).toEqual(['@klarkxy/new-plugin'])
  })
  it('orders public runtime dependencies before consumers and reports the blocking edges', () => {
    const targets = orderReleaseTargets([item('@klarkxy/a-plugin', { dependencies: { '@klarkxy/z-core': 'workspace:*' } }), item('@klarkxy/z-core')])
    expect(targets.map(x => x.name)).toEqual(['@klarkxy/z-core', '@klarkxy/a-plugin'])
    expect(targets[1].dependencies).toEqual(['@klarkxy/z-core'])
  })
  it('rejects runtime workspace references to unpublished internal packages before publication', () => {
    expect(() => orderReleaseTargets([item('@klarkxy/a', { dependencies: { 'internal-lib': 'workspace:*' } })])).toThrow('not enabled')
    expect(orderReleaseTargets([item('@klarkxy/a', { devDependencies: { 'internal-lib': 'workspace:*' } })])).toHaveLength(1)
  })
  it('rejects dependency cycles and duplicate npm identities before any publish', () => {
    expect(() => orderReleaseTargets([item('@klarkxy/a', { dependencies: { '@klarkxy/b': 'workspace:*' } }), item('@klarkxy/b', { peerDependencies: { '@klarkxy/a': 'workspace:*' } })])).toThrow('Cyclic')
    expect(() => orderReleaseTargets([item('@klarkxy/a'), item('@klarkxy/a')])).toThrow('Duplicate')
  })
})
