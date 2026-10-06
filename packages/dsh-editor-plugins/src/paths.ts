import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type PluginPaths = {
  home: string
  profile: string
  profileDir: string
  stateFile: string
  patchFile: string
  userPluginsDir: string
}

const PROFILE_NAME = /^[A-Za-z0-9._-]+$/
const PLUGIN_MARKERS = [`${sep}node_modules${sep}dsh-editor-plugins${sep}`, '/node_modules/dsh-editor-plugins/']
const RETAINED_TREES = new Set(['bundled-packages', 'runtime-links'])

function pluginRootFromFile(file: string): string | undefined {
  const lower = file.toLowerCase()
  let index = -1
  for (const marker of PLUGIN_MARKERS) {
    const found = lower.lastIndexOf(marker.toLowerCase())
    if (found > index) index = found
  }
  return index === -1 ? undefined : file.slice(0, index)
}

function canonicalizeProfileDir(candidate: string): string | undefined {
  let dir = candidate
  while (RETAINED_TREES.has(basename(dir))) {
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  while (true) {
    const parent = dirname(dir)
    if (parent === dir) break
    const base = basename(dir)
    const parentBase = basename(parent)
    if (base === 'node_modules' || base === '.pnpm' || parentBase === '.pnpm') {
      dir = parent
      continue
    }
    break
  }
  return basename(dirname(dir)) === 'profiles' ? dir : undefined
}

/** Physical profile directory that loaded this package, if the URL is a known DSH profile layout. */
export function profileDirFromPluginModule(moduleUrl: string): string | undefined {
  try {
    const file = fileURLToPath(moduleUrl)
    const root = pluginRootFromFile(file)
    return root ? canonicalizeProfileDir(root) : undefined
  } catch {
    return undefined
  }
}

export function resolvePluginPaths(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  homeDirectory: string | undefined = homedir(),
  moduleUrl?: string,
): PluginPaths {
  const flag = argv.indexOf('--profile')
  const profile = flag >= 0 && argv[flag + 1] && PROFILE_NAME.test(argv[flag + 1]) ? argv[flag + 1] : 'dsh-editor'
  const userHome = homeDirectory ?? homedir()
  const explicitHome = env.DSH_HOME?.trim()
  const discoveredDir = moduleUrl ? profileDirFromPluginModule(moduleUrl) : undefined
  const discoveredHome = discoveredDir ? dirname(dirname(discoveredDir)) : undefined
  const home = explicitHome || discoveredHome || join(userHome, profile === 'dsh-editor' ? '.dsh-editor' : '.dsh')
  const profileDir = explicitHome || !discoveredDir ? join(home, 'profiles', profile) : discoveredDir
  return {
    home,
    profile,
    profileDir,
    stateFile: join(home, 'dsh-plugins.json'),
    patchFile: join(home, 'cordis.patch.yml'),
    userPluginsDir: join(home, 'user-plugins'),
  }
}
