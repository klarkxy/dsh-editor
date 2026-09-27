import { isAbsolute, relative, resolve } from 'node:path'

/** Filter within a package, never against its node_modules-containing parent path. */
export function packageCopyFilter(packageRoot, { omitMaps = false } = {}) {
  const root = resolve(packageRoot)
  return source => {
    const path = relative(root, source).replaceAll('\\', '/')
    if (!path) return true
    if (isAbsolute(path) || path === '..' || path.startsWith('../')) return false
    if (path.split('/').some(part => ['node_modules', 'src', 'test'].includes(part))) return false
    if (path === 'tsconfig.json' || path.endsWith('/tsconfig.json')) return false
    if (path === 'tsdown.config.ts' || path.endsWith('/tsdown.config.ts')) return false
    return !(omitMaps && path.endsWith('.map'))
  }
}
