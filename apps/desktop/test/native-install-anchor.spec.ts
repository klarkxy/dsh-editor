import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeInstallAnchor } from '../src/native-install-anchor.js'
import { DshSupervisor } from '../src/supervisor.js'
import type { ChildLike } from '../src/contracts.js'

const APP = '@klarkxy/dsh-web-search-manager'
const SDK = '@deepseek-ai/dsh-app-boot'

const leftovers: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose().catch(() => undefined)
  await Promise.all(leftovers.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })))
})

function packageDir(root: string, name: string): string {
  return join(root, ...name.split('/'))
}

function packageFromAnchor(anchor: string, name: string): string | undefined {
  for (const search of createRequire(anchor).resolve.paths(name) ?? []) {
    const candidate = join(search, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
}

async function writePackage(dir: string, manifest: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`)
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-anchor-repo-'))
  leftovers.push(repo)
  const dshRoot = join(repo, 'runtime', 'dsh')
  const modules = join(dshRoot, 'node_modules')
  const profileDir = join(repo, 'home', 'profiles', 'dsh-editor')
  await writePackage(dshRoot, { name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', private: true })
  await mkdir(join(dshRoot, 'lib'), { recursive: true })
  await writeFile(join(dshRoot, 'lib', 'bin.js'), 'export async function runCli() {}\n')
  await writePackage(packageDir(modules, SDK), { name: SDK, version: '0.2.0-rc.2', identity: 'runtime-sdk' })
  await writePackage(packageDir(join(repo, 'node_modules'), APP), { name: APP, version: '0.0.0-repo-shadow' })
  await writePackage(profileDir, { name: 'dsh-editor', dsh: { profile: { bundles: [APP] } } })
  await writePackage(packageDir(join(profileDir, 'node_modules'), APP), { name: APP, version: '1.2.3-user-native' })
  return { repo, dshRoot, modules, profileDir, cliPath: join(dshRoot, 'lib', 'bin.js') }
}

class FakeChild extends EventEmitter implements ChildLike {
  pid = 8123
  exitCode: number | null = null
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill(): boolean { return true }
  exit(code = 0): void { this.exitCode = code; this.emit('exit', code, null) }
}

const launch = { nodePath: process.execPath, cliPath: 'dsh/lib/bin.js', home: 'D:/home', env: {}, timeoutMs: 5_000 }

function deferredFactory() {
  let deliver!: (anchor: { installAnchor: string; dispose: () => Promise<void> }) => void
  const dispose = vi.fn(async () => undefined)
  const factory = vi.fn(() => new Promise<{ installAnchor: string; dispose: () => Promise<void> }>((resolve) => {
    deliver = resolve
  }))
  return {
    factory,
    dispose,
    finish(installAnchor = 'D:/anchor/package.json') { deliver({ installAnchor, dispose }) },
  }
}

describe('createNativeInstallAnchor', () => {
  it('projects SDK node_modules outside repo ancestry and falls back to the profile replacement', async () => {
    const { repo, dshRoot, modules, profileDir, cliPath } = await fixture()
    const runtimeAnchor = join(dshRoot, 'package.json')
    expect(JSON.parse(await readFile(join(packageFromAnchor(runtimeAnchor, APP)!, 'package.json'), 'utf8')).version).toBe('0.0.0-repo-shadow')

    const created = await createNativeInstallAnchor(cliPath)
    disposers.push(created.dispose)
    const root = dirname(created.installAnchor)
    const insideRepo = relative(repo, root)
    expect(insideRepo === '' || (!insideRepo.startsWith('..') && !isAbsolute(insideRepo))).toBe(false)
    expect(JSON.parse(await readFile(created.installAnchor, 'utf8'))).toMatchObject({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' })
    expect((await lstat(join(root, 'node_modules'))).isSymbolicLink()).toBe(true)
    expect(await realpath(join(root, 'node_modules'))).toBe(await realpath(modules))

    expect(packageFromAnchor(created.installAnchor, APP)).toBeUndefined()
    const sdk = packageFromAnchor(created.installAnchor, SDK)
    expect(sdk).toBeTruthy()
    expect(JSON.parse(await readFile(join(sdk!, 'package.json'), 'utf8')).identity).toBe('runtime-sdk')
    expect(await realpath(sdk!)).toBe(await realpath(packageDir(modules, SDK)))

    const replacement = packageFromAnchor(join(profileDir, 'package.json'), APP)
    expect(JSON.parse(await readFile(join(replacement!, 'package.json'), 'utf8')).version).toBe('1.2.3-user-native')
    expect(packageFromAnchor(created.installAnchor, APP) ?? replacement).toBe(replacement)
  })

  it('disposes only its owned mkdtemp directory and is safe to call twice', async () => {
    const { cliPath } = await fixture()
    const created = await createNativeInstallAnchor(cliPath)
    const root = dirname(created.installAnchor)
    expect(existsSync(join(root, '.dsh-editor-native-install.json'))).toBe(true)
    await created.dispose()
    expect(existsSync(root)).toBe(false)
    await created.dispose()
  })

  it('leaves a directory without the owner marker in place', async () => {
    const { cliPath } = await fixture()
    const created = await createNativeInstallAnchor(cliPath)
    const root = dirname(created.installAnchor)
    leftovers.push(root)
    await unlink(join(root, '.dsh-editor-native-install.json'))
    await created.dispose()
    expect(existsSync(created.installAnchor)).toBe(true)
  })

  it('rejects a CLI path that has no runtime node_modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-anchor-missing-'))
    leftovers.push(root)
    await writePackage(root, { name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' })
    await mkdir(join(root, 'lib'), { recursive: true })
    await writeFile(join(root, 'lib', 'bin.js'), '')
    await expect(createNativeInstallAnchor(join(root, 'lib', 'bin.js'))).rejects.toThrow(/node_modules/)
  })
})

describe('supervisor native install anchor', () => {
  it('creates the TEMP anchor before spawn and removes it on stop', async () => {
    const { cliPath, repo } = await fixture()
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 1, forceKillTree: async () => undefined })
    const ready = supervisor.start({
      nodePath: process.execPath,
      cliPath,
      home: join(repo, 'home'),
      env: {},
      timeoutMs: 5_000,
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const evalSource = spawn.mock.calls[0]![1]![2] as string
    expect(evalSource).toContain('loadProfileDirectory')
    expect(evalSource).toContain('resolvedProfile')
    expect(evalSource).toContain('dsh-app-boot')
    const installAnchor = JSON.parse(evalSource.match(/installAnchor: (".*?")/s)![1]!) as string
    expect(existsSync(installAnchor)).toBe(true)
    expect(existsSync(join(dirname(installAnchor), '.dsh-editor-native-install.json'))).toBe(true)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    await supervisor.stop()
    expect(existsSync(dirname(installAnchor))).toBe(false)
  })

  it('refuses a concurrent start while the factory is pending', async () => {
    const spawn = vi.fn(() => new FakeChild())
    const deferred = deferredFactory()
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 1, forceKillTree: async () => undefined, createInstallAnchor: deferred.factory })
    const pending = supervisor.start(launch)
    await vi.waitFor(() => expect(deferred.factory).toHaveBeenCalledOnce())
    await expect(supervisor.start(launch)).rejects.toThrow('DSH is already running')
    await supervisor.stop()
    deferred.finish()
    await expect(pending).rejects.toThrow('DSH stopped')
    expect(spawn).not.toHaveBeenCalled()
    expect(deferred.dispose).toHaveBeenCalledOnce()
  })

  it('disposes the eventual anchor and never spawns when stopped while the factory is pending', async () => {
    const spawn = vi.fn(() => new FakeChild())
    const deferred = deferredFactory()
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 1, forceKillTree: async () => undefined, createInstallAnchor: deferred.factory })
    const pending = supervisor.start(launch)
    await vi.waitFor(() => expect(deferred.factory).toHaveBeenCalledOnce())
    await supervisor.stop()
    deferred.finish()
    await expect(pending).rejects.toThrow('DSH stopped')
    expect(spawn).not.toHaveBeenCalled()
    expect(deferred.dispose).toHaveBeenCalledOnce()
  })

  it('disposes the created anchor when spawn throws synchronously', async () => {
    const dispose = vi.fn(async () => undefined)
    const spawn = vi.fn(() => { throw new Error('spawn failed') })
    const supervisor = new DshSupervisor({
      spawn,
      gracefulStopMs: 1,
      forceKillTree: async () => undefined,
      createInstallAnchor: async () => ({ installAnchor: 'D:/anchor/package.json', dispose }),
    })
    await expect(supervisor.start(launch)).rejects.toThrow('spawn failed')
    expect(spawn).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    await expect(supervisor.start(launch)).rejects.toThrow('spawn failed')
    expect(dispose).toHaveBeenCalledTimes(2)
  })
})
