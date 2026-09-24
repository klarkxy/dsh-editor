import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { copyRuntimeDependencies } from './runtime-dependencies.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function packageAt(root, name, version, dependencies = {}) {
  const dir = join(root, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', main: './index.js', dependencies }))
  await writeFile(join(dir, 'index.js'), 'export default 42\n')
  return dir
}
async function fixture(dependencies = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-dependencies-'))
  roots.push(root)
  const owner = join(root, 'workspace-feature')
  const runtime = join(root, 'runtime')
  await mkdir(owner, { recursive: true })
  await mkdir(runtime, { recursive: true })
  const manifest = join(owner, 'package.json')
  await writeFile(manifest, JSON.stringify({ name: 'test-owner', version: '1.0.0' }))
  const source = await packageAt(owner, 'declared-provider', '1.2.3', dependencies)
  return { root, owner, runtime, source, declarations: [{ name: 'declared-provider', packageManifest: manifest }] }
}

describe('declared copied-runtime dependencies', () => {
  it('makes a copied host plugin importable without its workspace node_modules', async () => {
    const f = await fixture()
    const plugin = await packageAt(f.runtime, 'copied-feature', '1.0.0')
    await writeFile(join(plugin, 'index.js'), "export { default } from 'declared-provider'\n")
    const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(plugin, 'index.js')).href)}); if (m.default !== 42) process.exit(2)`
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).toThrow()
    await mkdir(join(f.source, 'node_modules', 'unrelated'), { recursive: true })
    await writeFile(join(f.source, 'index.js.map'), '{}')
    await copyRuntimeDependencies(f.runtime, f.declarations)
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).not.toThrow()
    expect(existsSync(join(f.runtime, 'node_modules', 'declared-provider', 'node_modules'))).toBe(false)
    expect(existsSync(join(f.runtime, 'node_modules', 'declared-provider', 'index.js.map'))).toBe(false)
    await copyRuntimeDependencies(f.runtime, f.declarations)
  })

  it('rejects a conflicting installed identity without replacing its files', async () => {
    const f = await fixture()
    const installed = await packageAt(f.runtime, 'declared-provider', '9.0.0')
    await writeFile(join(installed, 'index.js'), 'preserved')
    await expect(copyRuntimeDependencies(f.runtime, f.declarations)).rejects.toThrow('bundled runtime dependency conflict')
    expect(await readFile(join(installed, 'index.js'), 'utf8')).toBe('preserved')
  })

  it('fails when a provider dependency is missing from the runtime closure', async () => {
    const f = await fixture({ 'runtime-peer': '^1.0.0' })
    await expect(copyRuntimeDependencies(f.runtime, f.declarations)).rejects.toThrow('cannot resolve runtime-peer')
    await packageAt(f.runtime, 'runtime-peer', '1.0.0')
    await expect(copyRuntimeDependencies(f.runtime, f.declarations)).resolves.toBeUndefined()
  })
})
