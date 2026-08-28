import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'

const NODE_VERSION = '24.16.0'
const DSH_VERSION = '0.1.1-rc.2'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(root, '.pack', 'desktop-runtime')
const nodeOutput = resolve(outputRoot, `node-${NODE_VERSION}`)
const dshOutput = resolve(outputRoot, `dsh-${DSH_VERSION}`)
const profileOutput = resolve(outputRoot, 'profile')

function assertSafeOutput(path) {
  const packRoot = resolve(root, '.pack') + sep
  if (!path.startsWith(packRoot) || path === resolve(root, '.pack')) {
    throw new Error(`refusing to replace unsafe runtime path: ${path}`)
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function treeDigest(path) {
  const hash = createHash('sha256')
  let files = 0
  let bytes = 0

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const absolute = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const data = await readFile(absolute)
      const name = relative(path, absolute).replaceAll('\\', '/')
      hash.update(name)
      hash.update('\0')
      hash.update(createHash('sha256').update(data).digest('hex'))
      hash.update('\n')
      files += 1
      bytes += data.byteLength
    }
  }

  await visit(path)
  return { sha256: hash.digest('hex'), files, bytes }
}

function packageCopyFilter(source) {
  const normalized = source.replaceAll('\\', '/')
  return !normalized.includes('/node_modules/') &&
    !normalized.includes('/src/') &&
    !normalized.includes('/test/') &&
    !normalized.endsWith('/tsconfig.json') &&
    !normalized.endsWith('/tsdown.config.ts')
}

function dshCopyFilter(source) {
  const normalized = source.replaceAll('\\', '/')
  if (normalized.includes('/node_modules/.bin/')) return false
  if (/\.(?:map|d\.ts|d\.mts|d\.cts)$/.test(normalized)) return false
  return true
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`portable V1 requires Windows x64, found ${process.platform} ${process.arch}`)
}
if (process.versions.node !== NODE_VERSION) {
  throw new Error(`portable V1 requires Node ${NODE_VERSION}, found ${process.versions.node}`)
}

const dsh = resolveDshInstallation(DSH_VERSION)
for (const packageName of ['dsh-editor-shell', 'dsh-manuscript']) {
  const packageRoot = resolve(root, 'packages', packageName)
  const manifest = await readJson(resolve(packageRoot, 'package.json'))
  if (manifest.name !== packageName) throw new Error(`unexpected package identity at ${packageRoot}`)
  await stat(resolve(packageRoot, 'lib'))
}

assertSafeOutput(outputRoot)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(nodeOutput, { recursive: true })
await mkdir(dshOutput, { recursive: true })

const nodeExecutable = process.execPath
await cp(nodeExecutable, resolve(nodeOutput, 'node.exe'))
await cp(dsh.packageRoot, dshOutput, {
  recursive: true,
  dereference: true,
  filter: dshCopyFilter,
})

for (const packageName of ['dsh-editor-shell', 'dsh-manuscript']) {
  const source = resolve(root, 'packages', packageName)
  const destination = resolve(dshOutput, 'node_modules', packageName)
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, filter: packageCopyFilter })
}

const bundledDsh = await readJson(resolve(dshOutput, 'package.json'))
if (bundledDsh.name !== '@deepseek-ai/dsh' || bundledDsh.version !== DSH_VERSION) {
  throw new Error(`bundled DSH identity mismatch: ${bundledDsh.name}@${bundledDsh.version}`)
}
const nodeProbe = spawnSync(resolve(nodeOutput, 'node.exe'), ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
})
if (nodeProbe.status !== 0 || nodeProbe.stdout.trim() !== `v${NODE_VERSION}`) {
  throw new Error(`bundled Node probe failed: ${nodeProbe.stderr || nodeProbe.stdout}`)
}
const dshDigest = await treeDigest(dshOutput)
await rename(resolve(dshOutput, 'node_modules'), resolve(dshOutput, 'vendor-dependencies'))

const profileSource = resolve(root, 'apps', 'desktop', 'resources', 'profile')
await cp(profileSource, profileOutput, { recursive: true })
for (const packageName of ['dsh-editor-shell', 'dsh-manuscript']) {
  await cp(resolve(root, 'packages', packageName), resolve(profileOutput, 'node_modules', packageName), {
    recursive: true,
    filter: packageCopyFilter,
  })
}
const profileDigest = await treeDigest(profileOutput)
await rename(resolve(profileOutput, 'node_modules'), resolve(profileOutput, 'vendor-dependencies'))
const profile = await readJson(resolve(profileSource, 'package.json'))
const expectedBundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-manuscript',
  'dsh-editor-shell',
]
if (JSON.stringify(profile.dsh?.profile?.bundles) !== JSON.stringify(expectedBundles)) {
  throw new Error('desktop profile bundles are missing, reordered, or unexpected')
}

const manifest = {
  format: 1,
  platform: 'win32-x64',
  node: { version: NODE_VERSION, ...(await treeDigest(nodeOutput)) },
  dsh: { version: DSH_VERSION, ...dshDigest },
  profile: profileDigest,
}
await writeFile(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`desktop runtime prepared at ${outputRoot}`)
console.log(JSON.stringify(manifest, null, 2))
