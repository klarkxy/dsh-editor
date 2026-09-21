/** Real pnpm build/pack integration; registry reads are local fixtures and publishing is never enabled. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('discovers new packages, packs updated workspace versions, and reconciles a lost writeback without another release', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-npm-release-test-'))
  const pnpm = process.env.npm_execpath ?? (process.env.PATH ?? '').split(delimiter).flatMap(dir => [join(dir, 'node_modules/pnpm/bin/pnpm.cjs'), ...(process.platform === 'win32' ? [] : [join(dir, 'pnpm')])]).filter(existsSync).map(path => realpathSync(path)).find(path => path.includes('pnpm'))
  expect(pnpm).toContain('pnpm')
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...process.env, npm_execpath: pnpm } })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    return result.stdout
  }
  mkdirSync(join(root, 'scripts'))
  for (const file of ['publish-npm-plugins.mjs', 'npm-release-policy.mjs']) copyFileSync(resolve('scripts', file), join(root, 'scripts', file))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: 'pnpm@10.14.0' }))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  const manifests = new Map()
  for (const [dir, deps] of [['core', {}], ['consumer', { '@klarkxy/fixture-core': 'workspace:*' }]]) {
    const location = join(root, 'packages', dir)
    mkdirSync(location, { recursive: true })
    const manifest = { name: '@klarkxy/fixture-' + dir, version: '0.1.0', type: 'module', files: ['lib'], exports: { '.': './lib/index.js' }, publishConfig: { access: 'public' }, dependencies: deps, scripts: { build: 'node build.cjs' } }
    manifests.set(dir, manifest)
    writeFileSync(join(location, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(location, 'README.md'), 'A deterministic release test fixture.')
    writeFileSync(join(location, 'LICENSE'), 'Test fixture; not for publication.')
    writeFileSync(join(location, 'build.cjs'), `const fs=require('node:fs');const own=JSON.parse(fs.readFileSync('package.json'));const dependency=fs.existsSync('../core/package.json')?JSON.parse(fs.readFileSync('../core/package.json')).version:null;fs.mkdirSync('lib',{recursive:true});fs.writeFileSync('lib/index.js','export default '+JSON.stringify({version:own.version,dependency})+';');`)
  }
  writeFileSync(join(root, 'mock-registry.mjs'), `import fs from 'node:fs';const registry=JSON.parse(fs.readFileSync('registry.json'));globalThis.fetch=async url=>{const parsed=new URL(url);if(parsed.origin!=='https://registry.npmjs.org')throw new Error('Unexpected destination');const key=decodeURIComponent(parsed.pathname.slice(1));if(!(key in registry))throw new Error('Unexpected package '+key);return new Response(JSON.stringify(registry[key]),{status:200})};`)
  const registry = Object.fromEntries([...manifests.values()].map((manifest, i) => {
    const version = i === 0 ? '0.1.2' : '0.1.4'
    return [manifest.name, { 'dist-tags': { latest: version }, versions: { [version]: { name: manifest.name, version, dshRelease: { contentHash: 'old' } } } }]
  }))
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry))
  run(process.execPath, [pnpm, 'install', '--offline', '--ignore-scripts'])
  run('git', ['init', '-q'])
  run('git', ['-c', 'user.name=release-test', '-c', 'user.email=release-test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
  const preview = () => {
    run(process.execPath, ['--import', './mock-registry.mjs', 'scripts/publish-npm-plugins.mjs'])
    return JSON.parse(readFileSync(join(root, '.pack/npm-release/report.json'), 'utf8'))
  }
  const first = preview()
  expect(first.packages.map(row => [row.name, row.version, row.action])).toEqual([
    ['@klarkxy/fixture-core', '0.1.3', 'publish'], ['@klarkxy/fixture-consumer', '0.1.5', 'publish'],
  ])
  const archive = join(root, '.pack/npm-release/klarkxy-fixture-consumer-0.1.5.tgz')
  const packed = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']))
  expect(packed.dependencies['@klarkxy/fixture-core']).toBe('0.1.3')
  expect(run('tar', ['-xOf', archive, 'package/lib/index.js'])).toContain('"version":"0.1.5","dependency":"0.1.3"')
  for (const [dir, manifest] of manifests) expect(JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))).toEqual(manifest)
  for (const row of first.packages) registry[row.name] = { 'dist-tags': { latest: row.version }, versions: { [row.version]: { name: row.name, version: row.version, dshRelease: { contentHash: row.contentHash } } } }
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry))
  const second = preview()
  expect(second.packages.map(row => [row.version, row.action])).toEqual([['0.1.3', 'skip'], ['0.1.5', 'skip']])
  for (const [dir, manifest] of manifests) expect(JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))).toEqual(manifest)
}, 60000)
