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
        proofread: true,
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
      '- id: proofread',
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
  it('points the agent preset default at generic writing and keeps the legacy preset compatible', async () => {
    const profileResources = join(import.meta.dirname, '..', 'resources', 'profile')
    const patch = await readFile(join(profileResources, 'cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor-writing/)
    expect(patch).not.toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor\s*$/m)
    expect(patch).toMatch(/- id: editor-workbench-tools\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-novel-kernel\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-workbench\r?\n  disabled: true/)
    const legacy = await readFile(join(profileResources, 'agent-presets', 'dsh-editor', 'agent.cordis.yml'), 'utf8')
    expect(legacy).toContain('dsh-tool-ask-user')
    expect(legacy).toContain('dsh-tool-fs')
    expect(legacy).toMatch(/- id: tool-bash\r?\n  name: '@deepseek-ai\/dsh-tool-bash'\r?\n  disabled: true/)
    expect(legacy).toMatch(/- id: tool-pwsh\r?\n  name: '@deepseek-ai\/dsh-tool-pwsh'\r?\n  disabled: true/)
    expect(legacy).not.toMatch(/dsh-tool-(web|todo|goal|subagent|workflow|ralph|skill)/)
    expect(legacy).not.toContain('dsh-plan-mode')
    expect(topLevelPluginRows(legacy)).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona' },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
      { id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' },
      { id: 'editor-novel-kernel', name: 'dsh-editor-novel-kernel' },
      { id: 'compaction', name: 'cordis:group' },
    ])
    expect(legacy).toMatch(/- id: editor-novel-kernel\r?\n  name: dsh-editor-novel-kernel\r?\n  config:\r?\n    mode: legacy/)
    expect(legacy).not.toContain('knowledge-only')
    expect(existsSync(join(profileResources, 'agent-presets', 'dsh-editor', 'skills'))).toBe(false)
  })
  it('ships five writing presets from app template and first-party packages with parseable compositions and uncrossed skills', async () => {
    const profileResources = join(import.meta.dirname, '..', 'resources', 'profile')
    const presetRoot = join(profileResources, 'agent-presets')
    const ids = (await readdir(presetRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    /* 模板源只保留核心通用写作与 legacy；另外三个由第一方包提供。 */
    expect(ids).toEqual(['dsh-editor', 'dsh-editor-writing'])
    const repoRoot = join(import.meta.dirname, '..', '..', '..')
    const presetSource = (id: string) => {
      if (id === 'dsh-editor' || id === 'dsh-editor-writing') return join(presetRoot, id)
      if (id === 'dsh-editor-novel') return join(repoRoot, 'packages', 'dsh-editor-novel-kernel', 'presets', id)
      return join(repoRoot, 'packages', 'dsh-editor-writing-presets', 'presets', id)
    }
    const allIds = ['dsh-editor', 'dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical', 'dsh-editor-writing']

    const writingIds = ['dsh-editor-writing', 'dsh-editor-novel', 'dsh-editor-article', 'dsh-editor-technical'] as const
    const writingLabels = {
      'dsh-editor-writing': '通用写作',
      'dsh-editor-novel': '小说创作',
      'dsh-editor-article': '文章与自媒体',
      'dsh-editor-technical': '技术文档',
    } as const
    const professionalSkill = {
      'dsh-editor-writing': undefined,
      'dsh-editor-novel': 'novel-writing',
      'dsh-editor-article': 'article-writing',
      'dsh-editor-technical': 'technical-writing',
    } as const
    const scopedTools = {
      'dsh-editor-writing': [{ id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' }],
      'dsh-editor-novel': [
        { id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' },
        { id: 'editor-novel-kernel', name: 'dsh-editor-novel-kernel' },
      ],
      'dsh-editor-article': [{ id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' }],
      'dsh-editor-technical': [{ id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' }],
    } as const
    const descriptions = new Map<string, string>()

    for (const id of allIds) {
      const directory = presetSource(id)
      expect(existsSync(join(directory, 'preset.yml'))).toBe(true)
      expect(existsSync(join(directory, 'agent.cordis.yml'))).toBe(true)
      /* 包内源目录不带 marker；owner marker 由 configureProfile 在物化模板时写入。 */
      if (ids.includes(id)) {
        expect(JSON.parse(await readFile(join(directory, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
      } else {
        expect(existsSync(join(directory, PROFILE_MARKER))).toBe(false)
      }
      const composition = await readFile(join(directory, 'agent.cordis.yml'), 'utf8')
      expect(compositionProblem(composition)).toBeUndefined()
    }

    for (const id of writingIds) {
      const presetYml = await readFile(join(presetSource(id), 'preset.yml'), 'utf8')
      expect(presetYml.match(/^name:\s*(.+)$/m)?.[1]?.trim()).toBe(writingLabels[id])
      const composition = await readFile(join(presetSource(id), 'agent.cordis.yml'), 'utf8')
      expect(composition).toContain('dsh-tool-ask-user')
      expect(composition).toContain('dsh-tool-fs')
      expect(composition).toContain('dsh-skill-filesystem')
      expect(composition).toContain('dsh-tool-skill')
      expect(composition).toContain("new URL('skills/', baseUrl)")
      expect(composition).toContain('writing_propose')
      expect(composition).toContain('作者确认')
      expect(composition).toMatch(/不创建|不建目录/)
      expect(composition).toMatch(/- id: tool-bash\r?\n  name: '@deepseek-ai\/dsh-tool-bash'\r?\n  disabled: true/)
      expect(composition).toMatch(/- id: tool-pwsh\r?\n  name: '@deepseek-ai\/dsh-tool-pwsh'\r?\n  disabled: true/)
      expect(composition).not.toMatch(/dsh-tool-(web|todo|goal|subagent|workflow|ralph)(?!-)/)
      expect(composition).not.toContain('dsh-plan-mode')
      expect(topLevelPluginRows(composition)).toEqual([
        { id: 'persona', name: '@deepseek-ai/dsh-persona' },
        { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
        { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
        { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
        { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
        ...scopedTools[id],
        { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
        { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
        { id: 'compaction', name: 'cordis:group' },
      ])
      // Four new presets exclude legacy novel write/index/scratch tools:
      // writing/article/technical omit the kernel; novel mounts it knowledge-only.
      if (id === 'dsh-editor-novel') {
        expect(composition).toMatch(/- id: editor-novel-kernel\r?\n  name: dsh-editor-novel-kernel\r?\n  config:\r?\n    mode: knowledge-only/)
      } else {
        expect(composition).not.toContain('dsh-editor-novel-kernel')
        expect(composition).not.toContain('knowledge-only')
      }
      const skillNames = await skillDirectoryNames(join(presetSource(id), 'skills'))
      const expected = professionalSkill[id] ? ['prose-revision', professionalSkill[id]] : ['prose-revision']
      expect(skillNames).toEqual(expected.sort())
      for (const name of skillNames) {
        const skill = parseSkillDocument(await readFile(join(presetSource(id), 'skills', name, 'SKILL.md'), 'utf8'))
        expect(skill.name).toBe(name)
        expect(skill.description.length).toBeGreaterThan(0)
        descriptions.set(`${id}:${name}`, skill.description)
      }
    }

    expect(descriptions.get('dsh-editor-writing:prose-revision')).toBe(descriptions.get('dsh-editor-novel:prose-revision'))
    expect(descriptions.get('dsh-editor-writing:prose-revision')).toBe(descriptions.get('dsh-editor-article:prose-revision'))
    expect(descriptions.get('dsh-editor-writing:prose-revision')).toBe(descriptions.get('dsh-editor-technical:prose-revision'))
    expect(descriptions.get('dsh-editor-writing:prose-revision')).toContain('当前 Preset 的专业工作流（若有）')
    expect(descriptions.get('dsh-editor-writing:prose-revision')).not.toMatch(/novel-writing|article-writing|technical-writing/)
    expect(descriptions.get('dsh-editor-novel:novel-writing')).not.toBe(descriptions.get('dsh-editor-article:article-writing'))
    expect(descriptions.get('dsh-editor-novel:novel-writing')).not.toBe(descriptions.get('dsh-editor-technical:technical-writing'))
    expect(descriptions.get('dsh-editor-article:article-writing')).not.toBe(descriptions.get('dsh-editor-technical:technical-writing'))
    expect(descriptions.get('dsh-editor-novel:novel-writing')).not.toContain('article-writing 用于小说')
    for (const [key, description] of descriptions) {
      if (key.endsWith(':novel-writing')) expect(description).toMatch(/不要用于文章|不要用于.*技术/)
      if (key.endsWith(':article-writing')) expect(description).toMatch(/不要用于小说|不要用于.*技术/)
      if (key.endsWith(':technical-writing')) expect(description).toMatch(/不要用于小说|不要用于.*文章/)
    }

    const { configureProfile, desktopComposition } = await import('../../../scripts/desktop-compositions.mjs')
    const composition = await desktopComposition('desktop')
    const materialized = await mkdtemp(join(tmpdir(), 'dsh-template-'))
    /* 与 prepare 脚本同序：先复制资源模板（含两个 app-owned preset），再由 configureProfile 补进第一方包的三个。 */
    await (await import('node:fs/promises')).cp(profileResources, materialized, { recursive: true })
    await configureProfile(materialized, composition)
    /* 物化模板重新集齐五个 preset，且全部由模板通道写入 app-owned marker。 */
    const templateIds = (await readdir(join(materialized, 'agent-presets'))).sort()
    expect(templateIds).toEqual(allIds)
    for (const id of allIds) {
      expect(JSON.parse(await readFile(join(materialized, 'agent-presets', id, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
    }

    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    await deployProfile(root, materialized)
    const deployed = (await readdir(join(root, '.agent-presets'))).sort()
    expect(deployed).toEqual(allIds)
    expect(await skillDirectoryNames(join(root, '.agent-presets', 'dsh-editor-writing', 'skills'))).toEqual(['prose-revision'])
    expect(await skillDirectoryNames(join(root, '.agent-presets', 'dsh-editor-novel', 'skills'))).toEqual(['novel-writing', 'prose-revision'])
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-writing', 'skills', 'novel-writing'))).toBe(false)
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor', 'skills'))).toBe(false)

    /* 作者停用第一方模式后，重启部署跳过并清掉它的 app-owned 目录。 */
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: {},
      presets: { 'dsh-editor-novel': false },
      installed: [],
    }))
    await deployProfile(root, materialized)
    const afterDisable = (await readdir(join(root, '.agent-presets'))).sort()
    expect(afterDisable).toEqual(allIds.filter((id) => id !== 'dsh-editor-novel'))
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({ schema: 1, overrides: {}, presets: {}, installed: [] }))
    await deployProfile(root, materialized)
    expect((await readdir(join(root, '.agent-presets'))).sort()).toEqual(allIds)
  }, 15000)
  it('keeps scoped tools disabled after preparing the full composition', async () => {
    const { configureProfile, desktopComposition } = await import('../../../scripts/desktop-compositions.mjs')
    const aliases = ['basic', 'smart', 'full'] as const
    const resolved = await Promise.all(aliases.map((id) => desktopComposition(id)))
    const stripped = resolved.map(({ id: _id, label: _label, ...rest }) => rest)
    expect(stripped[0]).toEqual(stripped[1])
    expect(stripped[1]).toEqual(stripped[2])
    for (const item of resolved) {
      expect(item.features).toEqual(['assistant', 'completion', 'overview-panel', 'proofread-panel', 'writing-presets', 'web-search'])
      expect(item.features).toContain('proofread-panel')
      expect(item.features).not.toContain('cards')
      expect(item.features).not.toContain('memory-panel')
      expect(item.packages).toContain('dsh-editor-proofread-panel')
      expect(item.packages).toContain('dsh-editor-writing-presets')
      expect(item.packages).toContain('dsh-editor-cards')
      expect(item.disabledEntries).toContain('editor-cards')
      expect(item.packages).toContain('dsh-editor-memory-panel')
      expect(item.disabledEntries).toContain('editor-memory-panel')
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
    // One UI owns the global plugin configuration slots; Host management stays available.
    expect(patch).not.toMatch(/- id: ui-plugin-manager\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: plugin-manager\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-cards\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-memory-panel\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-workbench-tools\r?\n  disabled: false/)
    expect(patch).not.toMatch(/- id: editor-novel-kernel\r?\n  disabled: false/)
    expect(patch).not.toMatch(/- id: editor-workbench\r?\n  disabled: true/)
    for (const id of ['web-search-deepseek', 'web-fetch-http', 'tool-web']) {
      expect(patch).toMatch(new RegExp(`- id: ${id}\\r?\\n  disabled: true`))
    }
    for (const id of ['dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical']) {
      const agent = await readFile(join(destination, 'agent-presets', id, 'agent.cordis.yml'), 'utf8')
      expect(agent.match(/name: "@klarkxy\/dsh-web-search-manager\/tools"/g)).toHaveLength(1)
    }
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
  it('still sanitizes locked overlays and preset toggles on a stamp hit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const novel = join(template, 'agent-presets', 'dsh-editor-novel')
    await mkdir(novel, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"name":"dsh-editor-profile"}')
    await writeFile(join(template, 'composition.json'), JSON.stringify({ presets: [{ id: 'dsh-editor-novel' }] }))
    await writeFile(join(novel, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(novel, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const id = deployIdentity()
    await deployOwnedProfile(root, template, undefined, id)
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-novel'))).toBe(true)
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: { 'editor-novel-kernel': true, zhihu: false },
      presets: { 'dsh-editor-novel': false },
      installed: [],
    }))
    const second = await deployOwnedProfile(root, template, undefined, id)
    expect(second.reused).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'dsh-plugins.json'), 'utf8')).overrides).toEqual({})
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-novel'))).toBe(false)
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
    dsh: '@deepseek-ai/dsh@0.2.0-rc.2',
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
      const state = { schema: 1, overrides: { 'current-title': true, mood: false, recap: false, zhihu: true, 'zhihu-tools': true, 'editor-cards': false }, installed: [{ name: '@klarkxy/dsh-zhihu', version: '0.1.10', spec: 'npm:@klarkxy/dsh-zhihu@0.1.10' }], presets: { 'dsh-editor-novel': false } }
      const original = JSON.stringify(state)
      const patch = '# managed-by: dsh-editor-plugins\n- id: current-title\n  disabled: false\n- id: editor-cards\n  disabled: true\n- id: mood\n  disabled: true\n- id: recap\n  disabled: true\n- id: zhihu\n  disabled: false\n- id: zhihu-tools\n  disabled: false\n'
      await writeFile(join(home, 'dsh-plugins.json'), original)
      await writeFile(join(home, 'cordis.patch.yml'), patch)
      await mkdir(join(home, 'storages'))
      await writeFile(join(home, 'storages', 'dsh_editor_mood.json'), 'historical requirements')
      await sanitizeHostLockedPluginOverrides(home, ['@klarkxy/dsh-web-search-manager'])
      expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toEqual({ ...state, overrides: { zhihu: true, 'zhihu-tools': true, 'editor-cards': false } })
      expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe('# managed-by: dsh-editor-plugins\n- id: editor-cards\n  disabled: true\n- id: zhihu\n  disabled: false\n- id: zhihu-tools\n  disabled: false\n')
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
