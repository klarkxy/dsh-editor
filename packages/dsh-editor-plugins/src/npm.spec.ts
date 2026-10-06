import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handlePluginsRpc } from './index.ts'
import { resolvePluginPaths } from './paths.ts'
import { isExactNpmVersion, parseNpmSpec, registryTarballUrl, resolveNpmArtifact } from './npm.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const signal = () => new AbortController().signal
const name = '@acme/dsh-example'
const spec = parseNpmSpec(`npm:${name}`)!
const data = Buffer.alloc(128, 42)
const integrity = 'sha512-' + createHash('sha512').update(data).digest('base64')
const metadata = { name, version: '1.2.3', dist: { tarball: 'https://registry.npmjs.org/@acme/dsh-example/-/dsh-example-1.2.3.tgz', integrity } }
const host = { entries: () => [], update: async () => {} }

async function root() { const dir = await mkdtemp(join(tmpdir(), 'dsh-npm-')); roots.push(dir); return dir }
function fetchArtifact(replacement = metadata, bytes = data) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    return String(url) === replacement.dist.tarball ? new Response(bytes) : Response.json(replacement)
  }) as unknown as typeof fetch
}

describe('npm package inputs and registry contract', () => {
  it('accepts explicit npm names and bare scoped names with exact versions', () => {
    expect(spec).toEqual({ name, version: undefined, spec: `npm:${name}` })
    expect(parseNpmSpec(`${name}@1.2.3-rc.2+build.4`)).toMatchObject({ version: '1.2.3-rc.2+build.4' })
    expect(parseNpmSpec('npm:dsh-example@1.0.0')).toMatchObject({ name: 'dsh-example', version: '1.0.0' })
    expect(parseNpmSpec('dsh-example')).toBeUndefined()
  })
  it.each(['npm:', 'npm:../evil', 'npm:@acme/../evil', 'npm:@acme/name/extra', 'npm:@Acme/name', 'npm:name@', 'npm:name@latest', 'npm:name@^1.2.3', 'npm:name@1.2', 'npm:name@01.2.3', 'npm:name@1.2.3-01', 'npm:name@1.2.3;echo', 'npm:node_modules', 'npm:https://evil.test/a.tgz', '@acme/name#main'])('rejects malformed spec %s', value => {
    expect(parseNpmSpec(value)).toBeUndefined()
  })
  it('rejects unsafe metadata URLs and invalid exact versions', () => {
    for (const url of ['http://registry.npmjs.org/a.tgz', 'https://evil.test/a.tgz', 'https://registry.npmjs.org.evil.test/a.tgz', 'https://user:secret@registry.npmjs.org/a.tgz', 'https://registry.npmjs.org:8443/a.tgz', 'https://registry.npmjs.org/a.tgz?token=a', 'https://registry.npmjs.org/a.tgz#x', 'not-a-url']) expect(registryTarballUrl(url)).toBeUndefined()
    expect(isExactNpmVersion('1.2.3-beta.0')).toBe(true)
    expect(isExactNpmVersion('1.2.3-beta.00')).toBe(false)
    expect(isExactNpmVersion('1.2.3+')).toBe(false)
  })
  it('resolves latest once and validates exact metadata identity and SHA-512', async () => {
    const ioFetch = fetchArtifact()
    expect(await resolveNpmArtifact(spec, signal(), ioFetch)).toMatchObject({ name, version: '1.2.3', spec: `npm:${name}@1.2.3`, integrity })
    expect(String((ioFetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toBe('https://registry.npmjs.org/%40acme%2Fdsh-example/latest')
    for (const replacement of [{ ...metadata, name: 'other' }, { ...metadata, version: '2.0.0' }, { ...metadata, dist: { ...metadata.dist, integrity: 'sha1-abc' } }, { ...metadata, dist: { ...metadata.dist, tarball: 'https://evil.test/a.tgz' } }]) {
      await expect(resolveNpmArtifact(parseNpmSpec(`${name}@1.2.3`)!, signal(), fetchArtifact(replacement))).rejects.toThrow(/npm/)
    }
  })
  it('discovers npm directly without changing keyword search', async () => {
    const paths = resolvePluginPaths({ DSH_HOME: await root() }, [])
    const ioFetch = vi.fn()
    expect(await handlePluginsRpc('marketplace.search', { query: `${name}@1.2.3` }, signal(), { paths, loader: host, fetch: ioFetch })).toMatchObject({ ok: true, value: { listings: [{ source: 'npm', spec: `npm:${name}@1.2.3`, url: `https://www.npmjs.com/package/${name}` }] } })
    expect(ioFetch).not.toHaveBeenCalled()
    expect(await handlePluginsRpc('marketplace.inspect', { spec: 'npm:name@latest' }, signal(), { paths, loader: host, fetch: ioFetch })).toMatchObject({ ok: false, error: { message: '不支持的插件操作' } })
  })
})
