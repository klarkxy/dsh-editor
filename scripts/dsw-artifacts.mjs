import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'

const wanted = name => /^@deepseek-ai\/dsh-client-ui-/.test(name)
  || name === '@deepseek-ai/dsh-web-frontend' || name.startsWith('@klarkxy/')
const textFile = /\.(?:[cm]?js|ts|tsx|css)$/

function resolveManifest(owner, name, root) {
  const require = createRequire(owner)
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = join(directory, name, 'package.json')
    if (!existsSync(candidate)) continue
    const resolved = realpathSync(candidate)
    const location = relative(root, resolved)
    if (location !== '..' && !location.startsWith('../') && !location.startsWith('..\\') && !isAbsolute(location)) return resolved
  }
}

/** Scan installed dependency edges, never unrelated or stale virtual-store entries. */
export function collectDswVars(manifests) {
  const root = realpathSync(dirname(manifests[0]))
  const visited = new Set()
  const workspaces = new Set(manifests.map(file => realpathSync(file)))
  const found = new Set()
  const scan = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const file = join(directory, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (entry.isFile() && textFile.test(entry.name)) {
        for (const match of readFileSync(file, 'utf8').matchAll(/--(?:dsw|ds)-[a-zA-Z0-9_-]*/g)) {
          if (!match[0].endsWith('-')) found.add(match[0])
        }
      }
    }
  }
  const visit = manifest => {
    manifest = realpathSync(manifest)
    if (visited.has(manifest)) return
    visited.add(manifest)
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (wanted(pkg.name ?? '')) scan(dirname(manifest))
    const dependencies = {
      ...pkg.peerDependencies, ...pkg.optionalDependencies, ...pkg.dependencies,
      ...(workspaces.has(manifest) ? pkg.devDependencies : {}),
    }
    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith('@deepseek-ai/') && !name.startsWith('@klarkxy/') && !name.startsWith('dsh-')) continue
      const dependency = resolveManifest(manifest, name, root)
      if (dependency) visit(dependency)
      else if (!(name in (pkg.optionalDependencies ?? {})) && !pkg.peerDependenciesMeta?.[name]?.optional) {
        throw new Error(`DSW scan cannot resolve ${name} from ${manifest}`)
      }
    }
  }
  for (const manifest of manifests) visit(manifest)
  return [...found].sort()
}
