import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { profileDirFromPluginModule, resolvePluginPaths } from './paths.ts'

function posix(path: string): string {
  return path.replaceAll('\\', '/')
}

function pluginModule(profileDir: string, nested: string[] = ['node_modules', 'dsh-editor-plugins', 'lib', 'index.js']): string {
  return pathToFileURL(join(profileDir, ...nested)).href
}

describe('plugin paths', () => {
  it('uses DSH_HOME and the selected profile even when the module lives under retained artifacts', () => {
    const canonicalHome = 'D:/editor-home'
    const artifactProfile = join(tmpdir(), 'artifact-home', 'profiles', 'dsh-editor')
    const moduleUrl = pluginModule(artifactProfile, ['bundled-packages', 'node_modules', 'dsh-editor-plugins', 'lib', 'index.js'])
    const paths = resolvePluginPaths(
      { DSH_HOME: canonicalHome },
      ['node', 'dsh', '--profile', 'dsh-editor'],
      'D:/Users/x',
      moduleUrl,
    )
    expect(paths.home).toBe(canonicalHome)
    expect(paths.profile).toBe('dsh-editor')
    expect(posix(paths.profileDir)).toBe(posix(join(canonicalHome, 'profiles', 'dsh-editor')))
    expect(posix(paths.patchFile)).toBe('D:/editor-home/cordis.patch.yml')
  })

  it('discovers an ordinary profile/node_modules source when DSH_HOME is unset', () => {
    const home = join(tmpdir(), 'isolated-home')
    const profileDir = join(home, 'profiles', 'dsh-editor')
    const moduleUrl = pluginModule(profileDir)
    expect(profileDirFromPluginModule(moduleUrl)).toBe(profileDir)
    const paths = resolvePluginPaths({}, ['node', 'dsh'], join(tmpdir(), 'other-user'), moduleUrl)
    expect(paths.profileDir).toBe(profileDir)
    expect(paths.home).toBe(home)
  })

  it('strips bundled-packages from artifact fallback discovery', () => {
    const home = join(tmpdir(), 'artifact-fallback-home')
    const profileDir = join(home, 'profiles', 'dsh-editor')
    const moduleUrl = pluginModule(profileDir, ['bundled-packages', 'node_modules', 'dsh-editor-plugins', 'lib', 'index.js'])
    expect(profileDirFromPluginModule(moduleUrl)).toBe(profileDir)
    const paths = resolvePluginPaths({}, ['node', 'dsh'], join(tmpdir(), 'other-user'), moduleUrl)
    expect(paths.profileDir).toBe(profileDir)
    expect(paths.home).toBe(home)
  })

  it('does not invent a writing home from workspace or SDK .pnpm module URLs', () => {
    const user = join(tmpdir(), 'user-home')
    const workspace = pluginModule(join(tmpdir(), 'repo', 'packages', 'dsh-editor-plugins'), ['lib', 'index.js'])
    expect(profileDirFromPluginModule(workspace)).toBeUndefined()
    const hoisted = pluginModule(join(tmpdir(), 'repo'), ['node_modules', 'dsh-editor-plugins', 'lib', 'index.js'])
    expect(profileDirFromPluginModule(hoisted)).toBeUndefined()
    const sdk = pluginModule(
      join(tmpdir(), 'desktop-dsh-runtime-0.2.0-rc.2'),
      ['node_modules', '.pnpm', 'dsh-editor-plugins@0.1.0', 'node_modules', 'dsh-editor-plugins', 'lib', 'index.js'],
    )
    expect(profileDirFromPluginModule(sdk)).toBeUndefined()
    const paths = resolvePluginPaths({}, ['node', 'dsh'], user, sdk)
    expect(paths.home).toBe(join(user, '.dsh-editor'))
    expect(paths.profileDir).toBe(join(user, '.dsh-editor', 'profiles', 'dsh-editor'))
  })

  it('keeps a valid --profile flag and ignores an invalid one', () => {
    const home = 'D:/editor-home'
    const web = resolvePluginPaths({ DSH_HOME: home }, ['node', 'dsh', '--profile', 'web'], 'D:/Users/x')
    expect(web.profile).toBe('web')
    expect(posix(web.profileDir)).toBe(posix(join(home, 'profiles', 'web')))
    const invalid = resolvePluginPaths({ DSH_HOME: home }, ['node', 'dsh', '--profile', '../x'], 'D:/Users/x')
    expect(invalid.profile).toBe('dsh-editor')
    expect(posix(invalid.profileDir)).toBe(posix(join(home, 'profiles', 'dsh-editor')))
  })

  it('treats an invalid module URL as the existing default home', () => {
    const user = join(tmpdir(), 'default-user')
    const paths = resolvePluginPaths({}, ['node', 'dsh'], user, 'not-a-file-url')
    expect(paths.home).toBe(join(user, '.dsh-editor'))
    expect(paths.profile).toBe('dsh-editor')
    expect(paths.profileDir).toBe(join(user, '.dsh-editor', 'profiles', 'dsh-editor'))
    expect(profileDirFromPluginModule('not-a-file-url')).toBeUndefined()
  })
})
