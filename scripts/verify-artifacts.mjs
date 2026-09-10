import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLIC_PLUGIN_PACKAGES } from './desktop-compositions.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packDir = path.join(root, '.pack')
const packageNames = PUBLIC_PLUGIN_PACKAGES

function expectedEntries(name) {
  const output = fs.readdirSync(path.join(root, 'packages', name, 'lib')).filter(file => /\.(?:js|js\.map|d\.ts)$/.test(file))
  if (name === 'dsh-manuscript') output.push('client-editor-core.cjs')
  return ['package/LICENSE', 'package/README.md', 'package/cordis.patch.yml', 'package/package.json', ...output.map(file => 'package/lib/' + file)]
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
  assertExact(`${name} archive contents`, entries, expectedEntries(name))

  const packageJson = JSON.parse(tar(['-xOf', absolute, 'package/package.json']))
  if (packageJson.name !== name || packageJson.version !== manifests[name].version) {
    throw new Error(`${name} packed manifest identity mismatch`)
  }
  if (packageJson.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error(`${name} does not declare its DSH bundle patch`)
  }

  for (const value of Object.values(packageJson.exports ?? {})) {
    const targets = typeof value === 'string' ? [value] : Object.values(value)
    for (const target of targets) {
      if (typeof target === 'string' && target.startsWith('./') && !entries.includes('package/' + target.slice(2))) {
        throw new Error(`${name} exports a missing file: ${target}`)
      }
    }
  }
  if (Object.values(packageJson.dependencies ?? {}).some(version => version.startsWith('workspace:'))) {
    throw new Error(`${name} contains unresolved workspace runtime dependencies`)
  }
  const codeEntries = entries.filter((entry) => /package\/lib\/.*\.(?:js|cjs)$/.test(entry))
  const code = codeEntries.map((entry) => tar(['-xOf', absolute, entry])).join('\n')
  const runtimeForbidden = {
    'dsh-manuscript': ['proposal.list', 'proposal.accept', 'proposal.reject'],
    'dsh-proofread': ['dsh-manuscript', 'dsh-editor-workbench', 'dsh-editor-novel-kernel', 'node:fs', '@deepseek-ai/dsh-tools'],
    'dsh-zhihu': ['dsh-editor-workbench', 'dsh-editor-novel-kernel', 'dsh-manuscript'],
  }[name]
  for (const token of runtimeForbidden) {
    if (code.includes(token)) throw new Error(`${name} packed code contains forbidden coupling: ${token}`)
  }
  if (name === 'dsh-manuscript') {
    const archiveText = entries.map((entry) => tar(['-xOf', absolute, entry])).join('\n')
    const archiveForbidden = [
      'dsh-editor-workbench',
      'dsh-editor-novel-kernel',
      '/dsh-editor-workbench',
      'novel_knowledge',
      'novel_propose',
      'novel-knowledge',
      'node:fs',
    ]
    for (const token of archiveForbidden) {
      if (archiveText.includes(token)) throw new Error(`${name} tarball contains private implementation token: ${token}`)
    }
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
    dsh: '0.1.1-rc.2',
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
