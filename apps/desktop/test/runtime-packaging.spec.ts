import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { materializePackagedRuntime, runtimeFromResources, shouldMaterializePackagedRuntime } from '../src/runtime-cache.js'
import { copyRuntimeTree, treeDigest, treeMeasure } from '../src/runtime-tree.js'
import { prepareNodeRuntime } from '../../../scripts/prepare-node-runtime.mjs'

const faults = vi.hoisted(() => ({
  copy: undefined as Error | undefined,
  cleanup: undefined as Error | undefined,
  writing: undefined as Promise<void> | undefined,
  started: undefined as (() => void) | undefined,
  cleanupStarted: false,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    cp: async (...args: Parameters<typeof fs.cp>) => {
      if (basename(String(args[0])) === 'node' && faults.copy) throw faults.copy
      if (basename(String(args[0])) === 'dsh' && faults.writing) {
        faults.started?.()
        await faults.writing
      }
      return fs.cp(...args)
    },
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (basename(String(args[0])).startsWith('.dsh-editor-runtime.stage-')) {
        faults.cleanupStarted = true
        if (faults.cleanup) throw faults.cleanup
      }
      return fs.rm(...args)
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  faults.copy = faults.cleanup = undefined
  faults.writing = undefined
  faults.started = undefined
  faults.cleanupStarted = false
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })))
})

async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-test-'))
  roots.push(root)
  return root
}
async function fixture() {
  const root = await temporary()
  const resources = join(root, 'resources')
  const home = join(root, 'home')
  await mkdir(join(resources, 'node'), { recursive: true })
  await mkdir(join(resources, 'dsh', 'lib'), { recursive: true })
  await mkdir(join(resources, 'profile-template'), { recursive: true })
  await writeFile(join(resources, 'node', process.platform === 'win32' ? 'node.exe' : 'node'), 'node fixture')
  await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), 'dsh fixture')
  await writeFile(join(resources, 'profile-template', 'package.json'), '{}')
  const manifest = {
    format: 1,
    platform: `${process.platform}-${process.arch}`,
    node: { version: '24.16.0', ...await treeDigest(join(resources, 'node')) },
    dsh: { version: '0.1.7-rc.2', ...await treeDigest(join(resources, 'dsh')) },
    profile: await treeDigest(join(resources, 'profile-template')),
  }
  await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify(manifest))
  return { root, resources, home, manifest }
}

describe('desktop runtime packaging regressions (#1)', () => {
  it('uses the same regular-file inventory before and after copying', async () => {
    const { root, resources } = await fixture()
    const source = join(resources, 'dsh')
    const copied = join(root, 'copied')
    await copyRuntimeTree(source, copied)
    expect(await treeDigest(copied)).toEqual(await treeDigest(source))
    const digest = await treeDigest(source)
    expect(await treeMeasure(source)).toEqual({ files: digest.files, bytes: digest.bytes })
  })

  it.skipIf(process.platform === 'win32')('rejects valid and dangling links instead of silently omitting or following them', async () => {
    for (const target of ['bin.js', 'missing.js']) {
      const { root, resources, home } = await fixture()
      await symlink(target, join(resources, 'dsh', 'lib', 'linked.js'))
      await expect(treeDigest(join(resources, 'dsh'))).rejects.toThrow(/Symbolic links/)
      await expect(treeMeasure(join(resources, 'dsh'))).rejects.toThrow(/Symbolic links/)
      await expect(copyRuntimeTree(join(resources, 'dsh'), join(root, 'copy'))).rejects.toThrow(/Symbolic links/)
      for (let retry = 0; retry < 2; retry += 1) {
        await expect(materializePackagedRuntime(home, resources)).rejects.toThrow(/Symbolic links/)
        expect(await readdir(join(home, 'runtime'))).toEqual([])
      }
    }
  })

  it.skipIf(process.platform === 'win32')('rejects linked directories including a linked tree root', async () => {
    const { root, resources } = await fixture()
    const linked = join(root, 'linked')
    await symlink(join(resources, 'dsh'), linked, 'dir')
    await expect(treeDigest(linked)).rejects.toThrow(/Symbolic links/)
    await expect(copyRuntimeTree(linked, join(root, 'copy'))).rejects.toThrow(/Symbolic links/)
    await symlink('../dsh', join(resources, 'node', 'linked-directory'), 'dir')
    await expect(treeDigest(join(resources, 'node'))).rejects.toThrow(/Symbolic links/)
  })

  it('materializes once, reuses the cache and preserves the installed launch path', async () => {
    const { resources, home } = await fixture()
    const first = await materializePackagedRuntime(home, resources)
    expect(await materializePackagedRuntime(home, resources)).toEqual(first)
    expect(await readdir(join(home, 'runtime'))).toEqual(['dsh-editor-runtime'])
    expect(shouldMaterializePackagedRuntime({})).toBe(false)
    expect(shouldMaterializePackagedRuntime({ PORTABLE_EXECUTABLE_FILE: 'app.exe' })).toBe(true)
    expect(runtimeFromResources(resources).cliPath).toBe(join(resources, 'dsh', 'lib', 'bin.js'))
  })

  it('drains delayed sibling writers before reporting a copy failure or removing stage', async () => {
    const { home, resources } = await fixture()
    const original = Object.assign(new Error('original node copy failed'), { code: 'ENOENT' })
    faults.copy = original
    let release!: () => void
    faults.writing = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { faults.started = resolve })
    let settled = false
    const pending = materializePackagedRuntime(home, resources).catch((error) => { settled = true; return error })
    try {
      await started
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(faults.cleanupStarted).toBe(false)
    } finally {
      release()
    }
    expect(await pending).toBe(original)
    expect(faults.cleanupStarted).toBe(true)
    expect(await readdir(join(home, 'runtime'))).toEqual([])
  })

  it('retains the primary error and old runtime when stage cleanup also fails', async () => {
    const { resources, home, manifest } = await fixture()
    const previous = await materializePackagedRuntime(home, resources)
    const oldContent = await readFile(previous.cliPath, 'utf8')
    // Change the manifest key so this is a replacement attempt, not cache reuse.
    manifest.dsh.sha256 = 'f'.repeat(64)
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify(manifest))
    const original = Object.assign(new Error('primary copy error'), { code: 'ENOENT' })
    const cleanup = Object.assign(new Error('cleanup error'), { code: 'ENOTEMPTY' })
    faults.copy = original
    faults.cleanup = cleanup
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(materializePackagedRuntime(home, resources)).rejects.toBe(original)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('staging'), expect.any(String), cleanup)
    expect(await readFile(previous.cliPath, 'utf8')).toBe(oldContent)
  })

  it('rejects a manifest mismatch without leaving a partial cache', async () => {
    const { resources, home } = await fixture()
    await writeFile(join(resources, 'dsh', 'lib', 'extra.js'), 'not in manifest')
    await expect(materializePackagedRuntime(home, resources)).rejects.toThrow(/did not match/)
    expect(await readdir(join(home, 'runtime'))).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('bundles relocatable npm/npx launchers and their package instead of CI symlinks', async () => {
    const root = await temporary()
    const host = join(root, 'build-host')
    const npmRoot = join(host, 'lib', 'node_modules', 'npm')
    const output = join(root, 'relocated runtime')
    await mkdir(join(host, 'bin'), { recursive: true })
    await mkdir(join(npmRoot, 'bin'), { recursive: true })
    await mkdir(join(npmRoot, 'lib'), { recursive: true })
    await copyFile(process.execPath, join(host, 'bin', 'node'))
    await writeFile(join(npmRoot, 'package.json'), '{"name":"npm","version":"1.2.3"}')
    await writeFile(join(npmRoot, 'lib', 'value.js'), 'module.exports = "bundled dependency"')
    for (const name of ['npm', 'npx']) {
      await writeFile(join(npmRoot, 'bin', `${name}-cli.js`), 'console.log(JSON.stringify({ dependency: require("../lib/value.js"), node: process.execPath, args: process.argv.slice(2) }))')
      await symlink(join(npmRoot, 'bin', `${name}-cli.js`), join(host, 'bin', name))
    }
    await prepareNodeRuntime(output, join(host, 'bin', 'node'), 'darwin')
    await rm(host, { recursive: true, force: true })
    for (const name of ['npm', 'npx']) {
      expect((await lstat(join(output, name))).isSymbolicLink()).toBe(false)
      const probe = JSON.parse(execFileSync(join(output, name), ['--version', 'argument with spaces'], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } }))
      expect(probe).toEqual({ dependency: 'bundled dependency', node: await realpath(join(output, 'node')), args: ['--version', 'argument with spaces'] })
    }
    expect((await treeDigest(output)).files).toBe(7)
  }, 20_000)

  it('keeps Windows npm/npx command shims with their complete package', async () => {
    const root = await temporary()
    const host = join(root, 'host')
    const output = join(root, 'output')
    await mkdir(join(host, 'node_modules', 'npm', 'bin'), { recursive: true })
    await writeFile(join(host, 'node.exe'), 'node fixture')
    await writeFile(join(host, 'node_modules', 'npm', 'package.json'), '{"name":"npm"}')
    for (const name of ['npm', 'npx']) {
      await writeFile(join(host, `${name}.cmd`), `@"%~dp0node.exe" "%~dp0node_modules/npm/bin/${name}-cli.js" %*`)
      await writeFile(join(host, 'node_modules', 'npm', 'bin', `${name}-cli.js`), name)
    }
    await prepareNodeRuntime(output, join(host, 'node.exe'), 'win32')
    for (const name of ['npm', 'npx']) {
      expect(await readFile(join(output, `${name}.cmd`), 'utf8')).toContain('%~dp0node.exe')
      expect(await readFile(join(output, 'node_modules', 'npm', 'bin', `${name}-cli.js`), 'utf8')).toBe(name)
    }
    expect((await treeDigest(output)).files).toBe(6)
  })
})
