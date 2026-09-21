import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'
import { compositionInstallNames } from './plugin-manifest.mjs'
import { workspacePackageDir, desktopComposition, configureProfile, runtimeDependencySources } from './desktop-compositions.mjs'
import { prepareNodeRuntime } from './prepare-node-runtime.mjs'
import { treeDigest } from '../apps/desktop/dist/runtime-tree.js'

const NODE_VERSION = '24.16.0'
const DSH_VERSION = '0.1.5-rc.2'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(root, '.pack', 'desktop-runtime')
const nodeOutput = resolve(outputRoot, `node-${NODE_VERSION}`)
const dshOutput = resolve(outputRoot, `dsh-${DSH_VERSION}`)
const profileOutput = resolve(outputRoot, 'profile')
const composition = await desktopComposition()
const privateProfilePackages = compositionInstallNames(composition)
const runtimeDependencies = runtimeDependencySources(composition)

function assertSafeOutput(path) {
  const packRoot = resolve(root, '.pack') + sep
  if (!path.startsWith(packRoot) || path === resolve(root, '.pack')) {
    throw new Error(`refusing to replace unsafe runtime path: ${path}`)
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
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

function runtimeDependencyCopyFilter(packageRoot) {
  return (source) => {
    const normalized = source.slice(packageRoot.length).replaceAll('\\', '/').replace(/^\//, '')
    if (!normalized) return true
    if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return false
    if (/\.(?:map|d\.ts|d\.mts|d\.cts)$/.test(normalized)) return false
    return true
  }
}

async function copyRuntimeDependency({ name, packageManifest }) {
  const ownerRequire = createRequire(packageManifest)
  const sourceManifest = ownerRequire.resolve(`${name}/package.json`)
  const sourceRoot = dirname(sourceManifest)
  const sourcePackage = await readJson(sourceManifest)
  if (sourcePackage.name !== name) throw new Error(`runtime dependency identity mismatch: expected ${name}, found ${sourcePackage.name}`)
  const destination = resolve(dshOutput, 'node_modules', ...name.split('/'))
  if (existsSync(destination)) {
    const bundled = await readJson(resolve(destination, 'package.json'))
    if (bundled.name !== name || bundled.version !== sourcePackage.version) {
      throw new Error(`bundled runtime dependency conflict for ${name}: expected ${sourcePackage.version}, found ${bundled.name}@${bundled.version}`)
    }
  } else {
    await mkdir(dirname(destination), { recursive: true })
    await cp(sourceRoot, destination, { recursive: true, dereference: true, filter: runtimeDependencyCopyFilter(sourceRoot) })
  }
  const dependencyRequire = createRequire(resolve(destination, 'package.json'))
  const optionalPeers = sourcePackage.peerDependenciesMeta ?? {}
  for (const dependency of [...Object.keys(sourcePackage.dependencies ?? {}), ...Object.keys(sourcePackage.peerDependencies ?? {})]) {
    if (optionalPeers[dependency]?.optional) continue
    try { dependencyRequire.resolve(dependency) } catch {
      throw new Error(`bundled runtime dependency ${name} cannot resolve ${dependency}`)
    }
  }
}

const SUPPORTED_PLATFORMS = ['win32-x64', 'darwin-x64', 'darwin-arm64']
const platformId = `${process.platform}-${process.arch}`
if (!SUPPORTED_PLATFORMS.includes(platformId)) {
  throw new Error(`unsupported desktop runtime platform: ${platformId} (supported: ${SUPPORTED_PLATFORMS.join(', ')})`)
}
if (process.versions.node !== NODE_VERSION) {
  throw new Error(`portable V1 requires Node ${NODE_VERSION}, found ${process.versions.node}`)
}
const nodeExecutableName = process.platform === 'win32' ? 'node.exe' : 'node'

const dsh = resolveDshInstallation(DSH_VERSION)
for (const packageName of privateProfilePackages) {
  const packageRoot = workspacePackageDir(packageName)
  const manifest = await readJson(resolve(packageRoot, 'package.json'))
  if (manifest.name !== packageName) throw new Error(`unexpected package identity at ${packageRoot}`)
  await stat(resolve(packageRoot, 'lib'))
}

assertSafeOutput(outputRoot)
await rm(outputRoot, { recursive: true, force: true })
await mkdir(nodeOutput, { recursive: true })
await mkdir(dshOutput, { recursive: true })

await prepareNodeRuntime(nodeOutput)
await cp(dsh.packageRoot, dshOutput, {
  recursive: true,
  dereference: true,
  filter: dshCopyFilter,
})
for (const dependency of runtimeDependencies) await copyRuntimeDependency(dependency)

for (const packageName of privateProfilePackages) {
  const source = workspacePackageDir(packageName)
  const destination = resolve(dshOutput, 'node_modules', packageName)
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true, filter: packageCopyFilter })
}

const bundledDsh = await readJson(resolve(dshOutput, 'package.json'))
if (bundledDsh.name !== '@deepseek-ai/dsh' || bundledDsh.version !== DSH_VERSION) {
  throw new Error(`bundled DSH identity mismatch: ${bundledDsh.name}@${bundledDsh.version}`)
}
const nodeProbe = spawnSync(resolve(nodeOutput, nodeExecutableName), ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
})
if (nodeProbe.status !== 0 || nodeProbe.stdout.trim() !== `v${NODE_VERSION}`) {
  throw new Error(`bundled Node probe failed: ${nodeProbe.stderr || nodeProbe.stdout}`)
}
const dshDigest = await treeDigest(dshOutput)
await rename(resolve(dshOutput, 'node_modules'), resolve(dshOutput, 'vendor-dependencies'))

const profileSource = resolve(root, 'apps', 'desktop', 'resources', 'profile')
await cp(profileSource, profileOutput, { recursive: true, dereference: true })
await configureProfile(profileOutput, composition)
for (const packageName of privateProfilePackages) {
  await cp(workspacePackageDir(packageName), resolve(profileOutput, 'node_modules', packageName), {
    recursive: true,
    dereference: true,
    filter: packageCopyFilter,
  })
}
const profileDigest = await treeDigest(profileOutput)
await rename(resolve(profileOutput, 'node_modules'), resolve(profileOutput, 'vendor-dependencies'))
const profile = await readJson(resolve(profileOutput, 'package.json'))
if (JSON.stringify(profile.dsh?.profile?.bundles) !== JSON.stringify(composition.bundles)) {
  throw new Error('desktop profile bundles are missing, reordered, or unexpected')
}

const nodeDigest = await treeDigest(nodeOutput)
const nodeVendor = resolve(nodeOutput, 'node_modules')
if (existsSync(nodeVendor)) {
  await rename(nodeVendor, resolve(nodeOutput, 'vendor-dependencies'))
}

const manifest = {
  format: 1,
  platform: platformId,
  node: { version: NODE_VERSION, ...nodeDigest },
  dsh: { version: DSH_VERSION, ...dshDigest },
  profile: profileDigest,
}
await writeFile(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`desktop runtime prepared at ${outputRoot}`)
console.log(JSON.stringify(manifest, null, 2))
