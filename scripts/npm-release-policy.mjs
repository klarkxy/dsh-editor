/** Two-package npm release policy. Registry state is the recovery source of truth. */
import { createHash } from 'node:crypto'

export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]))
}

export function packageContentHash(entries) {
  const hash = createHash('sha256')
  for (const [name, original] of [...entries].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    let bytes = Buffer.from(original)
    if (name === 'package/package.json') {
      const manifest = JSON.parse(bytes.toString('utf8'))
      for (const field of ['version', 'dshRelease', 'gitHead', '_id', '_nodeVersion', '_npmVersion']) delete manifest[field]
      bytes = Buffer.from(JSON.stringify(stableJson(manifest)))
    }
    hash.update(`${name}\0${bytes.length}\0`).update(bytes)
  }
  return `sha256-${hash.digest('hex')}`
}

function parts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Expected a stable x.y.z version, received ${version}`)
  return version.split('.').map(Number)
}
export function compareVersions(left, right) {
  const a = parts(left), b = parts(right)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function planPackage(manifest, registry, contentHash) {
  parts(manifest.version)
  if (!registry) return { action: 'publish', version: manifest.version, contentHash, reason: 'first publication' }
  const latest = registry.versions?.[registry['dist-tags']?.latest]
  if (!latest || latest.name !== manifest.name) throw new Error(`Invalid latest metadata for ${manifest.name}`)
  parts(latest.version)
  if (latest.dshRelease?.contentHash === contentHash) {
    return { action: 'skip', version: latest.version, contentHash, reason: 'published content is unchanged' }
  }
  const stable = Object.keys(registry.versions).filter(v => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))
  const highest = stable.sort(compareVersions).at(-1)
  if (!highest) throw new Error(`No stable version found for ${manifest.name}`)
  const next = parts(highest); next[2] += 1
  const version = next.join('.')
  return { action: 'publish', version, contentHash, reason: 'published content changed' }
}

export function verifyPublished(remote, expected) {
  if (!remote) throw new Error(`Registry has not exposed ${expected.name}@${expected.version} yet`)
  const mismatches = [
    ['name', remote.name, expected.name],
    ['version', remote.version, expected.version],
    ['dist.integrity', remote.dist?.integrity, expected.integrity],
    ['dshRelease.contentHash', remote.dshRelease?.contentHash, expected.contentHash],
  ].filter(([, actual, wanted]) => actual !== wanted).map(([field]) => field)
  if (mismatches.length) throw new Error(`Registry confirmation did not match ${expected.name}@${expected.version} (${mismatches.join(', ')})`)
}

/** A failed CLI receipt may still mean the PUT reached npm. Never bump again here. */
export async function publishAndConfirm(expected, io) {
  let publishError
  try { await io.publish() } catch (error) { publishError = error }
  // Version and full-package metadata can become visible at different times.
  // Bound the whole confirmation phase, including requests, to five minutes.
  // Both endpoints must satisfy the same identity checks; never repeat the upload.
  const now = io.now ?? Date.now
  const deadline = now() + 5 * 60 * 1000
  let confirmationError
  for (let attempt = 0; now() < deadline; attempt++) {
    const errors = []
    for (const [label, read] of [['version endpoint', io.readVersion], ['package metadata', io.readPackageVersion]]) {
      const remaining = deadline - now()
      if (remaining <= 0) break
      try {
        verifyPublished(await read(expected.name, expected.version, remaining), expected)
        return { recovered: Boolean(publishError) }
      } catch (error) { errors.push(`${label}: ${error.message}`) }
    }
    confirmationError = errors.join('; ')
    const remaining = deadline - now()
    if (remaining > 0) await io.wait(Math.min(2000 * 2 ** attempt, 30000, remaining))
  }
  throw new Error(`Publication state is unconfirmed for ${expected.name}@${expected.version}; rerun to reconcile before releasing again. ${publishError ? `Publish command: ${publishError.message}. ` : ''}${confirmationError}`)
}

/** Explicit publishConfig opt-in keeps desktop-only and unscoped packages private to this workflow. */
export function orderReleaseTargets(packages) {
  const targets = packages.filter(({ manifest }) => manifest.private !== true && manifest.publishConfig?.access === 'public' && /^@klarkxy\/[^/]+$/.test(manifest.name))
  const byName = new Map()
  for (const target of targets) {
    if (!/^packages\/[A-Za-z0-9._-]+$/.test(target.directory) || !/^@klarkxy\/[a-z0-9][a-z0-9._-]*$/.test(target.manifest.name)) throw new Error('Invalid release directory or package identity')
    if (byName.has(target.manifest.name)) throw new Error(`Duplicate release package ${target.manifest.name}`)
    byName.set(target.manifest.name, target)
  }
  for (const target of targets) {
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(target.manifest[field] ?? {})) {
        if (range.startsWith('workspace:') && !byName.has(name)) throw new Error(`${target.manifest.name} references workspace dependency ${name} which is not enabled for public CI publication`)
      }
    }
  }
  const ordered = [], active = new Set(), complete = new Set(), stack = []
  const visit = name => {
    if (complete.has(name)) return
    if (active.has(name)) throw new Error(`Cyclic publish dependencies: ${[...stack, name].join(' -> ')}`)
    active.add(name); stack.push(name)
    const target = byName.get(name)
    const dependencies = [...new Set(['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap(field => Object.keys(target.manifest[field] ?? {})))].filter(name => byName.has(name)).sort()
    for (const dependency of dependencies) visit(dependency)
    stack.pop(); active.delete(name); complete.add(name)
    ordered.push({ name, directory: target.directory, dependencies })
  }
  for (const name of [...byName.keys()].sort()) visit(name)
  return ordered
}
