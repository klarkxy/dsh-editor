import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { syncDesktopDevPackage } from './sync-desktop-dev-package.mjs'

const homes = []
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true, maxRetries: 3 }) })

async function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

function lockPath(root, name) {
  return join(root, '.dev', 'desktop-sync-locks', encodeURIComponent(name))
}

async function expectReleasedLock(root, name) {
  const held = lockPath(root, name)
  expect(existsSync(held)).toBe(false)
  expect(existsSync(`${held}.lock`)).toBe(false)
}

function loadJs(file) {
  return import(pathToFileURL(file).href + `?t=${Date.now()}`).then((mod) => mod.default)
}

function spawnHelperSync(optionsPath) {
  const helperHref = pathToFileURL(fileURLToPath(new URL('./sync-desktop-dev-package.mjs', import.meta.url))).href
  const code = `
    import { readFile } from 'node:fs/promises'
    import { syncDesktopDevPackage } from ${JSON.stringify(helperHref)}
    const { name, ...options } = JSON.parse(await readFile(${JSON.stringify(optionsPath)}, 'utf8'))
    await syncDesktopDevPackage(name, options)
  `
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`sync child exited ${code}: ${stderr || stdout}`))
    })
  })
}

describe('desktop-dev package sync', () => {
  it('copies rebuilt lib into the template and owned profile artifact trees without touching native state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const removed = join(root, 'removed-profile')
    const unowned = join(root, 'unowned-profile')
    const outside = join(root, 'outside')
    const runtime = join(root, 'runtime')
    await writeTree(source, {
      'package.json': JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' }),
      'lib/index.js': 'export default "v2"\n',
      'cordis.patch.yml': '- id: app-pkg\n',
      'resources/note.md': 'shipped\n',
    })
    const oldPkg = JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' })
    const oldLib = 'export default "v1"\n'
    const marker = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`
    const baseline = { 'app-pkg': 'link:./bundled-packages/node_modules/app-pkg' }
    await writeTree(template, {
      'package.json': JSON.stringify({ name: 'dsh-editor-profile', dependencies: baseline }),
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': marker,
      'package.json': JSON.stringify({ name: 'dsh-editor-profile', dependencies: { ...baseline, 'user-pkg': 'npm:user-pkg@9.0.0' } }),
      'pnpm-lock.yaml': 'LOCK\n',
      'profile-config/package.json': '{"name":"dsh-editor-profile-config"}\n',
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/user-pkg/package.json': '{"name":"user-pkg","version":"9.0.0"}\n',
      'node_modules/user-pkg/index.js': 'export default "mine"\n',
    })
    await writeTree(removed, {
      '.dsh-editor-owner.json': marker,
      'package.json': JSON.stringify({ name: 'dsh-editor-profile', dependencies: {} }),
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
    })
    await writeTree(unowned, {
      'package.json': JSON.stringify({ name: 'dsh-editor-profile', dependencies: baseline }),
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/lib/index.js': oldLib,
    })
    await writeTree(outside, { 'app-pkg/lib/index.js': oldLib })
    await mkdir(runtime, { recursive: true })
    const composition = { packages: ['app-pkg'], libraries: [] }
    const logs = []
    const originalLog = console.log
    console.log = (...args) => { logs.push(args.join(' ')) }
    try {
      await syncDesktopDevPackage('app-pkg', {
        root, source, composition, wrapClient: false,
        templateRoot: template, profileRoot: owned, runtimeRoot: runtime,
      })
      await syncDesktopDevPackage('app-pkg', {
        root, source, composition, wrapClient: false,
        templateRoot: template, profileRoot: removed, runtimeRoot: runtime,
      })
      await syncDesktopDevPackage('app-pkg', {
        root, source, composition, wrapClient: false,
        templateRoot: template, profileRoot: unowned, runtimeRoot: runtime,
      })
    } finally {
      console.log = originalLog
    }
    expect(logs.filter((line) => line === 'desktop-dev-sync: app-pkg')).toHaveLength(3)
    expect(await loadJs(join(template, 'bundled-packages/node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(template, 'node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(owned, 'node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/cordis.patch.yml'), 'utf8')).toBe('- id: app-pkg\n')
    expect(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/resources/note.md'), 'utf8')).toBe('shipped\n')
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies).toEqual({
      'app-pkg': 'link:./bundled-packages/node_modules/app-pkg',
      'user-pkg': 'npm:user-pkg@9.0.0',
    })
    expect(await readFile(join(owned, 'pnpm-lock.yaml'), 'utf8')).toBe('LOCK\n')
    expect(await readFile(join(owned, 'profile-config/package.json'), 'utf8')).toBe('{"name":"dsh-editor-profile-config"}\n')
    expect(await readFile(join(owned, 'node_modules/user-pkg/index.js'), 'utf8')).toBe('export default "mine"\n')
    expect(await loadJs(join(removed, 'bundled-packages/node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(existsSync(join(removed, 'node_modules/app-pkg'))).toBe(false)
    expect(await readFile(join(unowned, 'bundled-packages/node_modules/app-pkg/lib/index.js'), 'utf8')).toBe(oldLib)
    expect(await readFile(join(unowned, 'node_modules/app-pkg/lib/index.js'), 'utf8')).toBe(oldLib)
    expect(await readFile(join(outside, 'app-pkg/lib/index.js'), 'utf8')).toBe(oldLib)
    await expectReleasedLock(root, 'app-pkg')
  }, 20_000)

  it('leaves user replacements and retargeted junctions in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-override-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const community = join(root, 'community', 'app-pkg')
    const runtime = join(root, 'runtime')
    await writeTree(source, {
      'package.json': JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' }),
      'lib/index.js': 'export default "v2"\n',
    })
    await writeTree(template, {
      'package.json': JSON.stringify({ dependencies: { 'app-pkg': 'link:./bundled-packages/node_modules/app-pkg' } }),
      'bundled-packages/node_modules/app-pkg/lib/index.js': 'export default "v1"\n',
      'node_modules/app-pkg/lib/index.js': 'export default "v1"\n',
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`,
      'package.json': JSON.stringify({ dependencies: { 'app-pkg': 'npm:app-pkg@9.0.0' } }),
      'bundled-packages/node_modules/app-pkg/lib/index.js': 'export default "v1"\n',
      'node_modules/app-pkg/lib/index.js': 'export default "mine"\n',
    })
    await writeTree(community, { 'lib/index.js': 'export default "community"\n' })
    await rm(join(template, 'node_modules', 'app-pkg'), { recursive: true, force: true })
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await symlink(community, join(template, 'node_modules', 'app-pkg'), process.platform === 'win32' ? 'junction' : 'dir')
    await mkdir(runtime, { recursive: true })
    const logs = []
    const originalLog = console.log
    console.log = (...args) => { logs.push(args.join(' ')) }
    try {
      await syncDesktopDevPackage('app-pkg', {
        root, source, composition: { packages: ['app-pkg'], libraries: [] }, wrapClient: false,
        templateRoot: template, profileRoot: owned, runtimeRoot: runtime,
      })
    } finally {
      console.log = originalLog
    }
    expect(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'), 'utf8')).toBe('export default "v2"\n')
    expect(await readFile(join(owned, 'node_modules/app-pkg/lib/index.js'), 'utf8')).toBe('export default "mine"\n')
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies['app-pkg']).toBe('npm:app-pkg@9.0.0')
    expect(await readFile(join(community, 'lib/index.js'), 'utf8')).toBe('export default "community"\n')
  })

  it('updates JS through the default owned node_modules junction without reprojecting the retained runtime spec', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-junction-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const runtime = join(root, 'runtime')
    const sdkPkg = JSON.stringify({ name: 'runtime-sdk', version: '1.0.0', type: 'module', main: './index.js' })
    await writeTree(source, {
      'package.json': JSON.stringify({
        name: 'app-pkg',
        version: '1.0.0',
        type: 'module',
        main: './lib/index.js',
        dependencies: { 'runtime-sdk': '^1.0.0' },
      }),
      'lib/index.js': "import { x } from 'runtime-sdk'\nexport default 'v2'\n",
      'node_modules/runtime-sdk/package.json': sdkPkg,
      'node_modules/runtime-sdk/index.js': 'export const x = 1\n',
    })
    const oldPkg = JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' })
    const oldLib = 'export default "v1"\n'
    const marker = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`
    const baseline = { 'app-pkg': 'link:./bundled-packages/node_modules/app-pkg' }
    const sdkFiles = {
      'runtime-links/node_modules/runtime-sdk/package.json': sdkPkg,
      'runtime-links/node_modules/runtime-sdk/index.js': 'export const x = 1\n',
    }
    await writeTree(template, {
      'package.json': JSON.stringify({ dependencies: baseline }),
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
      ...sdkFiles,
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': marker,
      'package.json': JSON.stringify({ dependencies: baseline }),
      'pnpm-lock.yaml': 'LOCK\n',
      'profile-config/package.json': '{"name":"dsh-editor-profile-config"}\n',
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      ...sdkFiles,
    })
    await writeTree(runtime, {
      'node_modules/runtime-sdk/package.json': sdkPkg,
      'node_modules/runtime-sdk/index.js': 'export const x = 1\n',
    })
    await mkdir(join(owned, 'node_modules'), { recursive: true })
    await symlink(
      join(owned, 'bundled-packages', 'node_modules', 'app-pkg'),
      join(owned, 'node_modules', 'app-pkg'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const originalLog = console.log
    console.log = () => {}
    try {
      await syncDesktopDevPackage('app-pkg', {
        root, source, composition: { packages: ['app-pkg'], libraries: [] }, wrapClient: false,
        templateRoot: template, profileRoot: owned, runtimeRoot: runtime,
      })
    } finally {
      console.log = originalLog
    }
    expect(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'), 'utf8')).toBe("import { x } from 'runtime-sdk'\nexport default 'v2'\n")
    expect(await readFile(join(owned, 'node_modules/app-pkg/lib/index.js'), 'utf8')).toBe("import { x } from 'runtime-sdk'\nexport default 'v2'\n")
    expect(await readFile(join(template, 'node_modules/app-pkg/lib/index.js'), 'utf8')).toBe("import { x } from 'runtime-sdk'\nexport default 'v2'\n")
    const retained = JSON.parse(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/package.json'), 'utf8'))
    expect(retained.dependencies['runtime-sdk']).toBe('link:../../../runtime-links/node_modules/runtime-sdk')
    const linked = resolve(join(owned, 'bundled-packages/node_modules/app-pkg'), retained.dependencies['runtime-sdk'].slice('link:'.length))
    expect(linked).toBe(resolve(owned, 'runtime-links/node_modules/runtime-sdk'))
    expect(existsSync(join(linked, 'package.json'))).toBe(true)
    expect((await lstat(join(owned, 'node_modules/app-pkg'))).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies).toEqual(baseline)
    expect(await readFile(join(owned, 'pnpm-lock.yaml'), 'utf8')).toBe('LOCK\n')
    expect(await readFile(join(owned, 'profile-config/package.json'), 'utf8')).toBe('{"name":"dsh-editor-profile-config"}\n')
  }, 20_000)

  it('leaves a retargeted junction inside the owned profile unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-internal-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const runtime = join(root, 'runtime')
    const local = join(owned, 'local-app-pkg')
    await writeTree(source, {
      'package.json': JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' }),
      'lib/index.js': 'export default "v2"\n',
    })
    const oldLib = 'export default "v1"\n'
    const baseline = { 'app-pkg': 'link:./bundled-packages/node_modules/app-pkg' }
    await writeTree(template, {
      'package.json': JSON.stringify({ dependencies: baseline }),
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/lib/index.js': oldLib,
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`,
      'package.json': JSON.stringify({ dependencies: baseline }),
      'pnpm-lock.yaml': 'LOCK\n',
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'local-app-pkg/lib/index.js': 'export default "internal"\n',
    })
    await mkdir(join(owned, 'node_modules'), { recursive: true })
    await symlink(local, join(owned, 'node_modules', 'app-pkg'), process.platform === 'win32' ? 'junction' : 'dir')
    await mkdir(runtime, { recursive: true })
    const originalLog = console.log
    console.log = () => {}
    try {
      await syncDesktopDevPackage('app-pkg', {
        root, source, composition: { packages: ['app-pkg'], libraries: [] }, wrapClient: false,
        templateRoot: template, profileRoot: owned, runtimeRoot: runtime,
      })
    } finally {
      console.log = originalLog
    }
    expect(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'), 'utf8')).toBe('export default "v2"\n')
    expect(await readFile(join(local, 'lib/index.js'), 'utf8')).toBe('export default "internal"\n')
    expect(await readFile(join(owned, 'node_modules/app-pkg/lib/index.js'), 'utf8')).toBe('export default "internal"\n')
    expect((await lstat(join(owned, 'node_modules/app-pkg'))).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies['app-pkg']).toBe(baseline['app-pkg'])
    expect(await readFile(join(owned, 'pnpm-lock.yaml'), 'utf8')).toBe('LOCK\n')
  }, 20_000)

  it('omits dsh-manuscript client autoactivation on template and live copies while the public source keeps it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-manuscript-'))
    homes.push(root)
    const source = join(root, 'source', 'dsh-manuscript')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const runtime = join(root, 'runtime')
    const sourceManifest = {
      name: 'dsh-manuscript',
      version: '1.0.0',
      type: 'module',
      main: './lib/index.js',
      exports: {
        '.': { import: './lib/index.js', default: './lib/index.js' },
        './client': { default: './lib/client.js' },
        './client/editor-core': { default: './lib/client-editor-core.cjs' },
      },
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-layout'] },
      },
    }
    await writeTree(source, {
      'package.json': `${JSON.stringify(sourceManifest, null, 2)}\n`,
      'lib/index.js': 'export default "host"\n',
      'cordis.patch.yml': '- id: manuscript\n',
    })
    const destPkg = JSON.stringify({ name: 'dsh-manuscript', version: '1.0.0' })
    const marker = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`
    const baseline = { 'dsh-manuscript': 'link:./bundled-packages/node_modules/dsh-manuscript' }
    await writeTree(template, {
      'package.json': JSON.stringify({ dependencies: baseline }),
      'bundled-packages/node_modules/dsh-manuscript/package.json': destPkg,
      'bundled-packages/node_modules/dsh-manuscript/lib/index.js': 'export default "old"\n',
      'node_modules/dsh-manuscript/package.json': destPkg,
      'node_modules/dsh-manuscript/lib/index.js': 'export default "old"\n',
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': marker,
      'package.json': JSON.stringify({ dependencies: baseline }),
      'bundled-packages/node_modules/dsh-manuscript/package.json': destPkg,
      'bundled-packages/node_modules/dsh-manuscript/lib/index.js': 'export default "old"\n',
      'node_modules/dsh-manuscript/package.json': destPkg,
      'node_modules/dsh-manuscript/lib/index.js': 'export default "old"\n',
    })
    await mkdir(runtime, { recursive: true })
    const originalLog = console.log
    console.log = () => {}
    try {
      await syncDesktopDevPackage('dsh-manuscript', {
        root, source, composition: { packages: ['dsh-manuscript'], libraries: [] }, wrapClient: false,
        templateRoot: template, profileRoot: owned, runtimeRoot: runtime,
      })
    } finally {
      console.log = originalLog
    }
    expect(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).dsh.client).toEqual(sourceManifest.dsh.client)
    for (const copy of [
      join(template, 'bundled-packages/node_modules/dsh-manuscript/package.json'),
      join(template, 'node_modules/dsh-manuscript/package.json'),
      join(owned, 'bundled-packages/node_modules/dsh-manuscript/package.json'),
      join(owned, 'node_modules/dsh-manuscript/package.json'),
    ]) {
      const pkg = JSON.parse(await readFile(copy, 'utf8'))
      expect(pkg.dsh.client).toBeUndefined()
      expect(pkg.dsh.bundle).toEqual(sourceManifest.dsh.bundle)
      expect(pkg.exports['./client']).toEqual(sourceManifest.exports['./client'])
      expect(pkg.exports['./client/editor-core']).toEqual(sourceManifest.exports['./client/editor-core'])
    }
  })

  it('is importable without auto-running and rejects names outside the composition', async () => {
    const helper = readFileSync(fileURLToPath(new URL('./sync-desktop-dev-package.mjs', import.meta.url)), 'utf8')
    expect(helper).toContain('process.execPath')
    expect(helper).toContain('wrap-client.mjs')
    expect(helper).toContain('isDirectRun()')
    expect(helper).toContain('proper-lockfile')
    expect(helper).toContain('desktop-sync-locks')
    expect(helper).toContain('encodeURIComponent(name)')
    expect(helper).toContain('realpath: false')
    expect(helper).toContain('stale: 10_000')
    expect(helper).toContain('update: 1_000')
    expect(helper).toContain('retries: 600')
    expect(helper).toContain('factor: 1')
    expect(helper).toContain('minTimeout: 100')
    expect(helper).toContain('maxTimeout: 100')
    expect(helper).toContain('maxRetries: 5')
    expect(helper).toContain('retryDelay: 100')
    expect(helper).not.toContain('PromiseQueue')
    await expect(syncDesktopDevPackage('../escape', {
      composition: { packages: ['app-pkg'], libraries: [] }, wrapClient: false,
    })).rejects.toThrow(/invalid package name/)
    await expect(syncDesktopDevPackage('community-pkg', {
      composition: { packages: ['app-pkg'], libraries: [] }, wrapClient: false,
    })).rejects.toThrow(/not in the selected composition/)
  })

  it('serializes independently spawned helper processes for the same package and root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-mp-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const runtime = join(root, 'runtime')
    const libFiles = Object.fromEntries([
      ['lib/index.js', 'export default "v2"\n'],
      ['lib/client.js', 'export default "v2-client"\n'],
      ...Array.from({ length: 3 }, (_, i) => [`lib/chunk-${i}.js`, `export const chunk${i} = ${i}\n`]),
    ])
    await writeTree(source, {
      'package.json': JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' }),
      ...libFiles,
      'cordis.patch.yml': '- id: app-pkg\n',
      'resources/note.md': 'shipped\n',
    })
    const oldPkg = JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' })
    const oldLib = 'export default "v1"\n'
    const marker = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`
    const baseline = { 'app-pkg': 'link:./bundled-packages/node_modules/app-pkg' }
    await writeTree(template, {
      'package.json': JSON.stringify({ name: 'dsh-editor-profile', dependencies: baseline }),
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': marker,
      'package.json': JSON.stringify({ name: 'dsh-editor-profile', dependencies: { ...baseline, 'user-pkg': 'npm:user-pkg@9.0.0' } }),
      'pnpm-lock.yaml': 'LOCK\n',
      'profile-config/package.json': '{"name":"dsh-editor-profile-config"}\n',
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/user-pkg/package.json': '{"name":"user-pkg","version":"9.0.0"}\n',
      'node_modules/user-pkg/index.js': 'export default "mine"\n',
    })
    await mkdir(runtime, { recursive: true })
    const optionsPath = join(root, 'sync-options.json')
    await writeFile(optionsPath, JSON.stringify({
      name: 'app-pkg',
      root,
      source,
      composition: { packages: ['app-pkg'], libraries: [] },
      wrapClient: false,
      templateRoot: template,
      profileRoot: owned,
      runtimeRoot: runtime,
    }))
    const outputs = await Promise.all([
      spawnHelperSync(optionsPath),
      spawnHelperSync(optionsPath),
      spawnHelperSync(optionsPath),
    ])
    for (const stdout of outputs) {
      expect(stdout).toContain('desktop-dev-sync: app-pkg')
    }
    expect(await loadJs(join(template, 'bundled-packages/node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(template, 'node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(owned, 'node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(owned, 'bundled-packages/node_modules/app-pkg/lib/client.js'))).toBe('v2-client')
    for (const copy of [
      join(template, 'bundled-packages/node_modules/app-pkg/package.json'),
      join(template, 'node_modules/app-pkg/package.json'),
      join(owned, 'bundled-packages/node_modules/app-pkg/package.json'),
      join(owned, 'node_modules/app-pkg/package.json'),
    ]) {
      expect(JSON.parse(await readFile(copy, 'utf8'))).toMatchObject({
        name: 'app-pkg',
        version: '1.0.0',
        main: './lib/index.js',
      })
    }
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies).toEqual({
      'app-pkg': 'link:./bundled-packages/node_modules/app-pkg',
      'user-pkg': 'npm:user-pkg@9.0.0',
    })
    expect(await readFile(join(owned, 'pnpm-lock.yaml'), 'utf8')).toBe('LOCK\n')
    expect(await readFile(join(owned, 'profile-config/package.json'), 'utf8')).toBe('{"name":"dsh-editor-profile-config"}\n')
    expect(await readFile(join(owned, 'node_modules/user-pkg/index.js'), 'utf8')).toBe('export default "mine"\n')
    await expectReleasedLock(root, 'app-pkg')
  }, 20_000)

  it('releases the lock and does not print success when a copy fails, then retries cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-dev-sync-fail-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const template = join(root, 'template')
    const owned = join(root, 'owned-profile')
    const runtime = join(root, 'runtime')
    await writeTree(source, {
      'package.json': JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' }),
    })
    const oldPkg = JSON.stringify({ name: 'app-pkg', version: '1.0.0', type: 'module', main: './lib/index.js' })
    const oldLib = 'export default "v1"\n'
    const marker = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`
    const baseline = { 'app-pkg': 'link:./bundled-packages/node_modules/app-pkg' }
    await writeTree(template, {
      'package.json': JSON.stringify({ dependencies: baseline }),
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
    })
    await writeTree(owned, {
      '.dsh-editor-owner.json': marker,
      'package.json': JSON.stringify({ dependencies: { ...baseline, 'user-pkg': 'npm:user-pkg@9.0.0' } }),
      'pnpm-lock.yaml': 'LOCK\n',
      'profile-config/package.json': '{"name":"dsh-editor-profile-config"}\n',
      'bundled-packages/node_modules/app-pkg/package.json': oldPkg,
      'bundled-packages/node_modules/app-pkg/lib/index.js': oldLib,
      'node_modules/app-pkg/package.json': oldPkg,
      'node_modules/app-pkg/lib/index.js': oldLib,
    })
    await mkdir(runtime, { recursive: true })
    const options = {
      root, source, composition: { packages: ['app-pkg'], libraries: [] }, wrapClient: false,
      templateRoot: template, profileRoot: owned, runtimeRoot: runtime,
    }
    const logs = []
    const originalLog = console.log
    console.log = (...args) => { logs.push(args.join(' ')) }
    try {
      await expect(syncDesktopDevPackage('app-pkg', options)).rejects.toThrow(/Missing artifact/)
    } finally {
      console.log = originalLog
    }
    expect(logs.filter((line) => line === 'desktop-dev-sync: app-pkg')).toHaveLength(0)
    expect(await readFile(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'), 'utf8')).toBe(oldLib)
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies).toEqual({
      'app-pkg': 'link:./bundled-packages/node_modules/app-pkg',
      'user-pkg': 'npm:user-pkg@9.0.0',
    })
    await expectReleasedLock(root, 'app-pkg')
    await writeTree(source, { 'lib/index.js': 'export default "v2"\n' })
    const retryLogs = []
    console.log = (...args) => { retryLogs.push(args.join(' ')) }
    try {
      await syncDesktopDevPackage('app-pkg', options)
    } finally {
      console.log = originalLog
    }
    expect(retryLogs.filter((line) => line === 'desktop-dev-sync: app-pkg')).toHaveLength(1)
    expect(await loadJs(join(owned, 'bundled-packages/node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(await loadJs(join(owned, 'node_modules/app-pkg/lib/index.js'))).toBe('v2')
    expect(JSON.parse(await readFile(join(owned, 'package.json'), 'utf8')).dependencies['user-pkg']).toBe('npm:user-pkg@9.0.0')
    await expectReleasedLock(root, 'app-pkg')
  }, 20_000)
})
