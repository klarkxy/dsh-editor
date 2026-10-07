import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isAllowedNavigation, parseDshWebUrl } from '../src/dsh-url.js';
import { clipboardWritePayload, isTrustedClipboardSender, readTrustedClipboardText, writeTrustedClipboardText } from '../src/clipboard.js';
import { PROFILE_DEPLOY_ALGORITHM, PROFILE_MARKER, deployProfile } from '../src/profile.js';
import { sanitizeHostLockedPluginOverrides } from '../src/user-plugins.js';
import { installNavigationPolicy, isAllowedExternalUrl } from '../src/navigation.js';
import { DshSupervisor } from '../src/supervisor.js';
import { hasPackagedRuntimeCache, materializePackagedRuntime, readProfileDeployIdentity, runtimeFromResources, shouldMaterializePackagedRuntime, treeDigest } from '../src/runtime-cache.js';
import { claimPrimaryInstance, createDesktopLifecycle, exportFileFilter, type DesktopLifecycleDeps, type EditorInput, type EditorWindow } from '../src/window-lifecycle.js';
import type { ChildLike } from '../src/contracts.js';

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
    node: { version: '26.10.0', ...node }, dsh: { version: '0.2.0-rc.2', ...dsh }, profile,
  }))
  return { root, resources }
}

describe('DSH URL trust root', () => {
  it('accepts only the exact DSH loopback readiness line', () => {
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823')?.href).toBe('http://127.0.0.1:41823/')
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823/?token=gHI0qXC8OK_Dj3IxxA-WS8vyyI1QwewJrWOKJWJHEmE')?.href)
      .toBe('http://127.0.0.1:41823/?token=gHI0qXC8OK_Dj3IxxA-WS8vyyI1QwewJrWOKJWJHEmE')
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823 (LAN: http://10.0.0.1:41823)')?.port).toBe('41823')
    for (const line of [
      'http://127.0.0.1:8080',
      'dsh web: http://localhost:8080',
      'dsh web: https://127.0.0.1:8080',
      'dsh web: http://127.0.0.1:8080/path',
      'dsh web: http://127.0.0.1:0',
      'dsh web: http://127.0.0.1:41823/?token=',
      'dsh web: http://127.0.0.1:41823/?token=bad/value',
      'dsh web: http://127.0.0.1:41823/?token=abc&extra=1',
      'dsh web: http://127.0.0.1:41823/?other=abc',
    ]) expect(parseDshWebUrl(line)).toBeUndefined()
  })
  it('does not allow origin spoofing or port changes', () => {
    const expected = new URL('http://127.0.0.1:41823/')
    expect(isAllowedNavigation('http://127.0.0.1:41823/settings', expected)).toBe(true)
    expect(isAllowedNavigation('http://127.0.0.1.evil.example:41823/', expected)).toBe(false)
    expect(isAllowedNavigation('http://127.0.0.1:41824/', expected)).toBe(false)
  })
})

describe('desktop clipboard IPC trust', () => {
  const expected = new URL('http://127.0.0.1:41823/')
  const trusted = {
    owned: true,
    destroyed: false,
    isMainFrame: true,
    url: 'http://127.0.0.1:41823/',
    expected,
  }

  it('accepts only an owned main frame on the expected DSH URL', () => {
    expect(isTrustedClipboardSender(trusted)).toBe(true)
    expect(isTrustedClipboardSender({ ...trusted, owned: false })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, destroyed: true })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, isMainFrame: false })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, expected: undefined })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, url: 'http://127.0.0.1:41824/' })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, url: 'https://evil.example/' })).toBe(false)
    expect(clipboardWritePayload('plain')).toBe('plain')
    expect(clipboardWritePayload({ html: '<b>' })).toBeUndefined()
  })

  it('reads and writes only after trust checks', () => {
    const store = { text: 'existing' }
    const api = {
      readText: () => store.text,
      writeText: (text: string) => { store.text = text },
    }
    expect(readTrustedClipboardText(api, trusted)).toBe('existing')
    writeTrustedClipboardText(api, trusted, 'next')
    expect(store.text).toBe('next')
    expect(() => writeTrustedClipboardText(api, { ...trusted, owned: false }, 'nope')).toThrow(/denied/)
    expect(store.text).toBe('next')
    expect(() => writeTrustedClipboardText(api, trusted, { html: 'x' })).toThrow(/string/)
  })

  it('rejects a silent clipboard write failure so cut cannot delete the manuscript', () => {
    const api = { readText: () => 'old', writeText: (_text: string) => {} }
    expect(() => writeTrustedClipboardText(api, trusted, 'new')).toThrow('clipboard write failed')
  })

  it('keeps navigation permission denial and exposes a narrow preload clipboard', async () => {
    const navigation = await readFile(join(import.meta.dirname, '..', 'src', 'navigation.ts'), 'utf8')
    const preload = await readFile(join(import.meta.dirname, '..', 'preload.cjs'), 'utf8')
    const main = await readFile(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
    expect(navigation).toContain('callback(false)')
    expect(navigation).not.toContain('clipboard')
    expect(preload).toContain("invoke('dsh-window:clipboard-read-text')")
    expect(preload).toContain("invoke('dsh-window:clipboard-write-text'")
    expect(main).toContain("'dsh-window:clipboard-read-text'")
    expect(main).toContain("'dsh-window:clipboard-write-text'")
  })

  it('wires renderer activity reporting through preload IPC', async () => {
    const preload = await readFile(join(import.meta.dirname, '..', 'preload.cjs'), 'utf8')
    const main = await readFile(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
    expect(preload).toContain("send('dsh-window:report-activity', activity)")
    expect(preload).toContain('reportActivity: (activity) =>')
    expect(main).toContain("'dsh-window:report-activity'")
    expect(main).toContain('isTrustedIpcSender(trust)')
    expect(main).toContain('busyContents.add(event.sender.id)')
    expect(main).toContain('busyContents.delete(contentsId)')
  })

  it('wires the startup error retry button through preload IPC', async () => {
    const preload = await readFile(join(import.meta.dirname, '..', 'preload.cjs'), 'utf8')
    const main = await readFile(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
    expect(main).toContain('data-dsh-startup-retry')
    expect(main).toContain('onclick="window.dshWindow.retry()"')
    expect(main).toContain('onclick="window.dshWindow.close()"')
    expect(main).toContain('>关闭</button>')
    expect(main).toContain("script-src 'unsafe-inline'")
    expect(main).not.toContain('dsh-editor://retry')
    expect(main).toContain("'dsh-window:retry'")
    expect(main).toContain("if (!trust.url.includes('data-dsh-startup-retry')) return")
    expect(preload).toContain("send('dsh-window:retry')")
    expect(preload).toContain('retry: () => ipcRenderer.send')
    expect(preload).toContain("send('dsh-window:close')")
  })
})

describe('desktop branding assets', () => {
  it('keeps the source icon, window icon, and Windows package icon wired together', async () => {
    const repo = join(import.meta.dirname, '..', '..', '..')
    const build = join(repo, 'apps', 'desktop', 'build')
    const [svg, mark, sourcePng, png, ico, mascot, shellMascot, main, loadingPage, preload, builder, afterPack, identity] = await Promise.all([
      readFile(join(build, 'icon.svg'), 'utf8'),
      readFile(join(build, 'icon-mark.svg'), 'utf8'),
      readFile(join(build, 'icon-source.png')),
      readFile(join(build, 'icon.png')),
      readFile(join(build, 'icon.ico')),
      readFile(join(build, 'mascot.webp')),
      readFile(join(repo, 'packages', 'dsh-editor-shell', 'src', 'client', 'assets', 'mascot.webp')),
      readFile(join(repo, 'apps', 'desktop', 'src', 'main.ts'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'src', 'loading-page.ts'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'preload.cjs'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'electron-builder.yml'), 'utf8'),
      readFile(join(repo, 'scripts', 'after-pack-desktop.cjs'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'src', 'app-identity.ts'), 'utf8'),
    ])
    expect(svg).toContain('<title>DSH Editor</title>')
    expect(svg).toContain('icon-source.png')
    expect(mark).toContain('<title>DSH Editor</title>')
    expect(mark).toContain('#1a7ff0')
    expect(sourcePng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(sourcePng.readUInt32BE(16)).toBe(1024)
    expect(sourcePng.readUInt32BE(20)).toBe(1024)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(png.equals(sourcePng)).toBe(true)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(7)
    expect(main).toContain("'icon.ico'")
    expect(main).toContain("'icon.png'")
    expect(main).toContain('setAppUserModelId')
    expect(main).toContain('shouldMaterializePackagedRuntime')
    expect(main).toContain('runtimeFromResources')
    expect(mascot.subarray(0, 4).toString()).toBe('RIFF')
    expect(mascot.equals(shellMascot)).toBe(true)
    expect(main).toContain("'mascot.webp'")
    expect(loadingPage).toContain('首次启动正在复制本地写作环境')
    expect(loadingPage).toContain('class="mascot"')
    expect(loadingPage).toContain("img-src data:")
    expect(loadingPage).not.toContain('class="mark"')
    expect(builder).toContain('- "build/mascot.webp"')
    expect(identity).toContain("com.dsh-editor.desktop")
    expect(builder).toContain('appId: com.dsh-editor.desktop')
    expect(builder).toContain('icon: build/icon.ico')
    expect(builder).toContain('installerIcon: build/icon.ico')
    expect(builder).toContain('- "build/icon.ico"')
    expect(builder).toContain('signAndEditExecutable: false')
    expect(afterPack).toContain("electron-winstaller/vendor/rcedit.exe")
    expect(afterPack).toContain('FileDescription')
    expect(afterPack).toContain('ProductName')
    // About / update page wiring: the renderer is locked behind a strict CSP
    // that blocks api.github.com, so the main process owns the round-trip and
    // the preload bridge exposes invoke-style methods.
    expect(main).toContain('if (!isAllowedExternalUrl(url)) return')
    expect(main).toContain("'dsh-window:get-app-info'")
    expect(main).toContain("'dsh-window:check-update'")
    // Startup check: same round-trip kicked off in the background at launch,
    // cached for the renderer to pull once its UI is up.
    expect(main).toContain("'dsh-window:startup-update'")
    expect(main).toContain('checkLatest(desktopVersion)')
    expect(main).toContain('readDesktopVersion')
    expect(main).not.toContain('version: app.getVersion()')
    expect(main).toContain('assertTrustedIpcSender')
    expect(main).toContain('updateIdFrom(payload)')
    expect(main).not.toContain('downloadUpdate(asset, event.sender)')
    expect(main).not.toContain('installUpdate(String(payload?.path')
    expect(preload).toContain("invoke('dsh-window:download-update', { updateId })")
    expect(preload).toContain("invoke('dsh-window:install-update', { updateId })")
    expect(preload).not.toContain('downloadUpdate: (asset)')
    expect(main).toContain('timeoutMs: 120_000')
    expect(main).toContain("join(process.env.DSH_HOME.trim(), 'electron-user-data')")
    expect(main).toContain("app.setName('dsh-editor-dev')")
  })
})

describe('persistent packaged runtime cache', () => {
  it('copies the packaged runtime only for portable executables', () => {
    expect(shouldMaterializePackagedRuntime({})).toBe(false)
    expect(shouldMaterializePackagedRuntime({ PORTABLE_EXECUTABLE_FILE: '  ' })).toBe(false)
    expect(shouldMaterializePackagedRuntime({ PORTABLE_EXECUTABLE_FILE: 'C:\\Apps\\DSH Editor.exe' })).toBe(true)
    const runtime = runtimeFromResources(join('D:', 'Program Files', 'DSH Editor', 'resources'))
    expect(runtime.cliPath).toBe(join('D:', 'Program Files', 'DSH Editor', 'resources', 'dsh', 'lib', 'bin.js'))
  })
  it('does not hash the runtime tree after copy or when the marker already matches', async () => {
    const source = await readFile(join(import.meta.dirname, '..', 'src', 'runtime-cache.ts'), 'utf8')
    expect(source).toContain('copyMatchesManifest')
    expect(source).toContain('treeMeasure')
    expect(source).toContain('cacheReady')
    expect(source).not.toContain('await treeDigest(')
    expect(source).not.toContain('await validate(')
  })
  it('reads profile deploy identity from the runtime manifest without hashing the template', async () => {
    const { resources } = await runtimeFixture()
    const identity = readProfileDeployIdentity(resources, { nodePath: 'n', cliPath: 'c' })
    expect(identity).toEqual({
      algorithm: PROFILE_DEPLOY_ALGORITHM,
      profileSha256: identity.profileSha256,
      dsh: '@deepseek-ai/dsh@0.2.0-rc.2',
      nodePath: 'n',
      cliPath: 'c',
    })
    expect(identity.profileSha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('copies and verifies the bundled runtime outside the portable extraction tree', async () => {
    const { root, resources } = await runtimeFixture()
    const runtime = await materializePackagedRuntime(join(root, 'home'), resources)
    expect(runtime.cliPath).toContain(join('home', 'runtime', 'dsh-editor-runtime'))
    expect(runtime.cliPath).not.toContain(resources)
    expect(await readFile(runtime.cliPath, 'utf8')).toBe('dsh-one')
    expect(existsSync(join(root, 'home', 'runtime', 'dsh-editor-runtime', '.dsh-editor-runtime.json'))).toBe(true)
    expect(hasPackagedRuntimeCache(join(root, 'home'))).toBe(true)
  })
  it('rejects a bundled runtime manifest built for a different platform', async () => {
    const { root, resources } = await runtimeFixture()
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
    ])
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
      format: 1, platform: 'unsupported-platform', node: { version: '26.10.0', ...node }, dsh: { version: '0.2.0-rc.2', ...dsh }, profile,
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
      format: 1, platform: `${process.platform}-${process.arch}`, node: { version: '26.10.0', ...node }, dsh: { version: '0.2.0-rc.2', ...dsh }, profile,
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
        format: 1, platform: `${process.platform}-${process.arch}`, node: { version: '26.10.0', ...node }, dsh: { version: '0.2.0-rc.2', ...dsh }, profile,
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
  function stubAnchor() {
    const created: Array<{ installAnchor: string; dispose: ReturnType<typeof vi.fn> }> = []
    const factory = vi.fn(async () => {
      const dispose = vi.fn(async () => undefined)
      const item = { installAnchor: `D:/anchor/${created.length}/package.json`, dispose }
      created.push(item)
      return item
    })
    return { factory, created }
  }
  it('waits for readiness and reports an unexpected post-ready exit', async () => {
    const child = new FakeChild()
    const unexpected = vi.fn()
    const anchor = stubAnchor()
    const supervisor = new DshSupervisor({ spawn: () => child, onUnexpectedExit: unexpected, createInstallAnchor: anchor.factory })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await expect(ready).resolves.toMatchObject({ port: '43111' })
    child.exit(23)
    expect(unexpected).toHaveBeenCalledOnce()
    expect(anchor.created[0]!.dispose).toHaveBeenCalledOnce()
  })
  it('starts DSH with an eval bootstrap that calls runCli and the pinned package manager', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const anchor = stubAnchor()
    const supervisor = new DshSupervisor({ spawn, createInstallAnchor: anchor.factory })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await expect(ready).resolves.toMatchObject({ port: '43111' })
    expect(spawn).toHaveBeenCalledOnce()
    const [command, args, options] = spawn.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }]
    expect(command).toBe('node.exe')
    expect(args[0]).toBe('--input-type=module')
    expect(args[1]).toBe('--eval')
    expect(args[2]).toContain('runCli')
    expect(args[2]).toContain('packageManager')
    expect(args[2]).toContain('pnpm@11.7.0')
    expect(args[2]).toMatch(/pnpm\.(mjs|cjs|js)/)
    expect(args[2]).not.toContain('npm_execpath')
    expect(args[2]).not.toContain('10.14.0')
    expect(args[2]).toContain('--profile')
    expect(args[2]).toContain('loadProfileDirectory')
    expect(args[2]).toContain('dsh-app-boot')
    expect(args[2]).toContain('resolvedProfile')
    expect(args[2]).toContain('D:/anchor/0/package.json')
    expect(args[2]).toContain(JSON.stringify(join('D:/home', 'profiles', 'dsh-editor')))
    expect(options.env.DSH_HOME).toBe('D:/home')
    expect(options.env.npm_execpath).toBeUndefined()
    expect(anchor.factory).toHaveBeenCalledWith(launch.cliPath)
  })
  it('includes DSH output when the child exits before readiness', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const anchor = stubAnchor()
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 1, createInstallAnchor: anchor.factory })
    const ready = supervisor.start({ ...launch, timeoutMs: 5_000 })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    child.stderr.write('dsh: plugin tree failed to load: editor-novel-kernel requires an explicit mode\n')
    child.exit(1)
    await expect(ready).rejects.toThrow(/exited before readiness[\s\S]*editor-novel-kernel requires an explicit mode/)
    expect(anchor.created[0]!.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a readiness timeout', async () => {
    const child = new FakeChild()
    const forceKillTree = vi.fn(async () => undefined)
    const anchor = stubAnchor()
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 1, createInstallAnchor: anchor.factory })
    await expect(supervisor.start(launch)).rejects.toThrow('Timed out waiting 25ms')
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
    expect(anchor.created[0]!.dispose).toHaveBeenCalledOnce()
  })
  it('uses graceful stop before exact process-tree fallback', async () => {
    const child = new FakeChild()
    const forceKillTree = vi.fn(async () => undefined)
    const anchor = stubAnchor()
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 1, createInstallAnchor: anchor.factory })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    await supervisor.stop()
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
    expect(anchor.created[0]!.dispose).toHaveBeenCalledOnce()
  })
  it('does not wait out the force-kill timeout when the child exits mid-taskkill', async () => {
    const child = new FakeChild()
    child.kill = (signal?: NodeJS.Signals | number) => { child.killedWith = signal; return true }
    const forceKillTree = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 60_000)))
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 5, createInstallAnchor: stubAnchor().factory })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    const stopped = supervisor.stop()
    setTimeout(() => child.exit(0), 20)
    await stopped
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
  })
  it('does not force-kill a child that exits during graceful shutdown', async () => {
    const child = new FakeChild()
    child.kill = (signal?: NodeJS.Signals | number) => { child.killedWith = signal; queueMicrotask(() => child.exit()); return true }
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 25, createInstallAnchor: stubAnchor().factory })
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
    const anchor = stubAnchor()
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 25, createInstallAnchor: anchor.factory })
    const ready = supervisor.start({ ...launch, timeoutMs: 5_000 })
    blocked.stdout.write('dsh web: http://127.0.0.1:6665\n')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    usable.stdout.write('dsh web: http://127.0.0.1:43112\n')
    await expect(ready).resolves.toMatchObject({ port: '43112' })
    expect(blocked.killedWith).toBe('SIGTERM')
    expect(anchor.factory).toHaveBeenCalledTimes(2)
    expect(anchor.created[0]!.dispose).toHaveBeenCalledOnce()
    expect(anchor.created[1]!.dispose).not.toHaveBeenCalled()
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
  const fatal = vi.fn()
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
    reportFatal: fatal,
    autoRestartDelayMs: 5,
  }
  return {
    session, windows, deps, deploy, fatal, showSaveDialog,
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

  it('leaves configurable new-window keys to the official shortcut adapter', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    const accepted = harness.windows[0]!.emitInput({ type: 'keyDown', key: 'N', control: true, shift: true, alt: false, meta: false })
    expect(accepted.preventDefault).not.toHaveBeenCalled()
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
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 1 })
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

  it('auto-restarts the backend once after an unexpected exit, then reports the next one as fatal', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    /* 第一次意外退出:自动重启一次,全部窗口经加载页回到编辑器。 */
    harness.unexpected()?.(new Error('DSH exited unexpectedly (code 23, signal none)'))
    await vi.waitFor(() => expect(harness.counts().starts).toBe(2))
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    })
    expect(harness.counts()).toEqual({ starts: 2, stops: 1, supervisors: 1, windows: 2 })
    expect(harness.deploy).toHaveBeenCalledTimes(2)
    expect(harness.fatal).not.toHaveBeenCalled()
    /* 复位窗口内第二次意外退出:错误页 + reportFatal,不再自动重启。 */
    harness.unexpected()?.(new Error('DSH exited unexpectedly (code 24, signal none)'))
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('error:DSH exited unexpectedly (code 24, signal none)')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('error:DSH exited unexpectedly (code 24, signal none)')
    })
    expect(harness.fatal).toHaveBeenCalledOnce()
    expect(harness.fatal.mock.calls[0]?.[1]).toBe('supervisor')
    expect(harness.counts().starts).toBe(2)
    /* 手动重试链不变:并发 retry 去重。 */
    void lifecycle.retry()
    void lifecycle.retry()
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    })
    expect(harness.counts()).toEqual({ starts: 3, stops: 2, supervisors: 1, windows: 2 })
    expect(harness.deploy).toHaveBeenCalledTimes(3)
  })

  it('retries a failed first start from the error page', async () => {
    const harness = multiWindowHarness()
    let fail = true
    harness.deps.createSupervisor = () => ({
      async start() {
        if (fail) throw new Error('backend missing')
        return new URL('http://127.0.0.1:43111/')
      },
      async stop() { /* first start never reached a running child */ },
    })
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    expect(harness.windows[0]!.loaded.at(-1)).toBe('error:backend missing')
    fail = false
    await lifecycle.retry()
    expect(harness.windows[0]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    expect(harness.windows[0]!.loaded).toEqual(['loading:', 'error:backend missing', 'loading:', 'http://127.0.0.1:43111/'])
  })

  it.each(['md', 'txt', 'docx', 'epub', 'DOCX', 'EPUB'])('routes %s exports to the initiating window and blocks executable downloads', async (extension) => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    expect(harness.session.downloadListeners).toHaveLength(1)
    const allowed = { path: undefined as string | undefined, getFilename: () => `chapter.${extension}`, setSavePath(path: string) { this.path = path } }
    harness.session.downloadListeners[0]!({ preventDefault: vi.fn() }, allowed, harness.windows[1]!.webContents)
    expect(harness.showSaveDialog).toHaveBeenCalledWith(harness.windows[1], `chapter.${extension}`)
    expect(allowed.path).toBe(`saved:chapter.${extension}:1`)
    const blocked = { preventDefault: vi.fn() }
    harness.session.downloadListeners[0]!(blocked, { getFilename: () => 'payload.exe', setSavePath: vi.fn() }, harness.windows[0]!.webContents)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(harness.showSaveDialog).toHaveBeenCalledOnce()
  })

  it('asks before quitting while a window reports busy AI work, and aborts on cancel', async () => {
    const harness = multiWindowHarness()
    const confirm = vi.fn(async () => false)
    harness.deps.confirmBusyQuit = confirm
    const app = fakeApp(true)
    const lifecycle = createDesktopLifecycle(harness.deps)
    expect(claimPrimaryInstance(app, lifecycle)).toBe(true)
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1))
    await vi.waitFor(() => expect(harness.windows[0]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    /* 取消:不 quit、不停后端;再次 quit 重新询问。 */
    const cancelled = { preventDefault: vi.fn() }
    app.handlers.get('before-quit')![0]!(cancelled)
    expect(cancelled.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(app.quit).not.toHaveBeenCalled()
    expect(harness.counts().stops).toBe(0)
    confirm.mockImplementation(async () => true)
    const confirmed = { preventDefault: vi.fn() }
    app.handlers.get('before-quit')![0]!(confirmed)
    await vi.waitFor(() => expect(harness.counts().stops).toBe(1))
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    expect(confirm).toHaveBeenCalledTimes(2)
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

describe('external repository links', () => {
  it('allows search provider signup URLs without allowing lookalike or unsafe URLs', () => {
    for (const url of [
      'https://platform.deepseek.com/api_keys', 'https://dashboard.exa.ai/api-keys',
      'https://api.search.brave.com', 'https://open.bochaai.com', 'https://serper.dev',
      'https://www.firecrawl.dev', 'https://app.tavily.com',
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(true)
      const parsed = new URL(url)
      expect(isAllowedExternalUrl(url.replace('https:', 'http:'))).toBe(false)
      expect(isAllowedExternalUrl(`https://${parsed.hostname}.evil.test${parsed.pathname}`)).toBe(false)
      expect(isAllowedExternalUrl(`https://user@${parsed.hostname}${parsed.pathname}`)).toBe(false)
      expect(isAllowedExternalUrl(`https://${parsed.hostname}:8443${parsed.pathname}`)).toBe(false)
    }
  })
  it('allows marketplace repos and existing help URLs but rejects other destinations', () => {
    expect(isAllowedExternalUrl('https://github.com/V1ki/dsh-plugin-subscriptions')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/klarkxy/dsh-editor/releases')).toBe(true)
    expect(isAllowedExternalUrl('https://developer.zhihu.com')).toBe(true)
    for (const url of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://user@github.com/a/b', 'https://github.com:8443/a/b', 'https://github.com/login', 'file:///tmp/x', 'javascript:alert(1)', null]) {
      expect(isAllowedExternalUrl(url)).toBe(false)
    }
  })
})

describe('Tavily integration upgrade', () => {
  it('retires the old bundle and managed entry with backups, preserving user data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tavily-upgrade-'))
    const template = join(home, 'template')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@klarkxy/dsh-web-search-manager'] } } }))
    const target = join(home, 'profiles', 'dsh-editor')
    await mkdir(join(target, 'node_modules', 'dsh-web-search-tavily'), { recursive: true })
    await writeFile(join(target, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    await writeFile(join(target, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@klarkxy/dsh-web-search-manager', 'dsh-web-search-tavily'] } } }))
    const source = join(home, 'user-plugins', 'dsh-web-search-tavily')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'dsh-web-search-tavily' }))
    const oldState = JSON.stringify({ schema: 1, overrides: { 'web-search-tavily': true, zhihu: false }, presets: { 'dsh-editor-novel': false }, installed: [{ name: 'dsh-web-search-tavily', spec: 'old-tavily', version: '0.1.0' }] })
    const oldPatch = '# managed-by: dsh-editor-plugins\n- id: web-search-tavily\n  disabled: false\n- id: zhihu\n  disabled: true\n'
    await writeFile(join(home, 'dsh-plugins.json'), oldState)
    await writeFile(join(home, 'cordis.patch.yml'), oldPatch)
    await writeFile(join(home, '.credentials.yaml'), 'fixture credentials remain byte-for-byte')
    const deployed = await deployProfile(home, template)
    expect(JSON.parse(await readFile(join(deployed, 'package.json'), 'utf8')).dsh.profile.bundles).toEqual(['@klarkxy/dsh-web-search-manager'])
    expect(existsSync(join(deployed, 'node_modules', 'dsh-web-search-tavily'))).toBe(false)
    expect(existsSync(join(source, 'package.json'))).toBe(true)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toMatchObject({ overrides: {}, presets: { 'dsh-editor-novel': false }, installed: [] })
    expect(await readFile(join(home, 'dsh-plugins.json.before-tavily-merge'), 'utf8')).toBe(oldState)
    expect(await readFile(join(home, 'cordis.patch.yml.before-tavily-merge'), 'utf8')).toBe(oldPatch)
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).not.toContain('web-search-tavily')
    expect(await readFile(join(home, '.credentials.yaml'), 'utf8')).toBe('fixture credentials remain byte-for-byte')
    await deployProfile(home, template)
    expect(await readFile(join(home, 'dsh-plugins.json.before-tavily-merge'), 'utf8')).toBe(oldState)
  })
})

describe('manuscript export save filters', () => {
  it.each([['md', 'Markdown'], ['txt', '纯文本'], ['docx', 'Word 文档'], ['epub', 'EPUB 电子书']]) ('preserves %s format in the native save dialog', (extension, name) => {
    expect(exportFileFilter(`作品.${extension.toUpperCase()}`)).toEqual({ name, extensions: [extension] })
  })
  it.each(['payload.exe', 'document.docx.exe', 'untitled', 'book.epub.bak']) ('does not offer a save filter for %s', (filename) => {
    expect(exportFileFilter(filename)).toBeUndefined()
  })
})

 describe('essential model service upgrade', () => {
  it('sanitizes managed off preference and preserves every other record and unmanaged patch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-builtin-models-'))
    const state = { schema: 1, overrides: { 'model-center': false, zhihu: false }, presets: { 'dsh-editor-article': false }, installed: [{ name: 'sample', spec: 'github:a/b', version: '1' }] }
    await writeFile(join(home, 'dsh-plugins.json'), JSON.stringify(state))
    await writeFile(join(home, 'cordis.patch.yml'), '# managed-by: dsh-editor-plugins\n- id: model-center\n  disabled: true\n- id: zhihu\n  disabled: true\n')
    await sanitizeHostLockedPluginOverrides(home)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toEqual({ ...state, overrides: { zhihu: false } })
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe('# managed-by: dsh-editor-plugins\n- id: zhihu\n  disabled: true\n')
    const manual = '- id: model-center\n  disabled: true\n- id: custom\n  config:\n    keep: true\n'
    await writeFile(join(home, 'cordis.patch.yml'), manual)
    await sanitizeHostLockedPluginOverrides(home)
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe(manual)
  })
})
