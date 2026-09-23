/** Run through pnpm run publish:plugins [--publish]. Default mode only previews. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packageContentHash, planPackage, publishAndConfirm, orderReleaseTargets } from './npm-release-policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.pack/npm-release')
const registryURL = 'https://registry.npmjs.org/'
const targets = orderReleaseTargets(readdirSync(resolve(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(resolve(root, 'packages', entry.name, 'package.json')))
  .map(entry => {
    const directory = 'packages/' + entry.name
    return { directory, manifest: JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')) }
  }))
const publish = process.argv.includes('--publish')
if (!process.env.npm_execpath?.replaceAll('\\', '/').includes('pnpm')) throw new Error('Run through pnpm run publish:plugins')
if (publish && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'klarkxy/dsh-editor')) {
  throw new Error('Automatic publication is restricted to klarkxy/dsh-editor main in GitHub Actions')
}
mkdirSync(output, { recursive: true })
const report = { sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(), mode: publish ? 'publish' : 'plan', packages: [] }
function run(command, args, options = {}) {
  let executable = command
  if (command === 'pnpm') { executable = process.execPath; args = [process.env.npm_execpath, ...args] }
  if (command === 'npm' && process.platform === 'win32') {
    executable = process.execPath; args = [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args]
  }
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`)
  return result.stdout
}
async function registry(path, timeoutMs = 30000) {
  // A cached 404 can outlive a successful upload, even with Cache-Control: no-cache.
  const url = new URL(path, registryURL)
  url.searchParams.set('dsh-release-check', randomUUID())
  const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(30000, timeoutMs)), redirect: 'error', headers: { 'cache-control': 'no-cache' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`npm registry HTTP ${response.status}`)
  return response.json()
}
function writeManifest(path, manifest) { writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n') }
function build(target) { run('pnpm', ['--filter', target.name, 'run', '--if-present', 'build']) }
function pack(target, manifest) {
  run('pnpm', ['--filter', target.name, 'pack', '--pack-destination', output])
  const archive = resolve(output, `${target.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`)
  const names = run('tar', ['--force-local', '-tf', archive]).trim().split(/\r?\n/)
  const entries = new Map(names.map(name => [name, run('tar', ['--force-local', '-xOf', archive, name], { encoding: 'buffer' })]))
  const packed = JSON.parse(entries.get('package/package.json').toString())
  if (packed.name !== target.name || packed.version !== manifest.version) throw new Error('Packed package identity mismatch')
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (Object.values(packed[field] ?? {}).some(v => v.startsWith('workspace:'))) throw new Error('Unresolved workspace runtime dependency')
  }
  const exportPaths = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(exportPaths) : []
  for (const item of exportPaths(packed.exports ?? {})) {
    if (item.includes('*')) continue
    if (!entries.has('package/' + item.replace(/^\.\//, ''))) throw new Error(`Missing packed export: ${item}`)
  }
  for (const required of ['LICENSE', 'README.md']) if (!entries.has('package/' + required)) throw new Error(`Missing ${required}`)
  if (packed.dsh?.bundle?.patch && !entries.get('package/' + packed.dsh.bundle.patch.replace(/^\.\//, ''))?.toString().includes(target.name)) throw new Error('Bundle patch does not reference scoped package')
  if (packed.dsh?.client && !entries.get('package/lib/client.js')?.toString().includes(`id: "${target.name}"`)) throw new Error('Client module ID does not match scoped package')
  return { archive, contentHash: packageContentHash(entries), integrity: 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64') }
}
function saveReport() { writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n') }
let failed = false
const failedPackages = new Set()
const previewOriginals = new Map()
try {
  if (publish) {
    run('git', ['fetch', 'origin', 'main'])
    if (run('git', ['rev-parse', 'origin/main']).trim() !== report.sourceCommit) {
      report.skipped = 'main advanced before publication; the newest queued run will reconcile'
      console.log(report.skipped)
    }
  }
  if (!report.skipped) for (const target of targets) {
    const manifestPath = resolve(root, target.directory, 'package.json')
    const original = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(original)
    const row = { name: target.name, manifestPath: `${target.directory}/package.json` }
    report.packages.push(row)
    try {
      if (target.dependencies.some(name => failedPackages.has(name))) throw new Error('A workspace dependency was not confirmed; dependent publication is blocked')
      if (manifest.name !== target.name || manifest.private) throw new Error('Release target identity or visibility mismatch')
      const remote = await registry(encodeURIComponent(target.name))
      const latest = remote?.versions?.[remote['dist-tags']?.latest]
      // Reconcile first, so version-embedding builds do not release again after failed Git writeback.
      const baseline = { ...manifest, version: latest?.version ?? manifest.version }
      delete baseline.dshRelease
      if (!publish) previewOriginals.set(manifestPath, original)
      writeManifest(manifestPath, baseline)
      build(target)
      const candidate = pack(target, baseline)
      const plan = planPackage(manifest, remote, candidate.contentHash)
      Object.assign(row, plan)
      let finalManifest = { ...manifest, version: plan.version, dshRelease: { contentHash: plan.contentHash } }
      if (plan.action === 'publish') {
        const buildManifest = { ...finalManifest }
        delete buildManifest.dshRelease
        writeManifest(manifestPath, buildManifest)
        build(target)
        const versioned = pack(target, finalManifest)
        // Building with the final version also covers packages that embed their own/dependency versions.
        row.contentHash = versioned.contentHash
        finalManifest.dshRelease.contentHash = versioned.contentHash
        writeManifest(manifestPath, finalManifest)
        const artifact = pack(target, finalManifest)
        if (artifact.contentHash !== versioned.contentHash) throw new Error('Final artifact changed while stamping its content hash')
        row.integrity = artifact.integrity
        if (publish) {
          const confirmation = await publishAndConfirm({ name: target.name, version: plan.version, contentHash: artifact.contentHash, integrity: artifact.integrity }, {
            publish: () => run('npm', ['publish', artifact.archive, '--access', 'public', '--registry', registryURL, '--ignore-scripts']),
            readVersion: (name, version, timeoutMs) => registry(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, timeoutMs),
            readPackageVersion: async (name, version, timeoutMs) => (await registry(encodeURIComponent(name), timeoutMs))?.versions?.[version],
            wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
          })
          row.status = confirmation.recovered ? 'confirmed-after-cli-error' : 'published'
        }
      } else {
        writeManifest(manifestPath, finalManifest)
        row.status = 'unchanged'
      }
      if (!publish) row.status = 'planned'
      row.writeback = publish && readFileSync(manifestPath, 'utf8') !== original
      console.log(`${row.name}@${row.version}: ${row.status} (${row.reason})`)
    } catch (error) {
      writeFileSync(manifestPath, original)
      row.status = 'failed'; row.error = error.message; row.writeback = false
      failed = true; failedPackages.add(target.name)
      console.error(`${target.name}: ${error.message}`)
    } finally { saveReport() }
  }
} finally {
  for (const [path, original] of previewOriginals) writeFileSync(path, original)
  saveReport()
  writeFileSync(resolve(output, 'writeback-paths.txt'), report.packages.filter(row => row.writeback).map(row => row.manifestPath).join('\n') + '\n')
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `writeback=${report.packages.some(row => row.writeback)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '# npm plugin publication\n\n' + report.packages.map(row => `- ${row.name}@${row.version ?? '?'}: ${row.status}${row.error ? ` — ${row.error}` : ''}`).join('\n') + '\n')
}
if (failed) process.exitCode = 1
