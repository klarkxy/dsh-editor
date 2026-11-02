import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({
  postSwapRetarget: false,
  swapStage: undefined as string | undefined,
  target: undefined as string | undefined,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  const sentinel = (root: string) => join(root, 'review-internal-link')
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      const result = await fs.rename(...args)
      if (faults.postSwapRetarget) {
        const source = String(args[0])
        const destination = String(args[1])
        if (source.includes('.dsh-editor.stage-') && /(?:^|[\\/])profiles[\\/]dsh-editor$/.test(destination)) {
          faults.swapStage = source
          faults.target = destination
        }
      }
      return result
    },
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      const result = await fs.lstat(...args)
      if (faults.postSwapRetarget && faults.target && String(args[0]) === sentinel(faults.target)) {
        return new Proxy(result, {
          get(object, prop) {
            return prop === 'isSymbolicLink' ? () => true : Reflect.get(object, prop)
          },
        })
      }
      return result
    },
    readlink: async (...args: Parameters<typeof fs.readlink>) => {
      if (faults.postSwapRetarget && faults.swapStage && faults.target && String(args[0]) === sentinel(faults.target)) {
        return join(faults.swapStage, 'review-link-target')
      }
      return fs.readlink(...args)
    },
    symlink: async (...args: Parameters<typeof fs.symlink>) => {
      if (faults.postSwapRetarget && faults.target && String(args[1]) === sentinel(faults.target)) {
        throw Object.assign(new Error('injected post-swap retarget failure'), { code: 'EPERM' })
      }
      return fs.symlink(...args)
    },
  }
})

import {
  PROFILE_CONFIG_PACKAGE,
  PROFILE_CONFIG_SPEC,
} from '../src/native-profile.js'
import {
  PROFILE_DEPLOY_ALGORITHM,
  PROFILE_MARKER,
  deployOwnedProfile,
  type ProfileDeployIdentity,
} from '../src/profile.js'

const optional = 'dsh-editor-cards'
const shipped = 'dsh-acceptance-shipped-new'
const baselineSpec = (name: string) => `link:./bundled-packages/node_modules/${name}`

describe('profile ownership restage', { timeout: 20_000 }, () => {
  afterEach(() => {
    faults.postSwapRetarget = false
    faults.swapStage = undefined
    faults.target = undefined
  })

  it('reuses current baseline/core/installed deps and does not require a removed optional', async () => {
    const { home, template, runtime, identity } = await ownershipFixture()
    const first = await deployOwnedProfile(home, template, runtime, identity)
    expect(first.reused).toBe(false)
    const profile = first.path
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    delete manifest.dependencies[optional]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== optional)
    await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const sentinel = join(profile, 'author-state.txt')
    await writeFile(sentinel, 'keep')
    const second = await deployOwnedProfile(home, template, runtime, identity)
    expect(second.reused).toBe(true)
    expect(await readFile(sentinel, 'utf8')).toBe('keep')
    expect(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).dependencies).not.toHaveProperty(optional)
  })

  it('loads the new default artifact and a user replacement, and writes generated config through the live link', async () => {
    const { home, template, runtime, identity } = await ownershipFixture()
    const first = await deployOwnedProfile(home, template, runtime, identity)
    const profile = first.path
    const replacement = join(profile, 'replacement-cards')
    await writePackage(replacement, optional, '9.9.9')
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[optional] = 'file:./replacement-cards'
    await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await rm(join(profile, 'node_modules', optional), { recursive: true, force: true })
    await cp(replacement, join(profile, 'node_modules', optional), { recursive: true })
    const upgraded = join(template, 'bundled-packages', 'node_modules', 'dsh-editor-shell')
    await writePackage(upgraded, 'dsh-editor-shell', '2.0.0')
    const restaged = await deployOwnedProfile(home, template, runtime)
    expect(restaged.reused).toBe(false)
    expect(JSON.parse(await readFile(join(restaged.path, 'node_modules', 'dsh-editor-shell', 'package.json'), 'utf8')).version).toBe('2.0.0')
    expect(JSON.parse(await readFile(join(restaged.path, 'node_modules', optional, 'package.json'), 'utf8')).version).toBe('9.9.9')
    expect((await lstat(join(restaged.path, 'node_modules', PROFILE_CONFIG_PACKAGE))).isSymbolicLink()).toBe(true)
    expect(await realpath(join(restaged.path, 'node_modules', PROFILE_CONFIG_PACKAGE))).toBe(await realpath(join(restaged.path, 'profile-config')))
    await writeFile(join(restaged.path, 'node_modules', PROFILE_CONFIG_PACKAGE, 'presets.patch.json'), '[{"insert":[{"id":"tools"}]}]\n')
    expect(await readFile(join(restaged.path, 'profile-config', 'presets.patch.json'), 'utf8')).toBe('[{"insert":[{"id":"tools"}]}]\n')
    expect((await lstat(join(restaged.path, 'node_modules', '@deepseek-ai'))).isSymbolicLink()).toBe(false)
    expect(await realpath(join(restaged.path, 'runtime-links', 'node_modules', '@deepseek-ai', 'dsh-tools'))).toBe(
      await realpath(join(runtime, '@deepseek-ai', 'dsh-tools')),
    )
  })

  it('rolls back profile and home when injected lock reconciliation fails, then retries', async () => {
    const { home, template, runtime, identity } = await ownershipFixture()
    const first = await deployOwnedProfile(home, template, runtime, identity)
    await writeFile(join(first.path, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .: {}\n')
    await writeFile(join(first.path, '.npmrc'), 'registry=https://registry.npmjs.org/\n')
    await writeFile(join(home, 'author-work.txt'), '保留稿件\n')
    await writeFile(join(home, 'dsh-plugins.json'), JSON.stringify({ schema: 1, overrides: {}, presets: {}, installed: [] }))
    const nextTemplate = join(home, 'next-template')
    await copyFixtureTemplate(template, nextTemplate)
    await writePackage(join(nextTemplate, 'bundled-packages', 'node_modules', shipped), shipped, '0.1.0')
    const nextBaseline = JSON.parse(await readFile(join(nextTemplate, 'composition.json'), 'utf8')) as {
      packages: string[]
      nativeDependencies: Record<string, string>
    }
    nextBaseline.packages.push(shipped)
    nextBaseline.nativeDependencies[shipped] = baselineSpec(shipped)
    await writeFile(join(nextTemplate, 'composition.json'), JSON.stringify(nextBaseline))
    const nextManifest = JSON.parse(await readFile(join(nextTemplate, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    nextManifest.dependencies[shipped] = baselineSpec(shipped)
    nextManifest.dsh.profile.bundles.push(shipped)
    await writeFile(join(nextTemplate, 'package.json'), JSON.stringify(nextManifest))
    const calls: unknown[] = []
    await expect(deployOwnedProfile(home, nextTemplate, runtime, undefined, {
      runPluginCommand: async (context, args, options) => {
        calls.push({ context, args, options })
        throw new Error('injected native op failed')
      },
    })).rejects.toThrow('injected native op failed')
    expect(JSON.parse(await readFile(join(first.path, 'package.json'), 'utf8')).dependencies).not.toHaveProperty(shipped)
    expect(await readFile(join(first.path, 'pnpm-lock.yaml'), 'utf8')).toBe('lockfileVersion: 9.0\nimporters:\n  .: {}\n')
    expect(await readFile(join(first.path, '.npmrc'), 'utf8')).toBe('registry=https://registry.npmjs.org/\n')
    expect(await readFile(join(home, 'author-work.txt'), 'utf8')).toBe('保留稿件\n')
    expect(existsSync(join(home, 'profiles', '.dsh-editor.stage'))).toBe(false)
    calls.length = 0
    const retried = await deployOwnedProfile(home, nextTemplate, runtime, undefined, {
      nodePath: process.execPath,
      runPluginCommand: async (context, args, options) => {
        calls.push({ context, args, activateNewBundles: options.activateNewBundles })
        return { exitCode: 0, output: 'ok' }
      },
    })
    expect(retried.reused).toBe(false)
    expect(JSON.parse(await readFile(join(retried.path, 'package.json'), 'utf8')).dependencies[shipped]).toBe(baselineSpec(shipped))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      args: ['install', '--lockfile-only', '--no-frozen-lockfile', '--offline', '--ignore-scripts'],
      activateNewBundles: false,
    })
    const context = (calls[0] as { context: { profile: string; dir: string; installAnchor: string } }).context
    expect(context.profile).toBe('dsh-editor')
    expect(context.installAnchor).toBe(join(home, 'runtime', 'package.json'))
    expect(context.dir).not.toBe(retried.path)
  })

  it('rolls back profile, home and presets when injected post-swap retarget fails, then retries', async () => {
    const { home, template, runtime, identity } = await ownershipFixture()
    await mkdir(join(template, 'agent-presets', 'dsh-editor-writing'), { recursive: true })
    await writeFile(join(template, 'agent-presets', 'dsh-editor-writing', 'preset.yml'), 'name: 原稿\n')
    await writeFile(join(template, 'agent-presets', 'dsh-editor-writing', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(template, 'agent-presets', 'dsh-editor-writing', PROFILE_MARKER), `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`)
    await writeFile(join(template, 'review-internal-link'), 'ordinary fixture file')
    await writeFile(join(template, 'review-link-target'), 'new artifact')
    const first = await deployOwnedProfile(home, template, runtime, identity)
    await writeFile(join(first.path, 'author-note.txt'), '保留作者注记\n')
    await writeFile(join(home, 'author-work.txt'), '保留稿件\n')
    await writeFile(join(home, 'dsh-plugins.json'), JSON.stringify({ schema: 1, overrides: {}, presets: {}, installed: [] }))
    await writeFile(join(home, '.agent-presets', 'dsh-editor-writing', 'author-preset-note.txt'), '保留预设\n')
    const nextTemplate = join(home, 'next-template')
    await copyFixtureTemplate(template, nextTemplate)
    const nextManifest = JSON.parse(await readFile(join(nextTemplate, 'package.json'), 'utf8')) as { name: string }
    nextManifest.name = 'next-profile'
    await writeFile(join(nextTemplate, 'package.json'), JSON.stringify(nextManifest))
    await writeFile(join(nextTemplate, 'restage-marker.txt'), 'next\n')
    try {
      faults.postSwapRetarget = true
      await expect(deployOwnedProfile(home, nextTemplate, runtime)).rejects.toMatchObject({
        message: 'injected post-swap retarget failure',
        code: 'EPERM',
      })
    } finally {
      faults.postSwapRetarget = false
      faults.swapStage = undefined
      faults.target = undefined
    }
    expect(JSON.parse(await readFile(join(first.path, 'package.json'), 'utf8')).name).toBe('dsh-editor-profile')
    expect(await readFile(join(first.path, 'author-note.txt'), 'utf8')).toBe('保留作者注记\n')
    expect(await readFile(join(home, 'author-work.txt'), 'utf8')).toBe('保留稿件\n')
    expect(await readFile(join(home, '.agent-presets', 'dsh-editor-writing', 'author-preset-note.txt'), 'utf8')).toBe('保留预设\n')
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toEqual({
      schema: 1, overrides: {}, presets: {}, installed: [],
    })
    const siblings = await readdir(join(home, 'profiles'))
    expect(siblings.filter((name) => name.includes('.backup-') || name.includes('.stage-'))).toEqual([])
    const retried = await deployOwnedProfile(home, nextTemplate, runtime)
    expect(retried.reused).toBe(false)
    expect(JSON.parse(await readFile(join(retried.path, 'package.json'), 'utf8')).name).toBe('next-profile')
    expect(await readFile(join(retried.path, 'restage-marker.txt'), 'utf8')).toBe('next\n')
    expect(await readFile(join(home, 'author-work.txt'), 'utf8')).toBe('保留稿件\n')
    expect(existsSync(join(home, '.agent-presets', 'dsh-editor-writing', 'preset.yml'))).toBe(true)
  })
})

async function ownershipFixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ownership-'))
  const template = join(home, 'template')
  const runtimeRoot = join(home, 'runtime')
  const runtime = join(runtimeRoot, 'node_modules')
  const baseline = {
    'dsh-editor-shell': baselineSpec('dsh-editor-shell'),
    [PROFILE_CONFIG_PACKAGE]: PROFILE_CONFIG_SPEC,
    [optional]: baselineSpec(optional),
  }
  await writePackage(join(template, 'bundled-packages', 'node_modules', 'dsh-editor-shell'), 'dsh-editor-shell', '1.0.0')
  await writePackage(join(template, 'bundled-packages', 'node_modules', optional), optional, '1.0.0')
  await mkdir(join(template, 'profile-config'), { recursive: true })
  await writeFile(join(template, 'profile-config', 'package.json'), JSON.stringify({
    name: PROFILE_CONFIG_PACKAGE, private: true, version: '1.0.0', dsh: { bundle: { patch: ['./base.patch.yml', './presets.patch.json'] } },
  }))
  await writeFile(join(template, 'profile-config', 'base.patch.yml'), '[]\n')
  await writeFile(join(template, 'profile-config', 'presets.patch.json'), '[]\n')
  await writeFile(join(template, 'package.json'), JSON.stringify({
    name: 'dsh-editor-profile',
    dependencies: baseline,
    dsh: { profile: { bundles: ['dsh-editor-shell', PROFILE_CONFIG_PACKAGE, optional] } },
  }))
  await writeFile(join(template, 'composition.json'), JSON.stringify({
    packages: ['dsh-editor-shell', optional],
    nativeDependencies: baseline,
  }))
  await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
  await mkdir(join(runtime, '@deepseek-ai', 'dsh-tools'), { recursive: true })
  await mkdir(join(runtime, '@deepseek-ai', 'dsh-llm'), { recursive: true })
  await writeFile(join(runtimeRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.5' }))
  const identity: ProfileDeployIdentity = {
    algorithm: PROFILE_DEPLOY_ALGORITHM,
    profileSha256: 'sha-ownership',
    dsh: '@deepseek-ai/dsh@0.2.1-rc.5',
    nodePath: join(home, 'node.exe'),
    cliPath: join(runtimeRoot, 'dsh', 'lib', 'bin.js'),
  }
  return { home, template, runtime, identity }
}

async function copyFixtureTemplate(source: string, dest: string): Promise<void> {
  await cp(source, dest, { recursive: true })
}

async function writePackage(dir: string, name: string, version: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
}
