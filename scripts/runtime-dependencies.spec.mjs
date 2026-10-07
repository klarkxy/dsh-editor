import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { copyRuntimeDependencies } from './runtime-dependencies.mjs'
import { materializeDsh } from './materialize-dsh.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function packageAt(root, name, version, dependencies = {}, fields = {}) {
  const dir = join(root, 'node_modules', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', main: './index.js', dependencies, ...fields }))
  await writeFile(join(dir, 'index.js'), 'export default 42\n')
  return dir
}
async function fixture(dependencies = {}, fields = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-dependencies-'))
  roots.push(root)
  const owner = join(root, 'workspace-feature')
  const runtime = join(root, 'runtime')
  await mkdir(owner, { recursive: true })
  await mkdir(runtime, { recursive: true })
  const manifest = join(owner, 'package.json')
  await writeFile(manifest, JSON.stringify({ name: 'test-owner', version: '1.0.0' }))
  const source = await packageAt(owner, 'declared-provider', '1.2.3', dependencies, fields)
  return { root, owner, runtime, source, declarations: [{ name: 'declared-provider', packageManifest: manifest }] }
}

async function copyFixture(f, mode) {
  if (mode === 'declared') await copyRuntimeDependencies(f.runtime, f.declarations)
  else {
    await writeFile(join(f.owner, 'package.json'), JSON.stringify({ name: 'test-owner', version: '1.0.0', dependencies: { 'declared-provider': '1.2.3' } }))
    await materializeDsh(f.owner, f.runtime)
  }
}

describe('declared copied-runtime dependencies', () => {
  it.each(['declared', 'materialized'])('filters force-installed foreign optional packages and peers in a %s runtime', async mode => {
    const foreignOs = process.platform === 'win32' ? 'darwin' : 'win32'
    const foreignCpu = process.arch === 'arm64' ? 'x64' : 'arm64'
    const foreign = ['foreign-os', 'foreign-cpu', 'denied-target', 'mixed-any', 'optional-override', 'foreign-peer']
    const f = await fixture({ 'neutral-dep': '1.0.0', 'optional-override': '1.0.0' }, {
      optionalDependencies: Object.fromEntries([...foreign.filter(name => name !== 'foreign-peer'), 'target-backend', 'any-platform', 'missing-optional'].map(name => [name, '1.0.0'])),
      peerDependencies: { 'foreign-peer': '1.0.0', 'target-peer': '1.0.0', 'missing-peer': '1.0.0' },
      peerDependenciesMeta: { 'foreign-peer': { optional: true }, 'target-peer': { optional: true }, 'missing-peer': { optional: true } },
    })
    for (const name of foreign) {
      const fields = name === 'foreign-cpu' ? { cpu: [foreignCpu] }
        : name === 'denied-target' ? { os: [process.platform, `!${process.platform}`] }
          : name === 'mixed-any' ? { os: ['any', foreignOs] } : { os: [foreignOs] }
      await packageAt(f.owner, name, '1.0.0', { 'foreign-only-child': '1.0.0' }, fields)
    }
    await packageAt(f.owner, 'foreign-only-child', '1.0.0')
    await packageAt(f.owner, 'neutral-dep', '1.0.0')
    const backend = await packageAt(f.owner, 'target-backend', '1.0.0', { 'native-leaf': '1.0.0' }, { os: process.platform, cpu: [process.arch] })
    await packageAt(f.owner, 'native-leaf', '1.0.0')
    await packageAt(f.owner, 'target-peer', '1.0.0', {}, { os: `!${foreignOs}`, cpu: `!${foreignCpu}` })
    await packageAt(f.owner, 'any-platform', '1.0.0', {}, { os: ['any'], cpu: 'any' })
    await writeFile(join(backend, 'index.js'), "export { default } from 'native-leaf'\n")
    await writeFile(join(f.source, 'index.js'), "import backend from 'target-backend'; import peer from 'target-peer'; import neutral from 'neutral-dep'; export default backend + peer + neutral\n")
    await copyFixture(f, mode)
    for (const name of [...foreign, 'foreign-only-child', 'missing-optional', 'missing-peer']) {
      expect(existsSync(join(f.runtime, 'node_modules', name))).toBe(false)
    }
    for (const name of ['target-backend', 'native-leaf', 'target-peer', 'neutral-dep', 'any-platform']) {
      expect(existsSync(join(f.runtime, 'node_modules', name, 'package.json'))).toBe(true)
    }
    const relocated = await mkdtemp(join(tmpdir(), 'dsh-platform-relocated-'))
    roots.push(relocated)
    await cp(f.runtime, join(relocated, 'runtime'), { recursive: true })
    await rm(f.owner, { recursive: true, force: true })
    const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(relocated, 'runtime', 'node_modules', 'declared-provider', 'index.js')).href)}); if (m.default !== 126) process.exit(2)`
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).not.toThrow()
  })

  it.each(['declared', 'materialized'].flatMap(mode => ['os', 'cpu'].map(field => [mode, field])))('rejects an incompatible required %s runtime dependency declared by %s', async (mode, field) => {
    const foreign = field === 'os' ? (process.platform === 'win32' ? 'darwin' : 'win32') : (process.arch === 'arm64' ? 'x64' : 'arm64')
    const f = await fixture({ 'required-platform': '1.0.0' })
    await packageAt(f.owner, 'required-platform', '1.0.0', {}, { [field]: [foreign] })
    await expect(copyFixture(f, mode)).rejects.toThrow(`required-platform@1.0.0`)
    expect(existsSync(join(f.runtime, 'node_modules', 'required-platform'))).toBe(false)
  })

  it.each(['declared', 'materialized'])('keeps actual required dependencies required despite optional peer metadata in a %s runtime', async mode => {
    const foreignOs = process.platform === 'win32' ? 'darwin' : 'win32'
    const f = await fixture({ 'required-peer': '1.0.0' }, {
      peerDependencies: { 'required-peer': '1.0.0' }, peerDependenciesMeta: { 'required-peer': { optional: true } },
    })
    await packageAt(f.owner, 'required-peer', '1.0.0', {}, { os: [foreignOs] })
    await expect(copyFixture(f, mode)).rejects.toThrow(`is incompatible with ${process.platform}-${process.arch}`)
  })

  it.each(['declared', 'materialized'])('copies npm packages named like Node built-ins in a %s runtime', async mode => {
    const f = await fixture({ punycode: '2.3.1' })
    await packageAt(f.owner, 'punycode', '2.3.1')
    await writeFile(join(f.source, 'index.js'), "export { default } from 'punycode/index.js'\n")
    if (mode === 'declared') await copyRuntimeDependencies(f.runtime, f.declarations)
    else {
      await writeFile(join(f.owner, 'package.json'), JSON.stringify({ name: 'test-owner', version: '1.0.0', dependencies: { 'declared-provider': '1.2.3' } }))
      await materializeDsh(f.owner, f.runtime)
    }
    expect(JSON.parse(await readFile(join(f.runtime, 'node_modules', 'punycode', 'package.json'), 'utf8')).version).toBe('2.3.1')
    const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(f.runtime, 'node_modules', 'declared-provider', 'index.js')).href)}); if (m.default !== 42) process.exit(2)`
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).not.toThrow()
  })

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

  it('fails when a source dependency is missing, and copies a resolvable nested runtime closure', async () => {
    const missing = await fixture({ 'runtime-peer': '^1.0.0' })
    await expect(copyRuntimeDependencies(missing.runtime, missing.declarations)).rejects.toThrow('cannot resolve runtime-peer')

    const f = await fixture({ 'runtime-peer': '^1.0.0' })
    const sourcePkg = JSON.parse(await readFile(join(f.source, 'package.json'), 'utf8'))
    sourcePkg.peerDependencies = { 'optional-peer': '^1.0.0' }
    sourcePkg.peerDependenciesMeta = { 'optional-peer': { optional: true } }
    await writeFile(join(f.source, 'package.json'), JSON.stringify(sourcePkg))
    const peer = await packageAt(f.owner, 'runtime-peer', '1.0.0', { 'nested-token': '^1.0.0' })
    await writeFile(join(peer, 'index.js'), "export { default } from 'nested-token'\n")
    const token = await packageAt(f.owner, 'nested-token', '1.0.0', { 'runtime-peer': '^1.0.0' })
    await writeFile(join(f.source, 'index.js'), "export { default } from 'runtime-peer'\n")
    await mkdir(join(f.source, 'node_modules', 'unrelated'), { recursive: true })
    await copyRuntimeDependencies(f.runtime, f.declarations)
    expect(existsSync(join(f.runtime, 'node_modules', 'runtime-peer', 'package.json'))).toBe(true)
    expect(existsSync(join(f.runtime, 'node_modules', 'nested-token', 'package.json'))).toBe(true)
    expect(existsSync(join(f.runtime, 'node_modules', 'optional-peer'))).toBe(false)
    expect(existsSync(join(f.runtime, 'node_modules', 'declared-provider', 'node_modules'))).toBe(false)
    expect(existsSync(join(f.runtime, 'node_modules', 'runtime-peer', 'node_modules'))).toBe(false)
    expect(existsSync(join(token, 'index.js'))).toBe(true)
    const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(f.runtime, 'node_modules', 'declared-provider', 'index.js')).href)}); if (m.default !== 42) process.exit(2)`
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).not.toThrow()
  })

  it('copies an ancestor-resolved dependency so a relocated runtime still imports after the original tree is gone', async () => {
    const f = await fixture({ 'ancestor-dep': '1.0.0' })
    await writeFile(join(f.source, 'index.js'), "export { default } from 'ancestor-dep'\n")
    await packageAt(f.root, 'ancestor-dep', '1.0.0')
    await copyRuntimeDependencies(f.runtime, f.declarations)
    expect(existsSync(join(f.runtime, 'node_modules', 'ancestor-dep', 'package.json'))).toBe(true)
    const relocated = await mkdtemp(join(tmpdir(), 'dsh-runtime-relocated-'))
    roots.push(relocated)
    await cp(f.runtime, join(relocated, 'runtime'), { recursive: true })
    await rm(f.root, { recursive: true, force: true })
    const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(relocated, 'runtime', 'node_modules', 'declared-provider', 'index.js')).href)}); if (m.default !== 42) process.exit(2)`
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).not.toThrow()
  })

  it('rejects a later owner of the same name at a different version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-conflict-'))
    roots.push(root)
    const first = join(root, 'owner-one')
    const second = join(root, 'owner-two')
    const runtime = join(root, 'runtime')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await mkdir(runtime, { recursive: true })
    const one = join(first, 'package.json')
    const two = join(second, 'package.json')
    await writeFile(one, JSON.stringify({ name: 'one', version: '1.0.0' }))
    await writeFile(two, JSON.stringify({ name: 'two', version: '1.0.0' }))
    await packageAt(first, 'review-shared', '1.0.0')
    await packageAt(second, 'review-shared', '2.0.0')
    await expect(copyRuntimeDependencies(runtime, [
      { name: 'review-shared', packageManifest: one },
      { name: 'review-shared', packageManifest: two },
    ])).rejects.toThrow('bundled runtime dependency conflict')
    expect(JSON.parse(await readFile(join(runtime, 'node_modules', 'review-shared', 'package.json'), 'utf8')).version).toBe('1.0.0')
  })

  it('copies an export-only package whose package.json subpath is hidden and executes the relocated module', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'package.json'), JSON.stringify({
      name: 'declared-provider',
      version: '1.2.3',
      type: 'module',
      exports: { '.': './index.js' },
    }))
    expect(() => createRequire(f.declarations[0].packageManifest).resolve('declared-provider/package.json')).toThrow(
      expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
    )
    await copyRuntimeDependencies(f.runtime, f.declarations)
    const probe = `const m = await import(${JSON.stringify(pathToFileURL(join(f.runtime, 'node_modules', 'declared-provider', 'index.js')).href)}); if (m.default !== 42) process.exit(2)`
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', probe], { stdio: 'pipe' })).not.toThrow()
  })
})
