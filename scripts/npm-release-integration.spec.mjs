/** Real pnpm build/pack integration; registry reads and npm uploads are intercepted local fixtures. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('discovers new packages, packs updated workspace versions, and reconciles a lost writeback without another release', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-npm-release-test-'))
  const pnpm = process.env.npm_execpath ?? (process.env.PATH ?? '').split(delimiter).flatMap(dir => [join(dir, 'node_modules/pnpm/bin/pnpm.cjs'), ...(process.platform === 'win32' ? [] : [join(dir, 'pnpm')])]).filter(existsSync).map(path => realpathSync(path)).find(path => path.includes('pnpm'))
  expect(pnpm).toContain('pnpm')
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...process.env, npm_execpath: pnpm, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } })
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
  writeFileSync(join(root, 'mock-registry.mjs'), String.raw`import fs from 'node:fs'
import { createHash } from 'node:crypto'
import childProcess from 'node:child_process'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
const registry = JSON.parse(fs.readFileSync('registry.json'))
const seen = new Set()
const spawnSync = childProcess.spawnSync
childProcess.spawnSync = (command, args, options) => {
  if (!args.includes('publish')) return spawnSync(command, args, options)
  // Intercept the actual publish command before it can execute or reach npm.
  const archive = args[args.indexOf('publish') + 1]
  const packed = spawnSync('tar', ['-xOf', path.basename(archive), 'package/package.json'], { encoding: 'utf8', cwd: path.dirname(archive) })
  if (packed.status !== 0) throw new Error(packed.stderr)
  const manifest = JSON.parse(packed.stdout)
  const version = { ...manifest, dist: { integrity: 'sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64') } }
  registry[manifest.name] = { 'dist-tags': { latest: manifest.version }, versions: { ...registry[manifest.name]?.versions, [manifest.version]: version } }
  fs.writeFileSync('registry.json', JSON.stringify(registry))
  fs.appendFileSync('uploads.jsonl', JSON.stringify({ name: manifest.name, version: manifest.version }) + '\n')
  return { status: 0, stdout: 'fixture upload accepted', stderr: '' }
}
syncBuiltinESMExports()
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url)
  const nonce = parsed.searchParams.get('dsh-release-check')
  if (!nonce || seen.has(nonce) || options.headers['cache-control'] !== 'no-cache') throw new Error('Missing fresh registry request')
  seen.add(nonce)
  if (parsed.origin !== 'https://registry.npmjs.org') throw new Error('Unexpected destination')
  const key = decodeURIComponent(parsed.pathname.slice(1))
  // Only complete package metadata exposes uploads; version endpoints stay stale.
  if (/^@klarkxy\/fixture-[^/]+\/\d+\.\d+\.\d+$/.test(key)) return new Response(null, { status: 404 })
  if (!(key in registry)) throw new Error('Unexpected package ' + key)
  return new Response(JSON.stringify(registry[key]), { status: 200 })
}
`)
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
  const packed = JSON.parse(run('tar', ['-xOf', join('.pack', 'npm-release', basename(archive)), 'package/package.json']))
  expect(packed.dependencies['@klarkxy/fixture-core']).toBe('0.1.3')
  expect(run('tar', ['-xOf', join('.pack', 'npm-release', basename(archive)), 'package/lib/index.js'])).toContain('"version":"0.1.5","dependency":"0.1.3"')
  for (const [dir, manifest] of manifests) expect(JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))).toEqual(manifest)
  for (const row of first.packages) registry[row.name] = { 'dist-tags': { latest: row.version }, versions: { [row.version]: { name: row.name, version: row.version, dshRelease: { contentHash: row.contentHash } } } }
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry))
  const second = preview()
  expect(second.packages.map(row => [row.version, row.action])).toEqual([['0.1.3', 'skip'], ['0.1.5', 'skip']])
  for (const [dir, manifest] of manifests) expect(JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'))).toEqual(manifest)

  // Execute the production publication path with intercepted uploads and a local Git remote.
  run('git', ['branch', '-M', 'main'])
  run('git', ['remote', 'add', 'origin', root])
  for (const value of Object.values(registry)) value.versions[value['dist-tags'].latest].dshRelease.contentHash = 'changed'
  writeFileSync(join(root, 'registry.json'), JSON.stringify(registry))
  const publish = () => {
    const result = spawnSync(process.execPath, ['--import', './mock-registry.mjs', 'scripts/publish-npm-plugins.mjs', '--publish'], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000,
      env: { ...process.env, npm_execpath: pnpm, GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'klarkxy/dsh-editor', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    return JSON.parse(readFileSync(join(root, '.pack/npm-release/report.json'), 'utf8'))
  }
  const published = publish()
  expect(published.packages.map(row => [row.version, row.status, row.writeback])).toEqual([
    ['0.1.4', 'published', true], ['0.1.6', 'published', true],
  ])
  const uploads = readFileSync(join(root, 'uploads.jsonl'), 'utf8')
  expect(uploads.trim().split('\n')).toHaveLength(2)
  // Simulate a failed Git writeback and ensure recovery writes receipts without re-uploading.
  for (const [dir, manifest] of manifests) writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify(manifest))
  const recovered = publish()
  expect(recovered.packages.map(row => [row.version, row.status, row.writeback])).toEqual([
    ['0.1.4', 'unchanged', true], ['0.1.6', 'unchanged', true],
  ])
  expect(readFileSync(join(root, 'uploads.jsonl'), 'utf8')).toBe(uploads)
  expect(readFileSync(join(root, '.pack/npm-release/writeback-paths.txt'), 'utf8').trim().split('\n')).toEqual([
    'packages/core/package.json', 'packages/consumer/package.json',
  ])
}, 120000)
