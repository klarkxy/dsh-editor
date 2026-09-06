import { EventEmitter } from 'node:events'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isAllowedNavigation, parseDshWebUrl } from '../src/dsh-url.js'
import { PROFILE_MARKER, ProfileCollisionError, deployProfile, resolveDshHome } from '../src/profile.js'
import { installNavigationPolicy } from '../src/navigation.js'
import { DshSupervisor } from '../src/supervisor.js'
import { materializePackagedRuntime, treeDigest } from '../src/runtime-cache.js'
import { claimPrimaryInstance, createDesktopLifecycle, type DesktopLifecycleDeps, type EditorInput, type EditorWindow } from '../src/window-lifecycle.js'
import type { ChildLike } from '../src/contracts.js'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 8123
  exitCode: number | null = null
  stdout = new PassThrough()
  stderr = new PassThrough()
  killedWith: string | number | undefined
  kill(signal?: NodeJS.Signals | number): boolean { this.killedWith = signal; return true }
  exit(code = 0): void { this.exitCode = code; this.emit('exit', code, null) }
}

async function runtimeFixture(version = 'one', executableNode = false): Promise<{ root: string; resources: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'))
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'node'), { recursive: true })
  await mkdir(join(resources, 'dsh', 'lib'), { recursive: true })
  await mkdir(join(resources, 'profile-template'), { recursive: true })
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  if (executableNode) await copyFile(process.execPath, join(resources, 'node', nodeName))
  else await writeFile(join(resources, 'node', nodeName), `node-${version}`)
  await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), `dsh-${version}`)
  await writeFile(join(resources, 'profile-template', 'package.json'), `{"version":"${version}"}`)
  const [node, dsh, profile] = await Promise.all([
    treeDigest(join(resources, 'node')),
    treeDigest(join(resources, 'dsh')),
    treeDigest(join(resources, 'profile-template')),
  ])
  await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
    format: 1, platform: `${process.platform}-${process.arch}`,
    node: { version: '24.16.0', ...node }, dsh: { version: '0.1.1-rc.2', ...dsh }, profile,
  }))
  return { root, resources }
}

describe('DSH URL trust root', () => {
  it('accepts only the exact DSH loopback readiness line', () => {
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823')?.href).toBe('http://127.0.0.1:41823/')
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823 (LAN: http://10.0.0.1:41823)')?.port).toBe('41823')
    for (const line of ['http://127.0.0.1:8080', 'dsh web: http://localhost:8080', 'dsh web: https://127.0.0.1:8080', 'dsh web: http://127.0.0.1:8080/path', 'dsh web: http://127.0.0.1:0']) expect(parseDshWebUrl(line)).toBeUndefined()
  })
  it('does not allow origin spoofing or port changes', () => {
    const expected = new URL('http://127.0.0.1:41823/')
    expect(isAllowedNavigation('http://127.0.0.1:41823/settings', expected)).toBe(true)
    expect(isAllowedNavigation('http://127.0.0.1.evil.example:41823/', expected)).toBe(false)
    expect(isAllowedNavigation('http://127.0.0.1:41824/', expected)).toBe(false)
  })
})

describe('desktop branding assets', () => {
  it('keeps the source icon, window icon, and Windows package icon wired together', async () => {
    const repo = join(import.meta.dirname, '..', '..', '..')
    const build = join(repo, 'apps', 'desktop', 'build')
    const [svg, png, ico, main, builder, afterPack] = await Promise.all([
      readFile(join(build, 'icon.svg'), 'utf8'),
      readFile(join(build, 'icon.png')),
      readFile(join(build, 'icon.ico')),
      readFile(join(repo, 'apps', 'desktop', 'src', 'main.ts'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'electron-builder.yml'), 'utf8'),
      readFile(join(repo, 'scripts', 'after-pack-desktop.cjs'), 'utf8'),
    ])
    expect(svg).toContain('<title>DSH Editor</title>')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(7)
    expect(main).toContain("build', 'icon.png")
    expect(builder).toContain('icon: build/icon.ico')
    expect(builder).toContain('installerIcon: build/icon.ico')
    expect(builder).toContain('signAndEditExecutable: false')
    expect(afterPack).toContain("electron-winstaller/vendor/rcedit.exe")
    // About / update page wiring: the renderer is locked behind a strict CSP
    // that blocks api.github.com, so the main process owns the round-trip and
    // the preload bridge exposes invoke-style methods.
    expect(main).toContain("'github.com'")
    expect(main).toContain("'dsh-window:get-app-info'")
    expect(main).toContain("'dsh-window:check-update'")
    // Startup check: same round-trip kicked off in the background at launch,
    // cached for the renderer to pull once its UI is up.
    expect(main).toContain("'dsh-window:startup-update'")
    expect(main).toContain('checkLatest(app.getVersion())')
  })
})

describe('profile deployment', () => {
  it('keeps the conversation domain enabled for the custom chat projection', async () => {
    const patch = await readFile(join(import.meta.dirname, '..', 'resources', 'profile', 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toMatch(/- id: ui-conversation\s+disabled: true/)
  })
  it('honors DSH_HOME and otherwise isolates desktop state from the default DSH home', () => {
    expect(resolveDshHome({ DSH_HOME: 'D:/custom' }, 'D:/Users/example')).toBe('D:/custom')
    expect(resolveDshHome({ DSH_HOME: '   ' }, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh-editor'))
    expect(resolveDshHome({}, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh-editor'))
  })
  it('fails closed on an unmarked collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const profile = join(root, 'profiles', 'dsh-editor')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{}')
    await expect(deployProfile(root, profile)).rejects.toBeInstanceOf(ProfileCollisionError)
  })
  it('stages an owned profile update and leaves no staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const existing = join(root, 'profiles', 'dsh-editor')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"version":2}')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, PROFILE_MARKER), '{"app":"dsh-editor","schema":1}')
    await writeFile(join(existing, 'package.json'), '{"version":1}')
    const installed = await deployProfile(root, template)
    expect(await readFile(join(installed, 'package.json'), 'utf8')).toContain('2')
    expect(existsSync(join(installed, PROFILE_MARKER))).toBe(true)
    expect((await (await import('node:fs/promises')).readdir(join(root, 'profiles'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
})

describe('persistent packaged runtime cache', () => {
  it('copies and verifies the bundled runtime outside the portable extraction tree', async () => {
    const { root, resources } = await runtimeFixture()
    const runtime = await materializePackagedRuntime(join(root, 'home'), resources)
    expect(runtime.cliPath).toContain(join('home', 'runtime', 'dsh-editor-runtime'))
    expect(runtime.cliPath).not.toContain(resources)
    expect(await readFile(runtime.cliPath, 'utf8')).toBe('dsh-one')
    expect(existsSync(join(root, 'home', 'runtime', 'dsh-editor-runtime', '.dsh-editor-runtime.json'))).toBe(true)
  })
  it('rejects a bundled runtime manifest built for a different platform', async () => {
    const { root, resources } = await runtimeFixture()
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
    ])
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
      format: 1, platform: 'unsupported-platform', node: { version: '24.16.0', ...node }, dsh: { version: '0.1.1-rc.2', ...dsh }, profile,
    }))
    await expect(materializePackagedRuntime(join(root, 'home'), resources)).rejects.toThrow('unsupported identity')
  })
  it('atomically replaces an owned cache when the bundled manifest changes', async () => {
    const { root, resources } = await runtimeFixture('one')
    const home = join(root, 'home')
    await materializePackagedRuntime(home, resources)
    await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), 'dsh-two')
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
    ])
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
      format: 1, platform: `${process.platform}-${process.arch}`, node: { version: '24.16.0', ...node }, dsh: { version: '0.1.1-rc.2', ...dsh }, profile,
    }))
    const runtime = await materializePackagedRuntime(home, resources)
    expect(await readFile(runtime.cliPath, 'utf8')).toBe('dsh-two')
    expect((await (await import('node:fs/promises')).readdir(join(home, 'runtime'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it.runIf(process.platform === 'win32')('starts from the committed runtime while an old Node executable still locks its backup', async () => {
    const { root, resources } = await runtimeFixture('one', true)
    const home = join(root, 'home')
    const first = await materializePackagedRuntime(home, resources)
    const oldRuntime = spawn(first.nodePath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    // 'spawn' precedes executable loading on Windows; wait until the old runtime is actually running.
    await once(oldRuntime.stdout!, 'data')
    try {
      await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), 'dsh-two')
      const [node, dsh, profile] = await Promise.all([
        treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
      ])
      await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
        format: 1, platform: `${process.platform}-${process.arch}`, node: { version: '24.16.0', ...node }, dsh: { version: '0.1.1-rc.2', ...dsh }, profile,
      }))

      const committed = await materializePackagedRuntime(home, resources)
      expect(await readFile(committed.cliPath, 'utf8')).toBe('dsh-two')
      const runtimeParent = join(home, 'runtime')
      const lockedBackup = (await readdir(runtimeParent)).find((name) => name.includes('.backup-'))
      expect(lockedBackup).toBeTruthy()
      expect(existsSync(join(runtimeParent, lockedBackup!, 'dsh', 'lib', 'bin.js'))).toBe(true)

      const exited = once(oldRuntime, 'exit')
      oldRuntime.kill('SIGTERM')
      await exited
      await materializePackagedRuntime(home, resources)
      expect((await readdir(runtimeParent)).some((name) => name.includes('.backup-'))).toBe(false)
    } finally {
      if (oldRuntime.exitCode === null && oldRuntime.signalCode === null) {
        const exited = once(oldRuntime, 'exit')
        oldRuntime.kill('SIGTERM')
        await exited
      }
    }
  }, 30_000)
  it('never replaces an unowned runtime cache path', async () => {
    const { root, resources } = await runtimeFixture()
    const target = join(root, 'home', 'runtime', 'dsh-editor-runtime')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'user-file.txt'), 'do not touch')
    await expect(materializePackagedRuntime(join(root, 'home'), resources)).rejects.toThrow('unowned desktop runtime cache')
    expect(await readFile(join(target, 'user-file.txt'), 'utf8')).toBe('do not touch')
  })
  it('never removes an unmarked directory that resembles a stale backup', async () => {
    const { root, resources } = await runtimeFixture()
    const home = join(root, 'home')
    await materializePackagedRuntime(home, resources)
    const collision = join(home, 'runtime', '.dsh-editor-runtime.backup-user')
    await mkdir(collision)
    await writeFile(join(collision, 'user-file.txt'), 'do not touch')
    await materializePackagedRuntime(home, resources)
    expect(await readFile(join(collision, 'user-file.txt'), 'utf8')).toBe('do not touch')
  })
})

describe('child supervision', () => {
  const launch = { nodePath: 'node.exe', cliPath: 'dsh/lib/bin.js', home: 'D:/home', env: {}, timeoutMs: 25 }
  it('waits for readiness and reports an unexpected post-ready exit', async () => {
    const child = new FakeChild()
    const unexpected = vi.fn()
    const supervisor = new DshSupervisor({ spawn: () => child, onUnexpectedExit: unexpected })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await expect(ready).resolves.toMatchObject({ port: '43111' })
    child.exit(23)
    expect(unexpected).toHaveBeenCalledOnce()
  })
  it('rejects a readiness timeout', async () => {
    const child = new FakeChild()
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 1 })
    await expect(supervisor.start(launch)).rejects.toThrow('Timed out waiting 25ms')
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
  })
  it('uses graceful stop before exact process-tree fallback', async () => {
    const child = new FakeChild()
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 1 })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    await supervisor.stop()
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
  })
  it('does not force-kill a child that exits during graceful shutdown', async () => {
    const child = new FakeChild()
    child.kill = (signal?: NodeJS.Signals | number) => { child.killedWith = signal; queueMicrotask(() => child.exit()); return true }
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 25 })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    await supervisor.stop()
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).not.toHaveBeenCalled()
  })
  it('relaunches when the random port is restricted by Chromium', async () => {
    const blocked = new FakeChild()
    blocked.kill = (signal?: NodeJS.Signals | number) => { blocked.killedWith = signal; queueMicrotask(() => blocked.exit()); return true }
    const usable = new FakeChild()
    const children = [blocked, usable]
    const spawn = vi.fn(() => children.shift()!)
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 25 })
    const ready = supervisor.start({ ...launch, timeoutMs: 5_000 })
    blocked.stdout.write('dsh web: http://127.0.0.1:6665\n')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    usable.stdout.write('dsh web: http://127.0.0.1:43112\n')
    await expect(ready).resolves.toMatchObject({ port: '43112' })
    expect(blocked.killedWith).toBe('SIGTERM')
  })
})

describe('BrowserWindow policy', () => {
  it('blocks popups, permissions, and non-DSH navigation', () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let popup: (() => { action: 'deny' }) | undefined
    let permission: ((_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void) | undefined
    const policy = installNavigationPolicy({
      on: (_event, listener) => { navigate = listener },
      setWindowOpenHandler: (handler) => { popup = handler },
      session: { setPermissionRequestHandler: (handler) => { permission = handler } },
    }, new URL('http://127.0.0.1:43111/'))
    const preventDefault = vi.fn()
    navigate?.({ preventDefault }, 'https://example.com')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(popup?.()).toEqual({ action: 'deny' })
    const callback = vi.fn()
    permission?.({}, 'notifications', callback)
    expect(callback).toHaveBeenCalledWith(false)
    policy.setExpected(new URL('http://127.0.0.1:43112/'))
    preventDefault.mockClear()
    navigate?.({ preventDefault }, 'http://127.0.0.1:43111/settings')
    expect(preventDefault).toHaveBeenCalledOnce()
    preventDefault.mockClear()
    navigate?.({ preventDefault }, 'http://127.0.0.1:43112/settings')
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

class FakeSession {
  downloadListeners: Array<(event: { preventDefault(): void }, item: { getFilename(): string; setSavePath(path: string): void }, contents?: unknown) => void> = []
  on(event: string, listener: (event: { preventDefault(): void }, item: { getFilename(): string; setSavePath(path: string): void }, contents?: unknown) => void): void {
    if (event === 'will-download') this.downloadListeners.push(listener)
  }
  setPermissionRequestHandler(): void { /* session policy is installed per window via the real helper */ }
}

class FakeWindow implements EditorWindow {
  loaded: string[] = []
  shown = false
  private readonly closedListeners: Array<() => void> = []
  private readonly navigateListeners: Array<(event: { preventDefault(): void }, url: string) => void> = []
  private readonly inputListeners: Array<(event: { preventDefault(): void }, input: EditorInput) => void> = []
  readonly webContents: EditorWindow['webContents']
  constructor(session: FakeSession) {
    const window = this
    this.webContents = {
      session,
      on(event, listener) {
        if (event === 'will-navigate') window.navigateListeners.push(listener as (event: { preventDefault(): void }, url: string) => void)
        if (event === 'before-input-event') window.inputListeners.push(listener as (event: { preventDefault(): void }, input: EditorInput) => void)
      },
      setWindowOpenHandler() { /* popup denial is covered by installNavigationPolicy */ },
    }
  }
  async loadURL(url: string): Promise<void> { this.loaded.push(url) }
  show(): void { this.shown = true }
  on(event: 'closed', listener: () => void): this {
    if (event === 'closed') this.closedListeners.push(listener)
    return this
  }
  close(): void { for (const listener of this.closedListeners) listener() }
  emitNavigate(url: string): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    for (const listener of this.navigateListeners) listener(event, url)
    return event
  }
  emitInput(input: EditorInput): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    for (const listener of this.inputListeners) listener(event, input)
    return event
  }
}

function fakeApp(lock: boolean) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    requestSingleInstanceLock: vi.fn(() => lock),
    quit: vi.fn(),
    whenReady: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
    }),
    handlers,
  }
}

function multiWindowHarness() {
  const session = new FakeSession()
  const windows: FakeWindow[] = []
  const contents = new Map<EditorWindow['webContents'], FakeWindow>()
  let starts = 0
  let stops = 0
  let supervisors = 0
  let unexpected: ((reason: Error) => void) | undefined
  const showSaveDialog = vi.fn((window: EditorWindow | undefined, suggested: string) => `saved:${suggested}:${window ? windows.indexOf(window as FakeWindow) : -1}`)
  const deploy = vi.fn(async () => 'profile')
  const deps: DesktopLifecycleDeps = {
    createBrowserWindow: () => {
      const window = new FakeWindow(session)
      windows.push(window)
      contents.set(window.webContents, window)
      return window
    },
    fromWebContents: (candidate) => contents.get(candidate as EditorWindow['webContents']),
    showSaveDialog,
    resolveRuntime: async () => ({ nodePath: 'node.exe', cliPath: 'dsh/lib/bin.js', template: 'template' }),
    deployProfile: deploy,
    createSupervisor: (options) => {
      supervisors += 1
      unexpected = options.onUnexpectedExit
      return {
        start: async () => {
          starts += 1
          await new Promise((resolve) => setTimeout(resolve, 15))
          return new URL('http://127.0.0.1:43111/')
        },
        stop: async () => { stops += 1 },
      }
    },
    errorHtml: (error) => `error:${error instanceof Error ? error.message : String(error)}`,
    loadingHtml: () => 'loading:',
    getHomePath: () => 'D:/home',
    env: { DSH_HOME: 'D:/custom-home' },
    timeoutMs: 20_000,
  }
  return {
    session, windows, deps, deploy, showSaveDialog,
    counts: () => ({ starts, stops, supervisors, windows: windows.length }),
    unexpected: () => unexpected,
  }
}

describe('controlled multi-window', () => {
  it('starts and deploys the backend once for concurrent window creation', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow(), lifecycle.createWindow()])
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 3 })
    expect(harness.deploy).toHaveBeenCalledOnce()
    expect(harness.windows.every((window) => window.loaded.at(-1) === 'http://127.0.0.1:43111/')).toBe(true)
  })

  it('creates a second-instance window without starting another backend', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    lifecycle.handleSecondInstance()
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2))
    await vi.waitFor(() => expect(harness.windows[1]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 2 })
    expect(harness.deploy).toHaveBeenCalledOnce()
  })

  it('opens a window only for the focused Ctrl+Shift+N shortcut', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    const accepted = harness.windows[0]!.emitInput({ type: 'keyDown', key: 'N', control: true, shift: true, alt: false, meta: false })
    expect(accepted.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2))
    for (const input of [
      { type: 'keyUp', key: 'N', control: true, shift: true, alt: false, meta: false },
      { type: 'keyDown', key: 'n', control: true, shift: false, alt: false, meta: false },
      { type: 'keyDown', key: 'T', control: true, shift: true, alt: false, meta: false },
      { type: 'keyDown', key: 'N', control: true, shift: true, alt: true, meta: false },
      { type: 'keyDown', key: 'N', control: false, shift: true, alt: false, meta: false },
      { type: 'keyDown', key: 'N', control: true, shift: true, alt: false, meta: true },
    ] satisfies EditorInput[]) {
      const ignored = harness.windows[0]!.emitInput(input)
      expect(ignored.preventDefault).not.toHaveBeenCalled()
    }
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 2 })
  })

  it('keeps the backend running when one window closes and stops it once on shutdown', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    harness.windows[0]!.close()
    expect(harness.counts()).toMatchObject({ starts: 1, stops: 0, windows: 2 })
    expect(harness.windows[1]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    await lifecycle.shutdown()
    await lifecycle.shutdown()
    expect(harness.counts().stops).toBe(1)
  })

  it('waits for an in-flight backend start before completing shutdown', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve })
    const harness = multiWindowHarness()
    const stop = vi.fn(async () => undefined)
    harness.deps.createSupervisor = () => ({
      async start() {
        await startGate
        return new URL('http://127.0.0.1:43111/')
      },
      stop,
    })
    const lifecycle = createDesktopLifecycle(harness.deps)
    const opening = lifecycle.createWindow()
    await vi.waitFor(() => expect(lifecycle.needsGracefulShutdown()).toBe(true))
    let shutdownFinished = false
    const shutdown = lifecycle.shutdown().then(() => { shutdownFinished = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(shutdownFinished).toBe(false)
    releaseStart()
    await Promise.all([opening, shutdown])
    expect(shutdownFinished).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('broadcasts unexpected backend exit and deduplicates concurrent retries across windows', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    harness.unexpected()?.(new Error('DSH exited unexpectedly (code 23, signal none)'))
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('error:DSH exited unexpectedly (code 23, signal none)')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('error:DSH exited unexpectedly (code 23, signal none)')
    })
    harness.windows[0]!.emitNavigate('dsh-editor://retry')
    harness.windows[1]!.emitNavigate('dsh-editor://retry/')
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    })
    expect(harness.counts()).toEqual({ starts: 2, stops: 1, supervisors: 1, windows: 2 })
    expect(harness.deploy).toHaveBeenCalledTimes(2)
  })

  it('registers the download handler once and routes the save dialog to the initiating window', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    expect(harness.session.downloadListeners).toHaveLength(1)
    const allowed = { path: undefined as string | undefined, getFilename: () => 'chapter.md', setSavePath(path: string) { this.path = path } }
    harness.session.downloadListeners[0]!({ preventDefault: vi.fn() }, allowed, harness.windows[1]!.webContents)
    expect(harness.showSaveDialog).toHaveBeenCalledWith(harness.windows[1], 'chapter.md')
    expect(allowed.path).toBe('saved:chapter.md:1')
    const blocked = { preventDefault: vi.fn() }
    harness.session.downloadListeners[0]!(blocked, { getFilename: () => 'payload.exe', setSavePath: vi.fn() }, harness.windows[0]!.webContents)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(harness.showSaveDialog).toHaveBeenCalledOnce()
  })

  it('quits a secondary process without registering startup handlers or starting the backend', async () => {
    const harness = multiWindowHarness()
    const app = fakeApp(false)
    const lifecycle = createDesktopLifecycle(harness.deps)
    expect(claimPrimaryInstance(app, lifecycle)).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.whenReady).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
    expect(harness.counts()).toEqual({ starts: 0, stops: 0, supervisors: 0, windows: 0 })
    expect(harness.deploy).not.toHaveBeenCalled()
  })

  it('lets a primary second-instance event create a window after ready', async () => {
    const harness = multiWindowHarness()
    const app = fakeApp(true)
    const lifecycle = createDesktopLifecycle(harness.deps)
    expect(claimPrimaryInstance(app, lifecycle)).toBe(true)
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1))
    await vi.waitFor(() => expect(harness.windows[0]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    app.handlers.get('second-instance')![0]!()
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2))
    await vi.waitFor(() => expect(harness.windows[1]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 2 })
    const event = { preventDefault: vi.fn() }
    app.handlers.get('before-quit')![0]!(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(harness.counts().stops).toBe(1))
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
  })
})
