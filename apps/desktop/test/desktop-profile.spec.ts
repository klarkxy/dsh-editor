import { lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILE_DEPLOY_ALGORITHM, PROFILE_MARKER, ProfileCollisionError, deployOwnedProfile, deployProfile, resolveDshHome, type ProfileDeployIdentity } from '../src/profile.js';
import { sanitizeHostLockedPluginOverrides } from '../src/user-plugins.js';
import { syncPresetDeclarations as syncDesktopPresetDeclarations } from '../src/preset-config.js';

type CompositionRow = { id?: string; name?: unknown; group?: unknown; config?: unknown }

function compositionProblem(text: string): string | undefined {
  return entryListProblem(parseCompositionRows(text))
}

function entryListProblem(rows: unknown, at = ''): string | undefined {
  if (!Array.isArray(rows)) return at === '' ? 'the composition must be a top-level list of plugin rows' : `group ${at} must hold a list of plugin rows`
  for (const [index, row] of rows.entries()) {
    const label = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return `${label} is not a plugin row (expected a map with a "name")`
    const { name, group, config } = row as CompositionRow
    if (typeof name !== 'string' || name === '') return `${label} names no plugin (a "name" string is required)`
    if (group === true) {
      const nested = entryListProblem(config, label)
      if (nested !== undefined) return nested
    }
  }
}

function parseCompositionRows(text: string): CompositionRow[] {
  const roots: CompositionRow[] = []
  const stack: Array<{ indent: number; row: CompositionRow; kind: 'row' | 'config' }> = []
  const attach = (indent: number, row: CompositionRow) => {
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (!parent) roots.push(row)
    else if (parent.kind === 'config') {
      const list = Array.isArray(parent.row.config) ? parent.row.config as CompositionRow[] : []
      list.push(row)
      parent.row.config = list
    }
    stack.push({ indent, row, kind: 'row' })
  }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (trimmed.startsWith('- id:')) {
      attach(indent, { id: trimmed.slice('- id:'.length).trim() })
      continue
    }
    const current = stack[stack.length - 1]?.row as Record<string, unknown> | undefined
    if (!current) continue
    if (trimmed === 'config:' || trimmed === 'config: |' || trimmed === 'config: |-') {
      current.config = []
      stack.push({ indent, row: current, kind: 'config' })
      continue
    }
    const pair = trimmed.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!pair) continue
    const [, key, value] = pair
    if (key === 'config') {
      current.config = []
      stack.push({ indent, row: current, kind: 'config' })
      continue
    }
    current[key] = value === 'true' ? true : value === 'false' ? false : value
  }
  return roots
}

async function skillDirectoryNames(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function unquoteYaml(value: unknown): unknown {
  return typeof value === 'string' && /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value
}

function topLevelPluginRows(text: string): Array<{ id?: string; name?: unknown }> {
  return parseCompositionRows(text).map((row) => ({ id: row.id, name: unquoteYaml(row.name) }))
}

function parseSkillDocument(text: string): { name: string; description: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error('skill is missing YAML frontmatter')
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (!name || !description) throw new Error('skill frontmatter needs name and description')
  return { name, description }
}

describe('profile deployment', () => {
  it('keeps the conversation domain enabled for the custom chat projection', async () => {
    const patch = await readFile(join(import.meta.dirname, '..', 'resources', 'profile', 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toMatch(/- id: ui-conversation\s+disabled: true/)
  })
  it('honors DSH_HOME and otherwise isolates desktop state from the default DSH home', () => {
    expect(resolveDshHome({ DSH_HOME: 'D:/custom' }, 'D:/Users/example')).toBe('D:/custom')
    expect(resolveDshHome({ DSH_HOME: '   ' }, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh-editor'))
    expect(resolveDshHome({}, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh-editor'))
  })
  it('strips leftover host-locked plugin overrides before DSH boots', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-locked-overrides-'))
    await writeFile(join(home, 'dsh-plugins.json'), `${JSON.stringify({
      schema: 1,
      overrides: {
        'editor-novel-kernel': true,
        'editor-workbench-tools': true,
        zhihu: false,
      },
      presets: { 'dsh-editor-novel': true },
      installed: [],
    }, null, 2)}\n`)
    await writeFile(join(home, 'cordis.patch.yml'), [
      '# managed-by: dsh-editor-plugins',
      '- id: editor-novel-kernel',
      '  disabled: false',
      '- id: editor-workbench-tools',
      '  disabled: false',
      '- id: zhihu',
      '  disabled: true',
      '',
    ].join('\n'))
    await sanitizeHostLockedPluginOverrides(home)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toMatchObject({
      overrides: { zhihu: false },
      presets: { 'dsh-editor-novel': true },
    })
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe([
      '# managed-by: dsh-editor-plugins',
      '- id: zhihu',
      '  disabled: true',
      '',
    ].join('\n'))
  })
  it('fails closed on an unmarked collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const profile = join(root, 'profiles', 'dsh-editor')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{}')
    await expect(deployProfile(root, profile)).rejects.toBeInstanceOf(ProfileCollisionError)
  })
  it('stages an owned profile update and leaves no staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const existing = join(root, 'profiles', 'dsh-editor')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"version":2}')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, PROFILE_MARKER), '{"app":"dsh-editor","schema":1}')
    await writeFile(join(existing, 'package.json'), '{"version":1}')
    const installed = await deployProfile(root, template)
    expect(await readFile(join(installed, 'package.json'), 'utf8')).toContain('2')
    expect(existsSync(join(installed, PROFILE_MARKER))).toBe(true)
    expect((await (await import('node:fs/promises')).readdir(join(root, 'profiles'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('relinks user-installed plugins after replacing the owned profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }))
    const plugin = join(root, 'user-plugins', 'community-theme')
    await mkdir(plugin, { recursive: true })
    await writeFile(join(plugin, 'package.json'), '{"name":"community-theme","version":"1.0.0"}')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: {},
      installed: [{ name: 'community-theme', spec: 'github:acme/community-theme', version: '1.0.0' }],
    }))
    const installed = await deployProfile(root, template)
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toContain('community-theme')
    expect(manifest.dependencies?.['community-theme']).toMatch(/^file:/)
    expect(manifest.dependencies?.['community-theme']).not.toBe('*')
    expect(existsSync(join(installed, 'node_modules', 'community-theme', 'package.json'))).toBe(true)
    expect(existsSync(join(root, '.dsh-editor-native-plugins-migrated'))).toBe(true)
    await writeFile(join(installed, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await writeFile(join(installed, 'pnpm-workspace.yaml'), 'packages:\n  - .\nallowBuilds:\n  fixture: true\n')
    await writeFile(join(installed, '.npmrc'), 'registry=https://registry.npmjs.org/\n')
    const restaged = await deployProfile(root, template)
    const restagedManifest = JSON.parse(await readFile(join(restaged, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    expect(restagedManifest.dsh.profile.bundles).toContain('community-theme')
    expect(restagedManifest.dependencies?.['community-theme']).toMatch(/^file:/)
    expect(await readFile(join(restaged, 'pnpm-lock.yaml'), 'utf8')).toBe('lockfileVersion: 9.0\n')
    expect(await readFile(join(restaged, 'pnpm-workspace.yaml'), 'utf8')).toContain('allowBuilds:')
    expect(await readFile(join(restaged, '.npmrc'), 'utf8')).toBe('registry=https://registry.npmjs.org/\n')
    expect(JSON.parse(await readFile(join(root, 'dsh-plugins.json'), 'utf8')).installed).toEqual([])
  })
  it('points the agent preset default at the standard writing preset', async () => {
    const profileResources = join(import.meta.dirname, '..', 'resources', 'profile')
    const patch = await readFile(join(profileResources, 'cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor-writing/)
    expect(patch).not.toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor\s*$/m)
    expect(patch).toMatch(/- id: editor-workbench-tools\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-novel-kernel\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-workbench\r?\n  disabled: true/)
    const standard = await readFile(join(profileResources, 'agent-presets', 'dsh-editor-writing', 'agent.cordis.yml'), 'utf8')
    expect(standard).toContain('dsh-tool-ask-user')
    expect(standard).toContain('dsh-tool-fs')
    expect(standard).toMatch(/- id: tool-bash\r?\n  name: '@deepseek-ai\/dsh-tool-bash'\r?\n  disabled: true/)
    expect(standard).toMatch(/- id: tool-pwsh\r?\n  name: '@deepseek-ai\/dsh-tool-pwsh'\r?\n  disabled: true/)
    expect(standard).not.toMatch(/dsh-tool-(todo|goal|subagent|workflow|ralph)(?!-)/)
    expect(standard).not.toContain('dsh-plan-mode')
    expect(topLevelPluginRows(standard)).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona' },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
      { id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' },
      { id: 'editor-novel-kernel', name: 'dsh-editor-novel-kernel' },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'compaction', name: 'cordis:group' },
    ])
    expect(standard).toMatch(/- id: editor-novel-kernel\r?\n  name: dsh-editor-novel-kernel\r?\n  config:\r?\n    mode: knowledge-only/)
  })
  it('ships one standard writing preset with all writing skills and a parseable composition', async () => {
    const profileResources = join(import.meta.dirname, '..', 'resources', 'profile')
    const presetRoot = join(profileResources, 'agent-presets')
    const ids = (await readdir(presetRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(ids).toEqual(['dsh-editor-writing'])

    const presetDir = join(presetRoot, 'dsh-editor-writing')
    expect(JSON.parse(await readFile(join(presetDir, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
    const presetYml = await readFile(join(presetDir, 'preset.yml'), 'utf8')
    expect(presetYml.match(/^name:\s*(.+)$/m)?.[1]?.trim()).toBe('写作搭档')
    const composition = await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8')
    expect(compositionProblem(composition)).toBeUndefined()
    expect(composition).toContain('dsh-tool-ask-user')
    expect(composition).toContain('dsh-tool-fs')
    expect(composition).toContain('dsh-skill-filesystem')
    expect(composition).toContain('dsh-tool-skill')
    expect(composition).toContain("new URL('skills/', baseUrl)")
    expect(composition).toContain('writing_propose')
    expect(composition).toContain('作者确认')
    expect(composition).toMatch(/- id: tool-bash\r?\n  name: '@deepseek-ai\/dsh-tool-bash'\r?\n  disabled: true/)
    expect(composition).toMatch(/- id: tool-pwsh\r?\n  name: '@deepseek-ai\/dsh-tool-pwsh'\r?\n  disabled: true/)
    expect(composition).not.toMatch(/dsh-tool-(todo|goal|subagent|workflow|ralph)(?!-)/)
    expect(composition).not.toContain('dsh-plan-mode')
    expect(composition).not.toContain('{{cwd}}')
    const skillNames = await skillDirectoryNames(join(presetDir, 'skills'))
    expect(skillNames).toEqual(['article-writing', 'novel-writing', 'prose-revision', 'technical-writing'])
    for (const name of skillNames) {
      const skill = parseSkillDocument(await readFile(join(presetDir, 'skills', name, 'SKILL.md'), 'utf8'))
      expect(skill.name).toBe(name)
      expect(skill.description.length).toBeGreaterThan(0)
    }

    const { configureProfile, desktopComposition } = await import('../../../scripts/desktop-compositions.mjs')
    const compositionJson = await desktopComposition('desktop')
    const materialized = await mkdtemp(join(tmpdir(), 'dsh-template-'))
    await (await import('node:fs/promises')).cp(profileResources, materialized, { recursive: true })
    await configureProfile(materialized, compositionJson)
    const templateIds = (await readdir(join(materialized, 'agent-presets'))).sort()
    expect(templateIds).toEqual(['dsh-editor-writing'])

    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    await deployProfile(root, materialized)
    const deployed = (await readdir(join(root, '.agent-presets'))).sort()
    expect(deployed).toEqual(['dsh-editor-writing'])
    expect(await skillDirectoryNames(join(root, '.agent-presets', 'dsh-editor-writing', 'skills'))).toEqual(['article-writing', 'novel-writing', 'prose-revision', 'technical-writing'])

    /* 退役 preset 的 app-owned 目录在下一次部署时被清掉；不带 marker 的目录不动。 */
    for (const stale of ['dsh-editor', 'dsh-editor-novel', 'dsh-editor-article', 'dsh-editor-technical']) {
      const dir = join(root, '.agent-presets', stale)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'preset.yml'), 'name: stale\n')
      await writeFile(join(dir, PROFILE_MARKER), '{"app":"dsh-editor","schema":1}')
    }
    const foreign = join(root, '.agent-presets', 'author-preset')
    await mkdir(foreign, { recursive: true })
    await writeFile(join(foreign, 'preset.yml'), 'name: author\n')
    await writeFile(join(foreign, 'agent.cordis.yml'), '[]\n')
    await deployProfile(root, materialized)
    expect((await readdir(join(root, '.agent-presets'))).sort()).toEqual(['author-preset', 'dsh-editor-writing'])
    expect(await readFile(join(foreign, 'preset.yml'), 'utf8')).toBe('name: author\n')
  }, 15000)
  it('keeps scoped tools disabled after preparing the full composition', async () => {
    const { configureProfile, desktopComposition } = await import('../../../scripts/desktop-compositions.mjs')
    const aliases = ['basic', 'smart', 'full'] as const
    const resolved = await Promise.all(aliases.map((id) => desktopComposition(id)))
    const stripped = resolved.map(({ id: _id, label: _label, ...rest }) => rest)
    expect(stripped[0]).toEqual(stripped[1])
    expect(stripped[1]).toEqual(stripped[2])
    for (const item of resolved) {
      expect(item.features).toEqual(['assistant', 'completion', 'overview-panel', 'cards', 'memory-panel'])
      expect(item.packages).toContain('dsh-editor-cards')
      expect(item.disabledEntries).not.toContain('editor-cards')
      expect(item.packages).toContain('dsh-editor-memory-panel')
      expect(item.disabledEntries).not.toContain('editor-memory-panel')
      expect(item.extraInserts.map((row: { id: string }) => row.id)).not.toContain('editor-workbench-tools')
      expect(item.extraInserts.map((row: { id: string }) => row.id)).not.toContain('editor-novel-kernel')
    }
    const composition = resolved[2]!

    const destination = await mkdtemp(join(tmpdir(), 'dsh-prepared-'))
    await writeFile(join(destination, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: [] } },
    }))
    await configureProfile(destination, composition)
    const patch = await readFile(join(destination, 'node_modules', 'dsh-editor-profile-config', 'base.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: editor-workbench-tools\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-novel-kernel\r?\n  disabled: true/)
    // The editor's own plugin pages replace the official UI; Host management stays available.
    expect(patch).toMatch(/- id: ui-plugin-manager\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: plugin-manager\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-cards\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-memory-panel\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-workbench-tools\r?\n  disabled: false/)
    expect(patch).not.toMatch(/- id: editor-novel-kernel\r?\n  disabled: false/)
    expect(patch).not.toMatch(/- id: editor-workbench\r?\n  disabled: true/)
    // Native search stays enabled: only the host-wide tool-web row is guarded,
    // matching upstream dsh-web-app; presets mount the tool per scope instead.
    for (const id of ['web-search-deepseek', 'web-fetch-http']) {
      expect(patch).not.toMatch(new RegExp(`- id: ${id}\\r?\\n  disabled: true`))
    }
    expect(patch).toMatch(/- id: tool-web\r?\n  disabled: true/)
  })
  it('deploys app-owned agent presets into the harness-home user preset root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const preset = join(template, 'agent-presets', 'dsh-editor')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(preset, PROFILE_MARKER), '{"app":"dsh-editor","schema":1}')
    await deployProfile(root, template)
    const deployed = join(root, '.agent-presets', 'dsh-editor')
    expect(await readFile(join(deployed, 'agent.cordis.yml'), 'utf8')).toBe('[]\n')
    await writeFile(join(preset, 'agent.cordis.yml'), '# v2\n')
    await deployProfile(root, template)
    expect(await readFile(join(deployed, 'agent.cordis.yml'), 'utf8')).toBe('# v2\n')
    expect((await (await import('node:fs/promises')).readdir(join(root, '.agent-presets'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('keeps template package junctions as links so desktop restarts do not recopy plugin bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const pkg = join(root, 'packages', 'dsh-editor-shell')
    await mkdir(join(pkg, 'lib'), { recursive: true })
    await writeFile(join(pkg, 'lib', 'index.js'), 'export {}\n')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), '{}')
    await symlink(pkg, join(template, 'node_modules', 'dsh-editor-shell'), 'junction')
    const installed = await deployProfile(root, template)
    const linked = join(installed, 'node_modules', 'dsh-editor-shell', 'lib', 'index.js')
    expect(await readFile(linked, 'utf8')).toBe('export {}\n')
    await writeFile(join(pkg, 'lib', 'index.js'), 'export const live = 1\n')
    expect(await readFile(linked, 'utf8')).toBe('export const live = 1\n')
    expect((await lstat(join(installed, 'node_modules', 'dsh-editor-shell'))).isSymbolicLink()).toBe(true)
  })
  it('fails closed when a preset id is occupied by an unmarked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'agent-presets', 'dsh-editor'), { recursive: true })
    const occupied = join(root, '.agent-presets', 'dsh-editor')
    await mkdir(occupied, { recursive: true })
    await writeFile(join(occupied, 'agent.cordis.yml'), '[]\n')
    await expect(deployProfile(root, template)).rejects.toBeInstanceOf(ProfileCollisionError)
    expect(existsSync(join(root, 'profiles', 'dsh-editor'))).toBe(false)
  })
  it('deploys plugin-declared presets on restore and reclaims them once the plugin is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: [] } },
    }))
    const plugin = join(root, 'user-plugins', 'community-preset')
    await mkdir(join(plugin, 'agent-presets', 'team-style'), { recursive: true })
    await writeFile(join(plugin, 'package.json'), JSON.stringify({
      name: 'community-preset',
      version: '1.0.0',
      dshEditor: { presets: [{ id: 'team-style', path: 'agent-presets/team-style' }] },
    }))
    await writeFile(join(plugin, 'agent-presets', 'team-style', 'preset.yml'), 'name: 团队风格\n')
    await writeFile(join(plugin, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      installed: [{ name: 'community-preset', spec: 'github:acme/community-preset', version: '1.0.0' }],
    }))
    await deployProfile(root, template)
    const deployed = join(root, '.agent-presets', 'team-style')
    expect(await readFile(join(deployed, 'preset.yml'), 'utf8')).toBe('name: 团队风格\n')
    expect(JSON.parse(await readFile(join(deployed, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1, plugin: 'community-preset' })
    const profile = join(root, 'profiles', 'dsh-editor', 'package.json')
    const manifest = JSON.parse(await readFile(profile, 'utf8')) as { dependencies?: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    delete manifest.dependencies?.['community-preset']
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== 'community-preset')
    await writeFile(profile, `${JSON.stringify(manifest, null, 2)}\n`)
    await deployProfile(root, template)
    expect(existsSync(deployed)).toBe(false)
    expect((await (await import('node:fs/promises')).readdir(join(root, '.agent-presets'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('never deploys presets for template bundles, only for selected native extras', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const bundled = join(template, 'node_modules', 'first-party-pack')
    await mkdir(join(bundled, 'agent-presets', 'team-style'), { recursive: true })
    await writeFile(join(bundled, 'package.json'), JSON.stringify({
      name: 'first-party-pack',
      version: '1.0.0',
      dshEditor: { presets: [{ id: 'team-style', path: 'agent-presets/team-style' }] },
    }))
    await writeFile(join(bundled, 'agent-presets', 'team-style', 'preset.yml'), 'name: 内置\n')
    await writeFile(join(bundled, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['first-party-pack'] } },
    }))
    const installedSource = join(root, 'user-plugins', 'community-pack')
    await mkdir(join(installedSource, 'agent-presets', 'team-style'), { recursive: true })
    await writeFile(join(installedSource, 'package.json'), JSON.stringify({
      name: 'community-pack',
      version: '1.0.0',
      dshEditor: { presets: [{ id: 'team-style', path: 'agent-presets/team-style' }] },
    }))
    await writeFile(join(installedSource, 'agent-presets', 'team-style', 'preset.yml'), 'name: 市集\n')
    await writeFile(join(installedSource, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      installed: [{ name: 'community-pack', spec: 'github:acme/community-pack', version: '1.0.0' }],
    }))
    await deployProfile(root, template)
    expect(await readFile(join(root, '.agent-presets', 'team-style', 'preset.yml'), 'utf8')).toBe('name: 市集\n')
  })
  it('reuses an owned profile when the packaged deploy identity still matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const runtime = join(root, 'runtime', 'node_modules', '@deepseek-ai')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await mkdir(join(runtime, 'dsh-tools'), { recursive: true })
    await mkdir(join(runtime, 'dsh-llm'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }))
    await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
    await mkdir(join(template, 'node_modules', 'dsh-editor-shell'), { recursive: true })
    await writeFile(join(template, 'node_modules', 'dsh-editor-shell', 'package.json'), '{"name":"dsh-editor-shell"}')
    const id = deployIdentity({ nodePath: join(root, 'node.exe'), cliPath: join(root, 'dsh', 'lib', 'bin.js') })
    const first = await deployOwnedProfile(root, template, join(root, 'runtime', 'node_modules'), id)
    expect(first.reused).toBe(false)
    const sentinel = join(first.path, 'node_modules', 'sentinel.txt')
    await writeFile(sentinel, 'keep')
    const marker = JSON.parse(await readFile(join(first.path, PROFILE_MARKER), 'utf8')) as { deploy?: unknown }
    expect(marker.deploy).toEqual({
      algorithm: PROFILE_DEPLOY_ALGORITHM,
      profileSha256: id.profileSha256,
      dsh: id.dsh,
      nodePath: id.nodePath,
      cliPath: id.cliPath,
    })
    const second = await deployOwnedProfile(root, template, join(root, 'runtime', 'node_modules'), id)
    expect(second.reused).toBe(true)
    expect(await readFile(sentinel, 'utf8')).toBe('keep')
    expect((await readdir(join(root, 'profiles'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('restages when the template digest, runtime path, or required files change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"version":1}')
    await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
    const id = deployIdentity()
    const first = await deployOwnedProfile(root, template, undefined, id)
    await mkdir(join(first.path, 'node_modules'), { recursive: true })
    await writeFile(join(first.path, 'node_modules', 'sentinel.txt'), 'keep')
    const digestChanged = await deployOwnedProfile(root, template, undefined, deployIdentity({ profileSha256: 'other' }))
    expect(digestChanged.reused).toBe(false)
    expect(existsSync(join(digestChanged.path, 'node_modules', 'sentinel.txt'))).toBe(false)
    await mkdir(join(digestChanged.path, 'node_modules'), { recursive: true })
    await writeFile(join(digestChanged.path, 'node_modules', 'sentinel.txt'), 'keep')
    const pathChanged = await deployOwnedProfile(root, template, undefined, deployIdentity({ nodePath: 'D:/other/node.exe' }))
    expect(pathChanged.reused).toBe(false)
    await writeFile(join(pathChanged.path, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const oldMarker = await deployOwnedProfile(root, template, undefined, id)
    expect(oldMarker.reused).toBe(false)
    await rm(join(oldMarker.path, 'package.json'))
    const missing = await deployOwnedProfile(root, template, undefined, id)
    expect(missing.reused).toBe(false)
    expect(existsSync(join(missing.path, 'package.json'))).toBe(true)
  })
  it('still sanitizes locked overlays and ignores stale preset state on a stamp hit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const writing = join(template, 'agent-presets', 'dsh-editor-writing')
    await mkdir(writing, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"name":"dsh-editor-profile"}')
    await writeFile(join(template, 'composition.json'), '{}')
    await writeFile(join(writing, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(writing, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const id = deployIdentity()
    await deployOwnedProfile(root, template, undefined, id)
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-writing'))).toBe(true)
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: { 'editor-novel-kernel': true, zhihu: false },
      presets: { 'dsh-editor-writing': false },
      installed: [],
    }))
    const second = await deployOwnedProfile(root, template, undefined, id)
    expect(second.reused).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'dsh-plugins.json'), 'utf8')).overrides).toEqual({})
    /* 退役版本留下的 presets 开关记录不再生效：模板里的 preset 照常部署。 */
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-writing'))).toBe(true)
  })
  it('relinks a community plugin already listed in profile bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }))
    const plugin = join(root, 'user-plugins', 'community-theme')
    await mkdir(plugin, { recursive: true })
    await writeFile(join(plugin, 'package.json'), '{"name":"community-theme","version":"1.0.0"}')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      installed: [{ name: 'community-theme', spec: 'github:acme/community-theme', version: '1.0.0' }],
    }))
    const id = deployIdentity()
    const first = await deployOwnedProfile(root, template, undefined, id)
    expect(JSON.parse(await readFile(join(first.path, 'package.json'), 'utf8')).dsh.profile.bundles).toContain('community-theme')
    const linked = join(first.path, 'node_modules', 'community-theme')
    await writeFile(join(root, 'user-plugins', 'community-theme', 'package.json'), '{"name":"community-theme","version":"1.0.1"}')
    await rm(linked, { recursive: true, force: true })
    const second = await deployOwnedProfile(root, template, undefined, id)
    expect(second.reused).toBe(true)
    expect(JSON.parse(await readFile(join(linked, 'package.json'), 'utf8')).version).toBe('1.0.1')
  })
  it('skips recopying an unchanged app-owned preset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const preset = join(template, 'agent-presets', 'dsh-editor')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(preset, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const id = deployIdentity()
    await deployOwnedProfile(root, template, undefined, id)
    const deployed = join(root, '.agent-presets', 'dsh-editor', 'agent.cordis.yml')
    const before = (await stat(deployed)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 40))
    await deployOwnedProfile(root, template, undefined, id)
    expect((await stat(deployed)).mtimeMs).toBe(before)
  })
})

function deployIdentity(partial: Partial<ProfileDeployIdentity> = {}): ProfileDeployIdentity {
  return {
    algorithm: PROFILE_DEPLOY_ALGORITHM,
    profileSha256: 'sha-template',
    dsh: '@deepseek-ai/dsh@0.2.2-rc.1',
    nodePath: 'C:/runtime/node.exe',
    cliPath: 'C:/runtime/dsh/lib/bin.js',
    ...partial,
  }
}

describe('desktop and runtime preset writer integration', () => {
  it('delegates to the installed pure writer and propagates failure without replacing tools', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-shared-preset-writer-'))
    try {
      const profile = join(home, 'profiles', 'dsh-editor')
      const implementation = join(profile, 'node_modules', 'dsh-editor-plugins', 'lib')
      const generated = join(profile, 'node_modules', 'dsh-editor-profile-config')
      await mkdir(implementation, { recursive: true })
      await mkdir(generated, { recursive: true })
      await writeFile(join(implementation, '..', 'package.json'), '{"type":"module"}')
      await writeFile(join(implementation, 'preset-config.js'), `import { writeFile, access } from 'node:fs/promises'; import { join } from 'node:path'; export async function syncPresetDeclarations(home, profile) { try { await access(join(home, 'reject')); } catch { await writeFile(join(profile, 'node_modules/dsh-editor-profile-config/presets.patch.json'), '[{"insert":[{"id":"zhihu-tools","name":"@klarkxy/dsh-zhihu/tools"}]}]'); return; } throw new Error('shared writer failed'); }`)
      await syncDesktopPresetDeclarations(home, profile)
      const patch = join(generated, 'presets.patch.json')
      const original = await readFile(patch, 'utf8')
      expect(JSON.parse(original)[0].insert[0].id).toBe('zhihu-tools')
      await writeFile(join(home, 'reject'), '')
      await expect(syncDesktopPresetDeclarations(home, profile)).rejects.toThrow('shared writer failed')
      expect(await readFile(patch, 'utf8')).toBe(original)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})

describe('optional public plugin distribution upgrade', () => {
  it('removes obsolete preinstall switches with backups but preserves independently installed plugins and data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-preinstall-trim-'))
    try {
      const state = { schema: 1, overrides: { 'current-title': true, mood: false, recap: false, zhihu: true, 'zhihu-tools': true, 'editor-cards': false, 'author-extra': false }, installed: [{ name: '@klarkxy/dsh-zhihu', version: '0.1.10', spec: 'npm:@klarkxy/dsh-zhihu@0.1.10' }], presets: { 'dsh-editor-novel': false } }
      const original = JSON.stringify(state)
      const patch = '# managed-by: dsh-editor-plugins\n- id: author-extra\n  disabled: true\n- id: current-title\n  disabled: false\n- id: editor-cards\n  disabled: true\n- id: mood\n  disabled: true\n- id: recap\n  disabled: true\n- id: zhihu\n  disabled: false\n- id: zhihu-tools\n  disabled: false\n'
      await writeFile(join(home, 'dsh-plugins.json'), original)
      await writeFile(join(home, 'cordis.patch.yml'), patch)
      await mkdir(join(home, 'storages'))
      await writeFile(join(home, 'storages', 'dsh_editor_mood.json'), 'historical requirements')
      await sanitizeHostLockedPluginOverrides(home, ['@klarkxy/dsh-web-search-manager'])
      expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toEqual({ ...state, overrides: { zhihu: true, 'zhihu-tools': true, 'author-extra': false } })
      expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe('# managed-by: dsh-editor-plugins\n- id: author-extra\n  disabled: true\n- id: zhihu\n  disabled: false\n- id: zhihu-tools\n  disabled: false\n')
      expect(await readFile(join(home, 'dsh-plugins.json.before-preinstall-trim'), 'utf8')).toBe(original)
      expect(await readFile(join(home, 'cordis.patch.yml.before-preinstall-trim'), 'utf8')).toBe(patch)
      expect(await readFile(join(home, 'storages', 'dsh_editor_mood.json'), 'utf8')).toBe('historical requirements')
      await sanitizeHostLockedPluginOverrides(home, ['@klarkxy/dsh-web-search-manager'])
      expect(await readFile(join(home, 'dsh-plugins.json.before-preinstall-trim'), 'utf8')).toBe(original)
      const manual = '- id: mood\n  disabled: false\n- id: author-rule\n  config:\n    keep: true\n'
      await writeFile(join(home, 'cordis.patch.yml'), manual)
      await sanitizeHostLockedPluginOverrides(home, ['@klarkxy/dsh-web-search-manager'])
      expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe(manual)
    } finally { await rm(home, { recursive: true, force: true }) }
  })

  it('preserves optional switches when installation records cannot be read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-preinstall-unreadable-'))
    try {
      const patch = '# managed-by: dsh-editor-plugins\n- id: mood\n  disabled: false\n'
      await writeFile(join(home, 'dsh-plugins.json'), '{invalid')
      await writeFile(join(home, 'cordis.patch.yml'), patch)
      await sanitizeHostLockedPluginOverrides(home, [])
      expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
})

describe('retired public plugin upgrade', () => {
  it('backs up and removes both enabled and disabled obsolete managed entries, keeping data and other preferences', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-retired-plugins-'))
    const ids = ['ai-services', 'model-center', 'memory', 'self-improvement', 'fusion']
    const overrides = { ...Object.fromEntries(ids.map((id, index) => [id, index % 2 === 0])), zhihu: false }
    const state = { schema: 1, overrides, presets: { 'dsh-editor-article': false }, installed: [{ name: '@klarkxy/dsh-fusion', spec: '@klarkxy/dsh-fusion', version: '0.1.1' }, { name: 'community-plugin', spec: 'community-plugin', version: '1' }] }
    const stateText = JSON.stringify(state)
    const patchText = '# managed-by: dsh-editor-plugins\n' + Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)).map(([id, enabled]) => '- id: ' + id + '\n  disabled: ' + !enabled + '\n').join('')
    await writeFile(join(home, 'dsh-plugins.json'), stateText)
    await writeFile(join(home, 'cordis.patch.yml'), patchText)
    await writeFile(join(home, 'author-memory.json'), 'preserve author records')
    await sanitizeHostLockedPluginOverrides(home)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toEqual({ ...state, overrides: { zhihu: false }, installed: [state.installed[1]] })
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe('# managed-by: dsh-editor-plugins\n- id: zhihu\n  disabled: true\n')
    expect(await readFile(join(home, 'dsh-plugins.json.before-plugin-retirement'), 'utf8')).toBe(stateText)
    expect(await readFile(join(home, 'cordis.patch.yml.before-plugin-retirement'), 'utf8')).toBe(patchText)
    expect(await readFile(join(home, 'author-memory.json'), 'utf8')).toBe('preserve author records')
    await rm(home, { recursive: true, force: true })
  })
})
