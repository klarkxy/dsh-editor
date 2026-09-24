import { existsSync } from 'node:fs'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

function runtimeDependencyCopyFilter(packageRoot) {
  return (source) => {
    const normalized = source.slice(packageRoot.length).replaceAll('\\', '/').replace(/^\//, '')
    if (!normalized) return true
    if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return false
    if (/\.(?:map|d\.ts|d\.mts|d\.cts)$/.test(normalized)) return false
    return true
  }
}

async function copyRuntimeDependency(runtimeRoot, { name, packageManifest }) {
  const ownerRequire = createRequire(packageManifest)
  const sourceManifest = ownerRequire.resolve(`${name}/package.json`)
  const sourceRoot = dirname(sourceManifest)
  const sourcePackage = await readJson(sourceManifest)
  if (sourcePackage.name !== name) throw new Error(`runtime dependency identity mismatch: expected ${name}, found ${sourcePackage.name}`)
  const destination = resolve(runtimeRoot, 'node_modules', ...name.split('/'))
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

/** Keep copied development and packaged runtimes on the same declared dependency closure. */
export async function copyRuntimeDependencies(runtimeRoot, dependencies) {
  for (const dependency of dependencies) await copyRuntimeDependency(runtimeRoot, dependency)
}
