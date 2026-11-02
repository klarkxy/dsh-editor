import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectNativePackageManifest } from './native-package-artifacts.mjs'
import { packageCopyFilter } from './package-copy.mjs'
import {
  applyDistributionManifestFacets,
  desktopComposition,
  materializedRuntimePackageNames,
  workspacePackageDir,
} from './desktop-compositions.mjs'
import { clientPackages, compositionInstallNames, loadPluginManifests } from './plugin-manifest.mjs'
import { externalPluginPins } from './external-plugins.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wrapClientScript = resolve(repoRoot, 'scripts', 'wrap-client.mjs')
const PROFILE_MARKER = '.dsh-editor-owner.json'
const lockfile = createRequire(import.meta.url)('proper-lockfile')
const COPY_RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }
const SYNC_LOCK_OPTIONS = {
  realpath: false,
  stale: 10_000,
  update: 1_000,
  retries: {
    retries: 600,
    factor: 1,
    minTimeout: 100,
    maxTimeout: 100,
  },
}

function packagePath(root, name) {
  return resolve(root, ...String(name).split('/'))
}

function isInside(root, path) {
  const from = resolve(root)
  const to = resolve(path)
  const rel = relative(from, to).replaceAll('\\', '/')
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

function assertPackageName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('usage: sync-desktop-dev-package.mjs <package-name>')
  if (name.includes('\\') || name.includes('..') || name.startsWith('/') || name.includes('\0')) {
    throw new Error(`invalid package name: ${name}`)
  }
}

async function isOwnedProfile(profilePath) {
  try {
    const marker = JSON.parse(await readFile(join(profilePath, PROFILE_MARKER), 'utf8'))
    return marker?.app === 'dsh-editor' && marker.schema === 1
  } catch {
    return false
  }
}

function baselineSpec(name) {
  return `link:./bundled-packages/node_modules/${name}`
}

function isDistributionSpec(spec, name) {
  return spec === baselineSpec(name) || spec === `file:./bundled-packages/node_modules/${name}`
}

async function readNativeSpec(profileRoot, name) {
  try {
    const manifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'))
    const spec = manifest?.dependencies?.[name]
    return typeof spec === 'string' ? spec : undefined
  } catch {
    return undefined
  }
}

async function isSafePackageDest(dest, treeRoot) {
  if (!isInside(treeRoot, dest) || resolve(dest) === resolve(treeRoot)) return false
  if (!existsSync(dest)) return true
  const info = await lstat(dest)
  if (info.isSymbolicLink()) {
    let target
    try { target = await realpath(dest) } catch { return false }
    return isInside(treeRoot, target)
  }
  return info.isDirectory()
}

async function copyShipped(source, dest) {
  const lib = join(source, 'lib')
  if (!existsSync(lib)) throw new Error(`Missing artifact: ${lib}`)
  await rm(join(dest, 'lib'), COPY_RM)
  await mkdir(dest, { recursive: true })
  await cp(lib, join(dest, 'lib'), { recursive: true, dereference: true, filter: packageCopyFilter(lib, { omitMaps: true }) })
  for (const extra of ['cordis.patch.yml', 'resources']) {
    const from = join(source, extra)
    if (!existsSync(from)) continue
    const to = join(dest, extra)
    const info = await lstat(from)
    if (info.isDirectory()) {
      await rm(to, COPY_RM)
      await cp(from, to, { recursive: true, dereference: true, filter: packageCopyFilter(from, { omitMaps: true }) })
    } else {
      await cp(from, to, { dereference: true })
    }
  }
}

function packageSyncLockPath(root, name) {
  return join(root, '.dev', 'desktop-sync-locks', encodeURIComponent(name))
}

async function withPackageSyncLock(root, name, work) {
  const lockfilePath = packageSyncLockPath(root, name)
  await mkdir(dirname(lockfilePath), { recursive: true })
  const release = await lockfile.lock(lockfilePath, { ...SYNC_LOCK_OPTIONS, lockfilePath })
  try {
    return await work()
  } finally {
    await release()
  }
}

async function runWrapClient(name, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wrapClientScript, name], {
      cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code) => (
      code === 0 ? resolvePromise() : reject(new Error(`wrap-client ${name} exited ${code}`))
    ))
  })
}

async function artifactMaps(treeRoot, composition, runtimeRoot) {
  const names = compositionInstallNames(composition)
  const appNames = new Set(names)
  const bundledRoot = resolve(treeRoot, 'bundled-packages', 'node_modules')
  const artifacts = Object.fromEntries(names.map((item) => [item, packagePath(bundledRoot, item)]))
  const runtimes = {}
  for (const item of await materializedRuntimePackageNames(runtimeRoot)) {
    if (appNames.has(item)) continue
    runtimes[item] = packagePath(resolve(treeRoot, 'runtime-links', 'node_modules'), item)
  }
  return { artifacts, runtimes, bundledRoot }
}

async function writeProjected(name, source, dest, artifacts, runtimes) {
  const projected = await projectNativePackageManifest({ source, destination: dest, artifacts, runtimes })
  const faceted = applyDistributionManifestFacets(name, projected)
  await writeFile(join(dest, 'package.json'), `${JSON.stringify(faceted, null, 2)}\n`)
}

async function syncPackageTree(name, source, treeRoot, runtimeRoot, composition, { createModules, honorNativeSpec }) {
  const { artifacts, runtimes, bundledRoot } = await artifactMaps(treeRoot, composition, runtimeRoot)
  const bundledDest = packagePath(bundledRoot, name)
  if (await isSafePackageDest(bundledDest, bundledRoot)) {
    await mkdir(dirname(bundledDest), { recursive: true })
    await copyShipped(source, bundledDest)
    await writeProjected(name, source, bundledDest, artifacts, runtimes)
  }
  const modulesRoot = resolve(treeRoot, 'node_modules')
  const modulesDest = packagePath(modulesRoot, name)
  const spec = honorNativeSpec ? await readNativeSpec(treeRoot, name) : undefined
  const overridden = honorNativeSpec && composition.packages.includes(name) && spec !== undefined && !isDistributionSpec(spec, name)
  const missing = !createModules && !existsSync(modulesDest)
  if (overridden || missing) return
  if (!(await isSafePackageDest(modulesDest, modulesRoot))) return
  if (existsSync(modulesDest) && (await lstat(modulesDest)).isSymbolicLink()) return
  await mkdir(dirname(modulesDest), { recursive: true })
  await copyShipped(source, modulesDest)
  await writeProjected(name, source, modulesDest, artifacts, runtimes)
}

/**
 * Copy one selected workspace package's compiled output into the retained
 * desktop-dev artifact trees. Does not rewrite native root manifests, locks,
 * profile-config, or unowned/removed live modules.
 */
export async function syncDesktopDevPackage(name, options = {}) {
  assertPackageName(name)
  const root = resolve(options.root ?? repoRoot)
  const composition = options.composition ?? await desktopComposition()
  if (!compositionInstallNames(composition).includes(name)) {
    throw new Error(`package ${name} is not in the selected composition`)
  }
  if (name in externalPluginPins(root)) {
    throw new Error(`package ${name} is not a local workspace watcher`)
  }
  const source = resolve(options.source ?? workspacePackageDir(name))
  if (!options.source && resolve(source) !== resolve(workspacePackageDir(name))) {
    throw new Error(`package ${name} source is not the workspace package directory`)
  }
  if (!existsSync(join(source, 'package.json'))) throw new Error(`Missing artifact: ${join(source, 'package.json')}`)
  const wrap = options.wrapClient ?? clientPackages(loadPluginManifests(root)).includes(name)
  const runtimeRoot = resolve(options.runtimeRoot ?? join(root, '.dev', 'desktop-dsh-runtime-0.2.1-rc.5'))
  const templateRoot = resolve(options.templateRoot ?? join(root, '.dev', 'desktop-profile-template'))
  if (!existsSync(templateRoot)) throw new Error(`desktop profile template is missing: ${templateRoot}`)
  const profileRoot = resolve(options.profileRoot ?? join(root, '.dev', 'desktop-home', 'profiles', 'dsh-editor'))
  await withPackageSyncLock(root, name, async () => {
    if (wrap) await runWrapClient(name, source)
    await syncPackageTree(name, source, templateRoot, runtimeRoot, composition, { createModules: true, honorNativeSpec: false })
    if (existsSync(profileRoot) && await isOwnedProfile(profileRoot)) {
      await syncPackageTree(name, source, profileRoot, runtimeRoot, composition, { createModules: false, honorNativeSpec: true })
    }
  })
  console.log(`desktop-dev-sync: ${name}`)
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(entry).toLowerCase()
  } catch {
    return false
  }
}

if (isDirectRun()) {
  await syncDesktopDevPackage(process.argv[2])
}
