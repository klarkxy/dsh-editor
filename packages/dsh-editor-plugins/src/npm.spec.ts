import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handlePluginsRpc } from './index.ts'
import { resolvePluginPaths } from './paths.ts'
import { isExactNpmVersion, parseNpmSpec } from './npm.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const signal = () => new AbortController().signal
const name = '@acme/dsh-example'
const spec = parseNpmSpec(`npm:${name}`)!

async function root() { const dir = await mkdtemp(join(tmpdir(), 'dsh-npm-')); roots.push(dir); return dir }
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
  it('discovers npm directly without changing keyword search', async () => {
    const paths = resolvePluginPaths({ DSH_HOME: await root() }, [])
    const ioFetch = vi.fn()
    expect(await handlePluginsRpc('marketplace.search', { query: `${name}@1.2.3` }, signal(), { paths, fetch: ioFetch })).toMatchObject({ ok: true, value: { listings: [{ source: 'npm', spec: `npm:${name}@1.2.3`, url: `https://www.npmjs.com/package/${name}` }] } })
    expect(ioFetch).not.toHaveBeenCalled()
    expect(await handlePluginsRpc('marketplace.inspect', { spec: 'npm:name@latest' }, signal(), { paths, fetch: ioFetch })).toMatchObject({ ok: false, error: { message: '不支持的插件操作' } })
  })
})
