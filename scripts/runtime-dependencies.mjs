import { existsSync, realpathSync } from 'node:fs'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { incompatiblePackageError, packageSupportsPlatform } from './package-platform.mjs'

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

function physicallyInside(root, target) {
  const rel = relative(realpathSync(root), realpathSync(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function tryLocatePackageRoot(packageManifest, name, boundaryRoot) {
  const ownerRequire = createRequire(packageManifest)
  for (const dir of ownerRequire.resolve.paths(`${name}/package.json`) ?? []) {
    const candidate = join(dir, name)
    if (!existsSync(join(candidate, 'package.json'))) continue
    const actual = realpathSync(candidate)
    if (boundaryRoot && !physicallyInside(boundaryRoot, actual)) continue
    return actual
  }
}

function runtimeManifest(runtimeRoot) {
  return resolve(runtimeRoot, 'package.json')
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

function runtimeDependencyDeclarations(pkg) {
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})])
  return [...names].map(name => ({
    name,
    optional: name in (pkg.optionalDependencies ?? {})
      || (!(name in (pkg.dependencies ?? {})) && pkg.peerDependenciesMeta?.[name]?.optional === true),
  }))
}

async function copyRuntimeDependency(runtimeRoot, { name, packageManifest, optional = false }, visited) {
  const sourceRoot = tryLocatePackageRoot(packageManifest, name)
  if (!sourceRoot) {
    if (optional) return false
    throw new Error(`bundled runtime dependency cannot resolve ${name}`)
  }
  const sourcePackage = await readJson(join(sourceRoot, 'package.json'))
  if (sourcePackage.name !== name) throw new Error(`runtime dependency identity mismatch: expected ${name}, found ${sourcePackage.name}`)
  if (!packageSupportsPlatform(sourcePackage)) {
    if (optional) return false
    throw incompatiblePackageError(sourcePackage, packageManifest)
  }
  const previous = visited.get(name)
  if (previous !== undefined) {
    if (previous !== sourcePackage.version) {
      throw new Error(`bundled runtime dependency conflict for ${name}: expected ${sourcePackage.version}, found ${name}@${previous}`)
    }
    return true
  }
  visited.set(name, sourcePackage.version)
  const destination = resolve(runtimeRoot, 'node_modules', ...name.split('/'))
  const bundledRoot = tryLocatePackageRoot(runtimeManifest(runtimeRoot), name, runtimeRoot)
  if (bundledRoot) {
    const bundled = await readJson(join(bundledRoot, 'package.json'))
    if (bundled.name !== name || bundled.version !== sourcePackage.version) {
      throw new Error(`bundled runtime dependency conflict for ${name}: expected ${sourcePackage.version}, found ${bundled.name}@${bundled.version}`)
    }
  } else {
    await mkdir(dirname(destination), { recursive: true })
    await cp(sourceRoot, destination, { recursive: true, dereference: true, filter: runtimeDependencyCopyFilter(sourceRoot) })
  }
  for (const dependency of runtimeDependencyDeclarations(sourcePackage)) {
    let installed
    try {
      installed = await copyRuntimeDependency(runtimeRoot, { ...dependency, packageManifest: join(sourceRoot, 'package.json') }, visited)
    } catch (error) {
      if (String(error?.message ?? '').includes(`cannot resolve ${dependency.name}`)) {
        throw new Error(`bundled runtime dependency ${name} cannot resolve ${dependency.name}`)
      }
      throw error
    }
    if (installed && !tryLocatePackageRoot(runtimeManifest(runtimeRoot), dependency.name, runtimeRoot)) {
      throw new Error(`bundled runtime dependency ${name} cannot resolve ${dependency.name}`)
    }
  }
  return true
}

/** Keep copied development and packaged runtimes on the same declared dependency closure. */
export async function copyRuntimeDependencies(runtimeRoot, dependencies) {
  const visited = new Map()
  for (const dependency of dependencies) await copyRuntimeDependency(runtimeRoot, dependency, visited)
}
