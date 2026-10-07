import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { protectCorePluginManager } from './core-lock.ts'
import { handlePluginsRpc } from './index.ts'
import { adaptNativeToolProjection, readNativeToolState, type NativeToolManager } from './native-tools.ts'
import { resolvePluginPaths } from './paths.ts'
import { defaultPersistIo, runQueuedSorted } from './persist.ts'
import { presetDeclarationFile, syncPresetDeclarations } from './preset-config.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const research = '@acme/research'
const other = '@acme/other'
const signal = () => new AbortController().signal
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(selected = true) {
  const home = await mkdtemp(join(tmpdir(), 'editor-native-tools-'))
  roots.push(home)
  const paths = resolvePluginPaths({ DSH_HOME: home }, [])
  const file = presetDeclarationFile(paths.profileDir)
  const events: string[] = []
  const choice = new Map([[research, true], [other, true]])
  const author = '\uFEFF# author formatting\r\n- id: author-own\r\n  disabled: true\r\n'
  await mkdir(paths.profileDir, { recursive: true })
  await writeFile(paths.patchFile, author)
  await writeFile(paths.stateFile, '{"schema":1,"presets":{"author-mode":false},"authorField":42}\n')
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages', 'research.json'), 'author data\r\n')
  const preset = join(home, '.agent-presets', 'author')
  await mkdir(preset, { recursive: true })
  await writeFile(join(preset, 'preset.yml'), 'name: 作者模式\n')
  await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
  for (const [name, id] of [[research, 'research'], [other, 'other']]) {
    const dir = join(paths.profileDir, 'node_modules', name)
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'lib', 'tools.js'), 'export const name = "tools"\n')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, exports: { './tools': './lib/tools.js' }, dshEditor: {
      entries: [{ id }], inserts: [{ id: `${id}-tools`, name: `${name}/tools`, requires: [id] }],
    } }))
  }
  const initial = { name: 'profile', authorField: { keep: true }, dependencies: { ...(selected ? { [research]: '1' } : {}), [other]: '1' }, dsh: { profile: { bundles: [...(selected ? [research] : []), other] } } }
  await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify(initial))
  const manifest = async () => JSON.parse(await readFile(join(paths.profileDir, 'package.json'), 'utf8'))
  async function select(name: string, enabled: boolean, installed?: boolean) {
    const row = await manifest()
    row.dsh.profile.bundles = row.dsh.profile.bundles.filter((item: string) => item !== name)
    if (enabled) row.dsh.profile.bundles.push(name)
    if (installed === true) row.dependencies[name] = '1'
    if (installed === false) delete row.dependencies[name]
    await writeFile(join(paths.profileDir, 'package.json'), JSON.stringify(row))
  }
  const tools = async () => JSON.parse(await readFile(file, 'utf8'))[0].insert.filter((row: { name: string }) => row.name.endsWith('/tools')).map((row: { id: string }) => row.id)
  const applied = (stage: string, target: string, enabled?: boolean) => ({ changed: true, application: 'applied', stage, target, ...(enabled === undefined ? {} : { enabled }) })
  const manager = {
    async listBundles() {
      const row = await manifest()
      return Object.keys(row.dependencies).map(name => {
        const id = name === research ? 'research' : 'other'
        return { name, installed: true, enabled: row.dsh.profile.bundles.includes(name), rows: [{ rowId: id, moduleName: name, entryId: `include:${id}` }] }
      })
    },
    async listPlugins() {
      const row = await manifest()
      return row.dsh.profile.bundles.map((name: string) => {
        const id = name === research ? 'research' : 'other'
        return { entryId: `include:${id}`, patchId: id, moduleName: name, enabled: choice.get(name) !== false }
      })
    },
    async installBundle(spec: string, options?: unknown) {
      events.push('native:install')
      expect(this).toBe(manager)
      expect(spec).toBe('research-spec')
      await select(research, true, true)
      return { ...applied('enable', research, true), bundle: research, packageResult: { exitCode: 0 }, options }
    },
    async setBundleEnabled(name: string, enabled: boolean) {
      events.push(`native:bundle:${enabled}`)
      if (!enabled) expect(await tools()).not.toContain(`${name === research ? 'research' : 'other'}-tools`)
      await select(name, enabled)
      return applied('enable', name, enabled)
    },
    async setPluginEnabled(id: string, enabled: boolean) {
      events.push(`native:entry:${enabled}`)
      if (!enabled) expect(await tools()).not.toContain('research-tools')
      choice.set(research, enabled)
      return applied('enable', id, enabled)
    },
    async removeBundle(name: string) {
      events.push('native:remove')
      expect(await tools()).not.toContain('research-tools')
      expect(await tools()).toContain('other-tools')
      await select(name, false, false)
      return { ...applied('remove', name), packageResult: { exitCode: 0, logPath: 'native.log' } }
    },
    async cancelInstall(id: string) { return { status: 'cancelled', id } },
    async waitForInstall(id: string) { return { id } },
  }
  const reloadProfile = async () => { events.push(`reload:${(await tools()).join(',')}`); return true }
  const attach = (overrides: Partial<Parameters<typeof adaptNativeToolProjection>[1]> = {}) => adaptNativeToolProjection(manager as unknown as NativeToolManager, { paths, reloadProfile, ...overrides })
  return { paths, file, events, author, initial, choice, manager, tools, manifest, select, attach, reloadProfile, applied }
}

describe('native tool projection lifecycle', () => {
  it('makes freshly installed tools live before returning and preserves all native arguments and APIs', async () => {
    const f = await fixture(false)
    const cancel = f.manager.cancelInstall
    const wait = f.manager.waitForInstall
    const adapter = f.attach()
    await adapter.ready
    f.events.length = 0
    const options = { requestId: 'install-1', enabled: true, registry: 'https://registry.example', approvedBuilds: ['dep'] }
    const result = await f.manager.installBundle('research-spec', options)
    expect(result).toMatchObject({ application: 'applied', options, packageResult: { exitCode: 0 } })
    expect(f.events).toEqual(['native:install', 'reload:other-tools,research-tools'])
    expect(await f.tools()).toEqual(['other-tools', 'research-tools'])
    expect(f.manager.cancelInstall).toBe(cancel)
    expect(f.manager.waitForInstall).not.toBe(wait)
    expect(await f.manager.cancelInstall('install-1')).toEqual({ status: 'cancelled', id: 'install-1' })
    adapter.dispose()
    expect(f.manager.waitForInstall).toBe(wait)
  })

  it.each(['applied', 'recovered-failure', 'recovery-failed'])('waits outside the queue for the same final adapted %s receipt and deduplicates pending request ids', async mode => {
    const f = await fixture()
    const entered = deferred(), finish = deferred()
    let active = false
    let reloads = 0
    let nativeWaits = 0
    f.manager.waitForInstall = async () => { nativeWaits++;return null as never }
    const adapter = f.attach({ reloadProfile: async () => {
      if (!active) return f.reloadProfile()
      reloads++
      if (reloads === 1) {
        entered.resolve();await finish.promise
        if (mode !== 'applied') throw new Error('post-install reload rejected')
      } else if (mode === 'recovery-failed') throw new Error('recovery reload rejected')
      return f.reloadProfile()
    } })
    await adapter.ready
    active = true
    f.events.length = 0
    const installing = f.manager.installBundle('research-spec', { requestId: 'wait-final' })
    await entered.promise // Native install has settled; adapter synchronization remains pending.
    const waiting = f.manager.waitForInstall('wait-final')
    expect(waiting).toBe(installing)
    expect(f.manager.installBundle('research-spec', { requestId: 'wait-final' })).toBe(installing)
    let settled = false
    waiting.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(nativeWaits).toBe(0)
    finish.resolve()
    const [installed, waited] = await Promise.all([installing, waiting])
    expect(waited).toBe(installed)
    expect(installed).toMatchObject({ application: mode === 'applied' ? 'applied' : 'failed' })
    if (mode === 'recovered-failure') expect(installed).toMatchObject({ warnings: [expect.stringContaining('synchronization failed'), expect.stringContaining('restored')] })
    if (mode === 'recovery-failed') expect(installed).toMatchObject({ warnings: [expect.stringContaining('synchronization failed'), expect.stringContaining('recovery failed')] })
    expect(f.events.filter(event => event === 'native:install')).toHaveLength(1)
    expect(await f.manager.waitForInstall('wait-final')).toBeNull()
    expect(nativeWaits).toBe(1)
    adapter.dispose()
  })

  it('tracks an empty string request id without trimming and delegates unrelated waits to native', async () => {
    const f = await fixture()
    const entered = deferred(), finish = deferred()
    const native = f.manager.installBundle
    f.manager.installBundle = async (spec, options) => { entered.resolve();await finish.promise;return native.call(f.manager, spec, options) }
    const adapter = f.attach();await adapter.ready
    const installing = f.manager.installBundle('research-spec', { requestId: '' })
    await entered.promise
    expect(f.manager.waitForInstall('')).toBe(installing)
    expect(await f.manager.waitForInstall('unknown')).toEqual({ id: 'unknown' })
    finish.resolve();await installing
    expect(await f.manager.waitForInstall('')).toEqual({ id: '' })
    adapter.dispose()
  })

  it('clears transient waits on disposal, preserves pending callers and restores wrappers by identity', async () => {
    const f = await fixture()
    const entered = deferred(), finish = deferred()
    const native = f.manager.installBundle
    f.manager.installBundle = async (spec, options) => { entered.resolve();await finish.promise;return native.call(f.manager, spec, options) }
    f.manager.waitForInstall = async () => null as never
    const originalWait = f.manager.waitForInstall
    const adapter = f.attach();await adapter.ready
    const capturedWait = f.manager.waitForInstall
    const installing = f.manager.installBundle('research-spec', { requestId: 'dispose-pending' })
    await entered.promise
    const waiting = f.manager.waitForInstall('dispose-pending')
    expect(waiting).toBe(installing)
    const replacement = async () => ({ id: 'external' }) as never
    f.manager.waitForInstall = replacement
    adapter.dispose()
    expect(f.manager.waitForInstall).toBe(replacement)
    expect(await capturedWait.call(f.manager, 'dispose-pending')).toBeNull()
    finish.resolve()
    const [installed, waited] = await Promise.all([installing, waiting])
    expect(waited).toBe(installed)
    expect(installed).toMatchObject({ application: 'applied' })
    expect(capturedWait).not.toBe(originalWait)
  })

  it('removes only the required component tools before disable and restores them on enable', async () => {
    const f = await fixture()
    const adapter = f.attach(); await adapter.ready
    f.events.length = 0
    expect(await f.manager.setPluginEnabled('include:research', false)).toMatchObject({ application: 'applied' })
    expect(await f.tools()).toEqual(['other-tools'])
    expect(await f.manager.setPluginEnabled('include:research', true)).toMatchObject({ application: 'applied' })
    expect(await f.tools()).toEqual(['other-tools', 'research-tools'])
    expect(f.events).toEqual(['native:entry:false', 'reload:other-tools', 'native:entry:true', 'reload:other-tools,research-tools'])
    adapter.dispose()
  })

  it('disables/enables bundles and removes/restarts/reinstalls without reviving removed tools or changing author data', async () => {
    const f = await fixture()
    const state = await readFile(f.paths.stateFile, 'utf8')
    const preset = await readFile(join(f.paths.home, '.agent-presets', 'author', 'preset.yml'), 'utf8')
    let adapter = f.attach(); await adapter.ready
    await f.manager.setBundleEnabled(research, false)
    expect(await f.tools()).toEqual(['other-tools'])
    await f.manager.setBundleEnabled(research, true)
    expect(await f.tools()).toContain('research-tools')
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject({ application: 'applied', packageResult: { logPath: 'native.log' } })
    expect(await f.tools()).toEqual(['other-tools'])
    adapter.dispose()
    // Deployment can be repeated; startup repairs against native selections.
    await syncPresetDeclarations(f.paths.home, f.paths.profileDir)
    adapter = f.attach(); await adapter.ready
    expect(await f.tools()).toEqual(['other-tools'])
    await f.manager.installBundle('research-spec')
    expect(await f.tools()).toContain('research-tools')
    expect(await readFile(f.paths.patchFile, 'utf8')).toBe(f.author)
    expect(await readFile(f.paths.stateFile, 'utf8')).toBe(state)
    expect(await readFile(join(f.paths.home, '.agent-presets', 'author', 'preset.yml'), 'utf8')).toBe(preset)
    expect(await readFile(join(f.paths.home, 'storages', 'research.json'), 'utf8')).toBe('author data\r\n')
    expect((await f.manifest()).authorField).toEqual(f.initial.authorField)
    expect((await f.manifest()).dependencies[other]).toBe('1')
    adapter.dispose()
  })

  it('repairs stale startup declarations and keeps disabled required services disabled', async () => {
    const f = await fixture()
    await syncPresetDeclarations(f.paths.home, f.paths.profileDir)
    f.choice.set(research, false)
    const adapter = f.attach(); await adapter.ready
    expect(await f.tools()).toEqual(['other-tools'])
    expect(f.events).toEqual(['reload:other-tools'])
    expect(f.choice.get(research)).toBe(false)
    adapter.dispose()
  })

  it.each(['failed', 'cancelled'])('preserves structured native %s and restores exact projection bytes', async application => {
    const f = await fixture()
    const native = { changed: false, application, stage: 'remove', target: research, ...(application === 'failed' ? { error: { code: 'operation-error', diagnostic: 'native-log' } } : {}) }
    f.manager.removeBundle = async () => native as never
    const adapter = f.attach(); await adapter.ready
    const previous = (await readFile(f.file, 'utf8')).replace(/\n/g, '\r\n')
    await writeFile(f.file, previous)
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject(native)
    expect(result).toMatchObject({ warnings: [expect.stringContaining('restored')] })
    expect(await readFile(f.file, 'utf8')).toBe(previous)
    adapter.dispose()
  })

  it('recovers the original selection after pnpm refuses removal, retaining its failure receipt', async () => {
    const f = await fixture()
    f.manager.removeBundle = async name => {
      expect(await f.tools()).not.toContain('research-tools')
      await f.select(name, false)
      return { changed: true, application: 'failed', stage: 'remove', target: name, error: { code: 'operation-error' }, packageResult: { exitCode: 1, kind: 'permission' } } as never
    }
    const adapter = f.attach(); await adapter.ready
    const previous = await readFile(f.file, 'utf8')
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject({ changed: true, application: 'failed', packageResult: { exitCode: 1, kind: 'permission' }, warnings: [expect.stringContaining('restored')] })
    expect((await f.manager.listBundles()).find(row => row.name === research)?.enabled).toBe(true)
    expect(await readFile(f.file, 'utf8')).toBe(previous)
    adapter.dispose()
  })

  it('does not restore removed dependencies after partial native removal failure', async () => {
    const f = await fixture()
    f.manager.removeBundle = async name => {
      await f.select(name, false, false)
      return { changed: true, application: 'failed', stage: 'remove', target: name, error: { code: 'operation-error' } } as never
    }
    const adapter = f.attach(); await adapter.ready
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject({ application: 'failed', warnings: [expect.stringContaining('remaining native dependencies')] })
    expect(await f.tools()).toEqual(['other-tools'])
    expect((await f.manifest()).dependencies[research]).toBeUndefined()
    expect(f.events).not.toContain('native:bundle:true')
    adapter.dispose()
  })

  it('refuses to start native removal if prewrite fails and restores prior bytes', async () => {
    const f = await fixture()
    let reject = false
    const io = { ...defaultPersistIo, rename: async (from: string, to: string) => {
      if (reject && to === f.file) { reject = false; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }
      return defaultPersistIo.rename(from, to)
    } }
    const adapter = f.attach({ io }); await adapter.ready
    const previous = await readFile(f.file, 'utf8')
    reject = true
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject({ changed: false, application: 'failed', warnings: [expect.stringContaining('synchronization failed'), expect.stringContaining('restored')] })
    expect(f.events).not.toContain('native:remove')
    expect(await readFile(f.file, 'utf8')).toBe(previous)
    adapter.dispose()
  })

  it('reports post-operation reload failure, restores still available choices and never claims success', async () => {
    const f = await fixture()
    let reject = false
    const adapter = f.attach({ reloadProfile: async () => { if (reject) { reject = false; throw new Error('reload rejected') }; return f.reloadProfile() } })
    await adapter.ready
    reject = true
    const result = await f.manager.setBundleEnabled(research, false)
    expect(result).toMatchObject({ changed: true, application: 'failed', warnings: [expect.stringContaining('synchronization failed'), expect.stringContaining('restored')] })
    expect((await f.manager.listBundles()).find(row => row.name === research)?.enabled).toBe(true)
    expect(await f.tools()).toContain('research-tools')
    adapter.dispose()
  })

  it('reports selection recovery failure and keeps the current projection truthful', async () => {
    const f = await fixture()
    const original = f.manager.setBundleEnabled
    f.manager.setBundleEnabled = async (name, enabled) => enabled
      ? { changed: false, application: 'failed', stage: 'enable', target: name, error: { code: 'operation-error' } } as never
      : original.call(f.manager, name, enabled)
    f.manager.removeBundle = async name => { await f.select(name, false); return { application: 'failed', changed: true, target: name, stage: 'remove', error: { code: 'operation-error' } } as never }
    const adapter = f.attach(); await adapter.ready
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject({ application: 'failed', warnings: [expect.stringContaining('recovery failed')] })
    expect(await f.tools()).toEqual(['other-tools'])
    adapter.dispose()
  })

  it('reports inability to restore or write the current-state projection after native failure', async () => {
    const f = await fixture()
    let writesFail = false
    f.manager.removeBundle = async name => {
      writesFail = true
      return { application: 'failed', changed: false, target: name, stage: 'remove', error: { code: 'operation-error' } } as never
    }
    const io = { ...defaultPersistIo, rename: async (from: string, to: string) => {
      if (writesFail && to === f.file) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      return defaultPersistIo.rename(from, to)
    } }
    const adapter = f.attach({ io }); await adapter.ready
    const result = await f.manager.removeBundle(research)
    expect(result).toMatchObject({ application: 'failed', warnings: [expect.stringContaining('current-state projection failed')] })
    expect(await f.tools()).toEqual(['other-tools'])
    expect((await f.manager.listBundles()).find(row => row.name === research)?.enabled).toBe(true)
    adapter.dispose()
  })

  it('preserves native restart-required and overridden receipts without reporting their application as applied', async () => {
    const f = await fixture()
    f.manager.setPluginEnabled = async (target, enabled) => ({ changed: true, application: 'overridden', stage: 'enable', target, enabled }) as never
    f.manager.installBundle = async () => ({ changed: true, application: 'restart-required', stage: 'enable', target: research, bundle: research }) as never
    const adapter = f.attach(); await adapter.ready
    f.events.length = 0
    expect(await f.manager.setPluginEnabled('include:research', false)).toMatchObject({ application: 'overridden' })
    expect(await f.tools()).toContain('research-tools')
    expect(await f.manager.installBundle('research-spec')).toMatchObject({ application: 'restart-required' })
    expect(f.events).toEqual(['reload:other-tools,research-tools'])
    adapter.dispose()
  })

  it('serializes native operations with writing-preset generation and its reload', async () => {
    const f = await fixture(false)
    const source = join(f.paths.profileDir, 'node_modules', 'novel', 'preset')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'preset.yml'), 'name: 小说创作\n')
    await writeFile(join(source, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(f.paths.profileDir, 'composition.json'), JSON.stringify({ presets: [{ id: 'novel', packageName: 'novel', path: 'preset' }] }))
    const started = deferred(), finish = deferred()
    const original = f.manager.installBundle
    f.manager.installBundle = async (spec, options) => { started.resolve(); await finish.promise; return original.call(f.manager, spec, options) }
    const adapter = f.attach(); await adapter.ready
    const installing = f.manager.installBundle('research-spec')
    await started.promise
    let presetReloaded = false
    const writing = handlePluginsRpc('presets.setEnabled', { id: 'novel', enabled: true }, signal(), {
      paths: f.paths, readToolState: () => readNativeToolState(f.manager as unknown as NativeToolManager),
      reloadProfile: async () => { presetReloaded = true; expect(await f.tools()).toContain('research-tools'); return true },
    })
    await new Promise(done => setTimeout(done, 10))
    expect(presetReloaded).toBe(false)
    finish.resolve()
    await installing
    expect(await writing).toMatchObject({ ok: true, value: { restartRequired: false } })
    expect(presetReloaded).toBe(true)
    expect(await f.tools()).toContain('research-tools')
    expect(JSON.parse(await readFile(f.file, 'utf8'))[0].insert).toContainEqual(expect.objectContaining({ id: 'editor-preset-novel' }))
    adapter.dispose()
  })

  it('disposes identity-safely and composes with core guards in either disposal order', async () => {
    const f = await fixture()
    const original = f.manager.setPluginEnabled
    const adapter = f.attach(); await adapter.ready
    const unprotect = protectCorePluginManager(f.manager)
    expect(await f.manager.setPluginEnabled('include:editor-workbench-tools', false)).toMatchObject({ changed: false, error: { code: 'management-required' } })
    adapter.dispose()
    unprotect()
    // Disposed captured wrappers delegate to the original; core guards remain authoritative while live.
    expect(await f.manager.setPluginEnabled('include:research', true)).toMatchObject({ application: 'applied' })
    const second = f.attach(); await second.ready
    const wrapper = f.manager.setPluginEnabled
    const replacement = async () => ({ application: 'failed', changed: false }) as never
    f.manager.setPluginEnabled = replacement
    second.dispose()
    expect(f.manager.setPluginEnabled).toBe(replacement)
    expect(wrapper).not.toBe(original)
    await runQueuedSorted([f.paths.home, f.paths.stateFile], async () => {})
  })
})
