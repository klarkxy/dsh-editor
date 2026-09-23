import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'

/** Produce an ordinary, self-contained Node installation from npm or pnpm's linked tree. */
export async function materializeDsh(source, destination, filter = () => true) {
  const root = resolve(destination)
  const assigned = new Map()
  const copied = new Set()
  const manifests = new Map()
  async function manifest(source) {
    if (!manifests.has(source)) manifests.set(source, JSON.parse(await readFile(join(source, 'package.json'), 'utf8')))
    return manifests.get(source)
  }
  async function locate(owner, name, optional = false) {
    for (const dir of createRequire(join(owner, 'package.json')).resolve.paths(name) ?? []) {
      const candidate = join(dir, name)
      if (existsSync(join(candidate, 'package.json'))) return realpath(candidate)
    }
    if (optional) return undefined
    throw new Error(`DSH runtime dependency missing: ${name} from ${owner}`)
  }
  async function dependencies(source) {
    const pkg = await manifest(source)
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies }
    for (const name of Object.keys(pkg.peerDependencies ?? {})) if (!(name in deps)) deps[name] = pkg.peerDependencies[name]
    const rows = []
    for (const name of Object.keys(deps)) {
      const optional = name in (pkg.optionalDependencies ?? {}) || pkg.peerDependenciesMeta?.[name]?.optional === true
      const resolved = await locate(source, name, optional)
      if (resolved) rows.push({ name, source: resolved })
    }
    return rows
  }
  function destinationFor(owner, name, source) {
    const searches = createRequire(join(owner, 'package.json')).resolve.paths(name) ?? []
    for (const dir of searches) {
      const candidate = join(dir, name)
      if (!candidate.startsWith(root + sep)) continue
      if (!assigned.has(candidate)) continue
      if (assigned.get(candidate) === source) return candidate
      // An incompatible nearer copy shadows ancestors. Install alongside the consumer.
      break
    }
    const top = join(root, 'node_modules', name)
    return !assigned.has(top) ? top : join(owner, 'node_modules', name)
  }
  async function install(source, target) {
    if (copied.has(target)) return
    copied.add(target)
    assigned.set(target, source)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, dereference: true, filter: file => {
      const relative = file.slice(source.length).replaceAll('\\', '/').replace(/^\//, '')
      return relative !== 'node_modules' && !relative.startsWith('node_modules/') && filter(file)
    } })
    for (const dep of await dependencies(source)) {
      const next = destinationFor(target, dep.name, dep.source)
      await install(dep.source, next)
    }
  }
  const actual = await realpath(source)
  // Direct runtime dependencies take precedence over transitive versions.
  for (const dep of await dependencies(actual)) assigned.set(join(root, 'node_modules', dep.name), dep.source)
  await install(actual, root)
  await writeFile(join(root, '.dsh-editor-materialized'), JSON.stringify({ version: (await manifest(actual)).version, packages: copied.size }))
  return { packages: copied.size }
}
