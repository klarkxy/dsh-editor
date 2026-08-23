import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packDir = path.join(root, '.pack')
const packageNames = ['dsh-manuscript', 'dsh-grill']
const expectedEntries = {
  'dsh-manuscript': [
    'package/LICENSE',
    'package/README.md',
    'package/cordis.patch.yml',
    'package/lib/client.js',
    'package/lib/index.d.ts',
    'package/lib/index.js',
    'package/lib/index.js.map',
    'package/package.json',
  ],
  'dsh-grill': [
    'package/LICENSE',
    'package/README.md',
    'package/cordis.patch.yml',
    'package/lib/host.js',
    'package/lib/host.js.map',
    'package/lib/tools.d.ts',
    'package/lib/tools.js',
    'package/lib/tools.js.map',
    'package/lib/workflow.d.ts',
    'package/lib/workflow.js',
    'package/lib/workflow.js.map',
    'package/package.json',
  ],
}

function readManifest(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'))
}

function tar(args) {
  const result = spawnSync('tar', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr || `tar ${args.join(' ')} failed`)
  return result.stdout
}

function git(args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function assertExact(label, actual, expected) {
  const left = [...actual].sort()
  const right = [...expected].sort()
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${label} mismatch\nactual: ${left.join(', ')}\nexpected: ${right.join(', ')}`)
  }
}

const manifests = Object.fromEntries(packageNames.map((name) => [name, readManifest(name)]))
const expectedTarballs = packageNames.map((name) => `${name}-${manifests[name].version}.tgz`)
const actualTarballs = fs.readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
assertExact('tarball set', actualTarballs, expectedTarballs)

const artifacts = []
for (const name of packageNames) {
  const filename = `${name}-${manifests[name].version}.tgz`
  const absolute = path.join(packDir, filename)
  const entries = tar(['-tf', absolute]).trim().split(/\r?\n/).filter(Boolean)
  assertExact(`${name} archive contents`, entries, expectedEntries[name])

  const packageJson = JSON.parse(tar(['-xOf', absolute, 'package/package.json']))
  if (packageJson.name !== name || packageJson.version !== manifests[name].version) {
    throw new Error(`${name} packed manifest identity mismatch`)
  }
  if (packageJson.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error(`${name} does not declare its DSH bundle patch`)
  }

  const codeEntries = entries.filter((entry) => /package\/lib\/.*\.js$/.test(entry))
  const code = codeEntries.map((entry) => tar(['-xOf', absolute, entry])).join('\n')
  const forbidden = name === 'dsh-manuscript'
    ? ['dsh-grill', 'node:fs', 'proposal.list', 'proposal.accept', 'proposal.reject']
    : ['dsh-manuscript', 'proposal.list', 'proposal.accept', 'proposal.reject']
  for (const token of forbidden) {
    if (code.includes(token)) throw new Error(`${name} packed code contains forbidden coupling: ${token}`)
  }

  const bytes = fs.readFileSync(absolute)
  artifacts.push({
    name,
    version: manifests[name].version,
    filename,
    bytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  })
}

const releaseManifest = {
  schemaVersion: 1,
  source: {
    revision: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal'])),
  },
  compatibility: {
    dsh: '0.1.1-rc.1',
    node: '>=22',
    pnpm: '10.14.0',
  },
  artifacts,
}

fs.writeFileSync(
  path.join(packDir, 'release-manifest.json'),
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
  'utf8',
)
fs.writeFileSync(
  path.join(packDir, 'SHA256SUMS'),
  `${artifacts.map((item) => `${item.sha256}  ${item.filename}`).join('\n')}\n`,
  'utf8',
)

console.log(`verified ${artifacts.length} artifacts`)
for (const artifact of artifacts) console.log(`${artifact.sha256}  ${artifact.filename}`)
