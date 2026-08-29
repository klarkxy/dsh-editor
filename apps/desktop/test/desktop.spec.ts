import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isAllowedNavigation, parseDshWebUrl } from '../src/dsh-url.js'
import { PROFILE_MARKER, ProfileCollisionError, deployProfile, resolveDshHome } from '../src/profile.js'
import { installNavigationPolicy } from '../src/navigation.js'
import { DshSupervisor } from '../src/supervisor.js'
import { materializePackagedRuntime, treeDigest } from '../src/runtime-cache.js'
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

async function runtimeFixture(version = 'one'): Promise<{ root: string; resources: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'))
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'node'), { recursive: true })
  await mkdir(join(resources, 'dsh', 'lib'), { recursive: true })
  await mkdir(join(resources, 'profile-template'), { recursive: true })
  await writeFile(join(resources, 'node', 'node.exe'), `node-${version}`)
  await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), `dsh-${version}`)
  await writeFile(join(resources, 'profile-template', 'package.json'), `{"version":"${version}"}`)
  const [node, dsh, profile] = await Promise.all([
    treeDigest(join(resources, 'node')),
    treeDigest(join(resources, 'dsh')),
    treeDigest(join(resources, 'profile-template')),
  ])
  await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
    format: 1, platform: 'win32-x64',
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
  })
})

describe('profile deployment', () => {
  it('honors DSH_HOME before the conventional home directory', () => {
    expect(resolveDshHome({ DSH_HOME: 'D:/custom' }, 'D:/Users/example')).toBe('D:/custom')
    expect(resolveDshHome({}, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh'))
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
  it('atomically replaces an owned cache when the bundled manifest changes', async () => {
    const { root, resources } = await runtimeFixture('one')
    const home = join(root, 'home')
    await materializePackagedRuntime(home, resources)
    await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), 'dsh-two')
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
    ])
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
      format: 1, platform: 'win32-x64', node: { version: '24.16.0', ...node }, dsh: { version: '0.1.1-rc.2', ...dsh }, profile,
    }))
    const runtime = await materializePackagedRuntime(home, resources)
    expect(await readFile(runtime.cliPath, 'utf8')).toBe('dsh-two')
    expect((await (await import('node:fs/promises')).readdir(join(home, 'runtime'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('never replaces an unowned runtime cache path', async () => {
    const { root, resources } = await runtimeFixture()
    const target = join(root, 'home', 'runtime', 'dsh-editor-runtime')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'user-file.txt'), 'do not touch')
    await expect(materializePackagedRuntime(join(root, 'home'), resources)).rejects.toThrow('unowned desktop runtime cache')
    expect(await readFile(join(target, 'user-file.txt'), 'utf8')).toBe('do not touch')
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
})

describe('BrowserWindow policy', () => {
  it('blocks popups, permissions, and non-DSH navigation', () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let popup: (() => { action: 'deny' }) | undefined
    let permission: ((_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void) | undefined
    installNavigationPolicy({
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
  })
})
