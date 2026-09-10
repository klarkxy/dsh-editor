import { describe, expect, it } from 'vitest'
import { FileOpError, MAX_TEXT_BYTES } from './files.ts'
import { mapHostError } from './host-error.ts'
import {
  PROJECT_RULES_TEMPLATE,
  ProjectRulesError,
  composeProjectRules,
  ensureProjectRules,
  readProjectRules,
} from './project-rules.ts'
import { createMemoryContext } from './test-helpers.ts'

describe('project rules reader', () => {
  it('ignores nested AGENTS.md and returns the canonical template when the root file is missing', async () => {
    const context = createMemoryContext({
      'nested/AGENTS.md': 'nested-only {{model}}',
      '正文/AGENTS.md': 'chapter-rules',
      'notes.md': 'hi',
    })
    await expect(readProjectRules(context)).resolves.toEqual({
      path: 'AGENTS.md',
      text: PROJECT_RULES_TEMPLATE,
      version: null,
      exists: false,
    })
    expect((context.fs as { readPaths: string[] }).readPaths).not.toContain('/workspace/nested/AGENTS.md')
    expect((context.fs as { readPaths: string[] }).readPaths).not.toContain('/workspace/正文/AGENTS.md')
  })

  it('uses the actual root filename when the basename matches case-insensitively', async () => {
    const context = createMemoryContext({ 'agents.md': 'local {{model}}\n{% bogus %}' })
    await expect(readProjectRules(context)).resolves.toEqual({
      path: 'agents.md',
      text: 'local {{model}}\n{% bogus %}',
      version: 'initial-agents.md',
      exists: true,
    })
  })

  it('errors when more than one case variant exists, even on a case-sensitive store', async () => {
    const context = createMemoryContext({ 'AGENTS.md': 'upper', 'agents.md': 'lower' })
    await expect(readProjectRules(context)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'AMBIGUOUS',
      message: expect.stringContaining('多个 AGENTS.md'),
    })
  })

  it('does not silently ignore a read IO failure', async () => {
    const context = createMemoryContext({ 'AGENTS.md': 'ok' })
    context.fs.readText = async () => {
      throw Object.assign(new Error('disk exploded'), { code: 'EIO' })
    }
    await expect(readProjectRules(context)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'IO',
      message: expect.stringMatching(/无法加载项目协作规则.*disk exploded/),
    })
  })

  it('returns the full literal file without truncation, including template markers', async () => {
    const text = `keep {{model}}\n{% malformed %}\n${'字'.repeat(20_000)}`
    const context = createMemoryContext({ 'AGENTS.md': text })
    const result = await readProjectRules(context)
    expect(result.exists).toBe(true)
    expect(result.text).toBe(text)
    expect(result.text).toContain('{{model}}')
    expect(result.text).toContain('{% malformed %}')
  })

  it('uses the existing file size guard instead of truncating an oversized rules file', async () => {
    const context = createMemoryContext({ 'AGENTS.md': 'x'.repeat(MAX_TEXT_BYTES + 1) })
    await expect(readProjectRules(context)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'TOO_LARGE',
      message: expect.stringContaining('无法加载项目协作规则'),
    })
  })

  it('rejects a rules symlink through the existing file helpers', async () => {
    const context = createMemoryContext({ 'AGENTS.md': 'secret' })
    const original = context.fs.lstat.bind(context.fs)
    context.fs.lstat = async (path, opts, signal) => {
      const target = await context.fs.resolve(path, opts)
      if (target.targetKey.endsWith('/AGENTS.md')) return { type: 'symlink', version: 'link' }
      return original(path, opts, signal)
    }
    await expect(readProjectRules(context)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'SYMLINK',
      message: expect.stringContaining('无法加载项目协作规则'),
    })
  })

  it('rejects a permission failure and a path that escapes the workspace', async () => {
    const denied = createMemoryContext({ 'AGENTS.md': 'secret' })
    denied.fs.readText = async () => {
      throw Object.assign(new Error('file access denied'), { code: 'FS_PERMISSION_DENIED' })
    }
    await expect(readProjectRules(denied)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'DENIED',
    })

    const escaped = createMemoryContext({ 'AGENTS.md': 'secret' })
    const originalContains = escaped.fs.contains.bind(escaped.fs)
    escaped.fs.contains = (parent, child) => {
      if (child.targetKey.endsWith('/AGENTS.md')) return false
      return originalContains(parent, child)
    }
    await expect(readProjectRules(escaped)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'PATH_ESCAPE',
      message: expect.stringContaining('无法加载项目协作规则'),
    })
  })

  it('creates the template when missing and re-reads a concurrent creator', async () => {
    const created = createMemoryContext({ 'notes.md': 'x' })
    const ensured = await ensureProjectRules(created)
    expect(ensured).toMatchObject({
      path: 'AGENTS.md',
      text: PROJECT_RULES_TEMPLATE,
      exists: true,
    })
    expect(ensured.version).toEqual(expect.any(String))
    expect(ensured.version).not.toBeNull()

    const existing = createMemoryContext({ 'AGENTS.md': 'custom {{model}}' })
    await expect(ensureProjectRules(existing)).resolves.toMatchObject({
      path: 'AGENTS.md',
      text: 'custom {{model}}',
      exists: true,
    })

    const raced = createMemoryContext({})
    const originalWrite = raced.fs.writeText.bind(raced.fs)
    raced.fs.writeText = async (target, content, expected, signal, policy) => {
      await originalWrite(target, 'racer-rules {{model}}', { kind: 'createIfAbsent' }, signal, policy)
      return originalWrite(target, content, expected, signal, policy)
    }
    await expect(ensureProjectRules(raced)).resolves.toMatchObject({
      path: 'AGENTS.md',
      text: 'racer-rules {{model}}',
      exists: true,
    })

    const readOnly = createMemoryContext({})
    readOnly.policy = { ...readOnly.policy, mode: 'read-only' }
    await expect(ensureProjectRules(readOnly)).rejects.toMatchObject({
      name: 'ProjectRulesError',
      code: 'DENIED',
      message: expect.stringContaining('无法加载项目协作规则'),
    })
  })

  it('maps readable rule failures without dropping the load error message', () => {
    const error = new ProjectRulesError('无法加载项目协作规则：disk exploded', 'IO')
    expect(mapHostError(error)).toEqual({
      ok: false,
      error: { code: 'internal', message: '无法加载项目协作规则：disk exploded', details: {} },
    })
    expect(mapHostError(new ProjectRulesError('多个 AGENTS.md', 'AMBIGUOUS'))).toMatchObject({
      error: { code: 'bad-request', message: '多个 AGENTS.md' },
    })
    expect(mapHostError(new FileOpError('file too large', 'TOO_LARGE'))).toMatchObject({
      error: { code: 'bad-request' },
    })
  })

  it('appends project rules once after generic instruction and global prefs', () => {
    const composed = composeProjectRules('模式说明\n\n【作者跨作品约定】\n少用感叹号', '本项目只用短句 {{model}}')
    expect(composed).toBe(
      '模式说明\n\n【作者跨作品约定】\n少用感叹号\n\n【本项目协作规则】\n本项目只用短句 {{model}}\n\n冲突时优先级：当前请求 > 本项目协作规则 > 作者跨作品约定。',
    )
    expect(composed.split('【本项目协作规则】')).toHaveLength(2)
  })
})
