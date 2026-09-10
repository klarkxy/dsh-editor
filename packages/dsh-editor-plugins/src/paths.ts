import { homedir } from 'node:os'
import { join } from 'node:path'

export type PluginPaths = {
  home: string
  profile: string
  profileDir: string
  stateFile: string
  patchFile: string
  userPluginsDir: string
}

const PROFILE_NAME = /^[A-Za-z0-9._-]+$/

export function resolvePluginPaths(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  homeDirectory: string = homedir(),
): PluginPaths {
  const flag = argv.indexOf('--profile')
  const profile = flag >= 0 && argv[flag + 1] && PROFILE_NAME.test(argv[flag + 1]) ? argv[flag + 1] : 'dsh-editor'
  const home = env.DSH_HOME?.trim() || join(homeDirectory, profile === 'dsh-editor' ? '.dsh-editor' : '.dsh')
  return {
    home,
    profile,
    profileDir: join(home, 'profiles', profile),
    stateFile: join(home, 'dsh-plugins.json'),
    patchFile: join(home, 'cordis.patch.yml'),
    userPluginsDir: join(home, 'user-plugins'),
  }
}
