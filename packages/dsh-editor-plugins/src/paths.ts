import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
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
const PLUGIN_FOLDER = `${sep}node_modules${sep}dsh-editor-plugins${sep}`

export function profileDirFromPluginModule(moduleUrl: string): string | undefined {
  try {
    const file = fileURLToPath(moduleUrl)
    const index = file.toLowerCase().lastIndexOf(PLUGIN_FOLDER.toLowerCase())
    if (index === -1) return undefined
    return file.slice(0, index)
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
  const discovered = moduleUrl ? profileDirFromPluginModule(moduleUrl) : undefined
  const userHome = homeDirectory ?? homedir()
  const home = env.DSH_HOME?.trim() || (discovered ? dirname(dirname(discovered)) : join(userHome, profile === 'dsh-editor' ? '.dsh-editor' : '.dsh'))
  return {
    home,
    profile,
    profileDir: discovered ?? join(home, 'profiles', profile),
    stateFile: join(home, 'dsh-plugins.json'),
    patchFile: join(home, 'cordis.patch.yml'),
    userPluginsDir: join(home, 'user-plugins'),
  }
}
