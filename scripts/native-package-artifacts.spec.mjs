import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { copyNativePackageArtifact, projectNativePackageManifest } from './native-package-artifacts.mjs'

const homes = []
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }) })

async function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

describe('native package artifacts', () => {
  it('projects workspace file siblings, runtime SDK links, peers, and omits bundled client deps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-artifacts-'))
    homes.push(root)
    const source = join(root, 'source', 'app-pkg')
    const destination = join(root, 'dest', 'app-pkg')
    const workspace = join(root, 'dest', 'workspace-pkg')
    const chunkDep = join(root, 'dest', 'chunk-dep')
    const runtimeSdk = join(root, 'runtime', 'runtime-sdk')
    const dynamicPkg = join(root, 'runtime', 'dynamic-pkg')
    const subpathPkg = join(root, 'runtime', 'subpath-pkg')
    const requiredPkg = join(root, 'runtime', 'required-pkg')
    const original = JSON.stringify({
      name: 'app-pkg',
      version: '1.2.3',
      type: 'module',
      main: './lib/index.js',
      exports: {
        '.': { types: './lib/index.d.ts', browser: './lib/client.js', import: './lib/index.js' },
        './sub': { types: './lib/sub.d.ts', import: './lib/sub.js' },
        './cjs': { require: './lib/legacy.cjs', default: './lib/legacy.cjs' },
        './dual': { types: './lib/dual.d.ts', import: './lib/dual.mjs', require: './lib/dual.cjs' },
        './types': { types: './lib/index.d.ts' },
        './locale/*.json': './locale/*.json',
        './data.json': './lib/data.json',
        './client': { default: './lib/client.js' },
        './client/extra': { default: './lib/client.js' },
        './package.json': './package.json',
      },
      files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inject: ['@deepseek-ai/dsh-client-connection'] } },
      dependencies: {
        'workspace-pkg': 'workspace:*',
        'chunk-dep': 'workspace:*',
        'runtime-sdk': '^1.0.0',
        react: '^18.2.0',
      },
      devDependencies: { typescript: '^5.9.2' },
      optionalDependencies: { esbuild: '^0.25.0' },
      peerDependencies: { 'runtime-sdk': '^1.0.0', 'optional-peer': '^2.0.0' },
      peerDependenciesMeta: { 'optional-peer': { optional: true } },
    }, null, 2) + '\n'
    await writeTree(source, {
      'package.json': original,
      'cordis.patch.yml': '[]\n',
      'lib/index.js': [
        "import { ok } from 'workspace-pkg'",
        "import './chunk.js'",
        "export { n } from './chunk.js'",
        "import { x } from 'runtime-sdk'",
        "import sub from 'subpath-pkg/utils'",
        "const ignored = \"import 'react'\"",
        "// import 'commented-pkg'",
        "export async function load() { return import('dynamic-pkg') }",
        'export { ok, x, sub }',
      ].join('\n'),
      'lib/chunk.js': "import 'chunk-dep'\nexport const n = 1\n",
      'lib/sub.js': 'export const subEntry = true\n',
      'lib/legacy.cjs': "require('required-pkg')\nmodule.exports = {}\n",
      'lib/dual.mjs': "import 'dual-import-pkg'\nexport default 1\n",
      'lib/dual.cjs': "require('dual-require-pkg')\nmodule.exports = 1\n",
      'lib/data.json': '{"ok":true}\n',
      'locale/zh.json': '{"title":"ok"}\n',
      'lib/client.js': "import React from 'react'\nexport const ui = React\n",
      'src/index.ts': 'should not copy',
      'lib/index.js.map': '{"version":3}',
    })
    await writeTree(join(source, 'node_modules'), {
      'workspace-pkg/package.json': '{"name":"workspace-pkg","type":"module"}\n',
      'workspace-pkg/index.js': 'export const ok = "workspace"\n',
      'chunk-dep/package.json': '{"name":"chunk-dep","type":"module"}\n',
      'chunk-dep/index.js': 'export {}\n',
      'runtime-sdk/package.json': '{"name":"runtime-sdk","type":"module"}\n',
      'runtime-sdk/index.js': 'export const x = 1\n',
      'dynamic-pkg/package.json': '{"name":"dynamic-pkg","type":"module"}\n',
      'dynamic-pkg/index.js': 'export default "dynamic"\n',
      'subpath-pkg/package.json': '{"name":"subpath-pkg","type":"module","exports":{"./utils":"./utils.js"}}\n',
      'subpath-pkg/utils.js': 'export default "utils"\n',
      'required-pkg/package.json': '{"name":"required-pkg"}\n',
      'required-pkg/index.js': 'module.exports = {}\n',
      'dual-import-pkg/package.json': '{"name":"dual-import-pkg","type":"module"}\n',
      'dual-import-pkg/index.js': 'export default 1\n',
      'dual-require-pkg/package.json': '{"name":"dual-require-pkg"}\n',
      'dual-require-pkg/index.js': 'module.exports = 1\n',
      'react/package.json': '{"name":"react"}\n',
      'react/index.js': 'export default {}\n',
    })
    await writeTree(workspace, { 'package.json': '{"name":"workspace-pkg","type":"module"}\n', 'index.js': 'export const ok = "workspace"\n' })
    await writeTree(chunkDep, { 'package.json': '{"name":"chunk-dep","type":"module"}\n', 'index.js': 'export {}\n' })
    await writeTree(runtimeSdk, { 'package.json': '{"name":"runtime-sdk","type":"module"}\n', 'index.js': 'export const x = 1\n' })
    await writeTree(dynamicPkg, { 'package.json': '{"name":"dynamic-pkg","type":"module"}\n', 'index.js': 'export default "dynamic"\n' })
    await writeTree(subpathPkg, { 'package.json': '{"name":"subpath-pkg","type":"module","exports":{"./utils":"./utils.js"}}\n', 'utils.js': 'export default "utils"\n' })
    await writeTree(requiredPkg, { 'package.json': '{"name":"required-pkg"}\n', 'index.js': 'module.exports = {}\n' })
    const dualImportPkg = join(root, 'runtime', 'dual-import-pkg')
    const dualRequirePkg = join(root, 'runtime', 'dual-require-pkg')
    await writeTree(dualImportPkg, { 'package.json': '{"name":"dual-import-pkg","type":"module"}\n', 'index.js': 'export default 1\n' })
    await writeTree(dualRequirePkg, { 'package.json': '{"name":"dual-require-pkg"}\n', 'index.js': 'module.exports = 1\n' })

    const artifacts = { 'workspace-pkg': workspace, 'chunk-dep': chunkDep }
    const runtimes = {
      'runtime-sdk': runtimeSdk,
      'dynamic-pkg': dynamicPkg,
      'subpath-pkg': subpathPkg,
      'required-pkg': requiredPkg,
      'dual-import-pkg': dualImportPkg,
      'dual-require-pkg': dualRequirePkg,
    }
    const projected = await copyNativePackageArtifact({ source, destination, artifacts, runtimes })

    expect(await readFile(join(source, 'package.json'), 'utf8')).toBe(original)
    expect(existsSync(join(destination, 'src'))).toBe(false)
    expect(existsSync(join(destination, 'node_modules'))).toBe(false)
    expect(existsSync(join(destination, 'lib/index.js.map'))).toBe(false)
    expect(await readFile(join(destination, 'cordis.patch.yml'), 'utf8')).toBe('[]\n')
    expect(projected.name).toBe('app-pkg')
    expect(projected.version).toBe('1.2.3')
    expect(projected.type).toBe('module')
    expect(projected.exports['./client']).toEqual({ default: './lib/client.js' })
    expect(projected.dsh.client.inject).toEqual(['@deepseek-ai/dsh-client-connection'])
    expect(projected.peerDependencies).toEqual({ 'runtime-sdk': '^1.0.0', 'optional-peer': '^2.0.0' })
    expect(projected.peerDependenciesMeta).toEqual({ 'optional-peer': { optional: true } })
    expect(projected.devDependencies).toBeUndefined()
    expect(projected.optionalDependencies).toBeUndefined()
    expect(projected.dependencies).toEqual({
      'chunk-dep': 'file:../chunk-dep',
      'dual-import-pkg': expect.stringMatching(/^link:.*\/dual-import-pkg$/),
      'dual-require-pkg': expect.stringMatching(/^link:.*\/dual-require-pkg$/),
      'dynamic-pkg': expect.stringMatching(/^link:.*\/dynamic-pkg$/),
      'required-pkg': expect.stringMatching(/^link:.*\/required-pkg$/),
      'runtime-sdk': expect.stringMatching(/^link:.*\/runtime-sdk$/),
      'subpath-pkg': expect.stringMatching(/^link:.*\/subpath-pkg$/),
      'workspace-pkg': 'file:../workspace-pkg',
    })
    expect(projected.dependencies.react).toBeUndefined()
    expect(projected.dependencies['commented-pkg']).toBeUndefined()
    expect(projected.dependencies['optional-peer']).toBeUndefined()

    const modules = join(destination, 'node_modules')
    await mkdir(modules, { recursive: true })
    const kind = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(workspace, join(modules, 'workspace-pkg'), kind)
    await symlink(chunkDep, join(modules, 'chunk-dep'), kind)
    await symlink(runtimeSdk, join(modules, 'runtime-sdk'), kind)
    await symlink(dynamicPkg, join(modules, 'dynamic-pkg'), kind)
    await symlink(subpathPkg, join(modules, 'subpath-pkg'), kind)
    const loaded = await import(pathToFileURL(join(destination, 'lib/index.js')).href)
    expect(loaded.ok).toBe('workspace')
    expect(loaded.n).toBe(1)
    expect(loaded.x).toBe(1)
    expect(loaded.sub).toBe('utils')
    expect((await loaded.load()).default).toBe('dynamic')
  })

  it('fails clearly when a Node export has no Node condition or a runtime edge is unmapped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-artifacts-fail-'))
    homes.push(root)
    const browserOnly = join(root, 'browser-only')
    await writeTree(browserOnly, {
      'package.json': JSON.stringify({ name: 'browser-only', exports: { '.': { types: './lib/index.d.ts', browser: './lib/browser.js' } } }),
      'lib/browser.js': 'export {}\n',
    })
    await expect(projectNativePackageManifest({ source: browserOnly, destination: join(root, 'out') }))
      .rejects.toThrow(/Unsupported Node export/)

    const source = join(root, 'missing-map')
    await writeTree(source, {
      'package.json': JSON.stringify({ name: 'missing-map', type: 'module', main: './lib/index.js', dependencies: { ghost: '1.0.0' } }),
      'lib/index.js': "import 'ghost'\n",
      'node_modules/ghost/package.json': '{"name":"ghost"}\n',
      'node_modules/ghost/index.js': 'export {}\n',
    })
    await expect(projectNativePackageManifest({ source, destination: join(root, 'out2') }))
      .rejects.toThrow(/Missing dependency source: ghost/)
  })

  it('keeps JSON data wildcards and fails clearly on JavaScript wildcards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-artifacts-wildcard-'))
    homes.push(root)
    const jsonSource = join(root, 'json-wildcard')
    await writeTree(jsonSource, {
      'package.json': JSON.stringify({
        name: 'json-wildcard',
        type: 'module',
        exports: { '.': './lib/index.js', './locale/*.json': './locale/*.json' },
      }),
      'lib/index.js': 'export const entry = 1\n',
      'locale/zh.json': '{"title":"ok"}\n',
    })
    await expect(projectNativePackageManifest({ source: jsonSource, destination: join(root, 'json-out') }))
      .resolves.toMatchObject({ name: 'json-wildcard', dependencies: {} })

    const jsSource = join(root, 'js-wildcard')
    await writeTree(jsSource, {
      'package.json': JSON.stringify({
        name: 'js-wildcard',
        type: 'module',
        exports: { '.': './lib/index.js', './feature/*': './lib/feature/*.js' },
        dependencies: { 'review-wildcard-dep': '1.0.0' },
      }),
      'lib/index.js': 'export const entry = 1\n',
      'lib/feature/one.js': "import value from 'review-wildcard-dep'\nexport default value\n",
    })
    await expect(projectNativePackageManifest({ source: jsSource, destination: join(root, 'js-out') }))
      .rejects.toThrow(/Unsupported Node export: \.\/feature\/\*/)
  })
})
