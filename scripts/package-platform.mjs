/** npm's os/cpu lists: deny matches win, and a sole "any" allows every target. */
function matchesPlatformList(value, constraint) {
  if (!constraint) return true
  const entries = typeof constraint === 'string' ? [constraint] : constraint
  if (entries.length === 1 && entries[0] === 'any') return true
  return !entries.includes(`!${value}`)
    && (entries.every(entry => entry.startsWith('!')) || entries.includes(value))
}

// Keep native packaging consistent with npm-install-checks without depending on npm's CLI.
export function packageSupportsPlatform(pkg, platform = process.platform, arch = process.arch) {
  return matchesPlatformList(platform, pkg.os) && matchesPlatformList(arch, pkg.cpu)
}

export function incompatiblePackageError(pkg, owner) {
  return new Error(`Required runtime package ${pkg.name}@${pkg.version} from ${owner} is incompatible with ${process.platform}-${process.arch}: os=${JSON.stringify(pkg.os ?? 'any')}, cpu=${JSON.stringify(pkg.cpu ?? 'any')}`)
}
