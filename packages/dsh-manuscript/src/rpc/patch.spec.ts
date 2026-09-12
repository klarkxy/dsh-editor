import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { dispatch, mapError } from '../index.ts'
import { apply as applyAssist } from '../assist.ts'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, ManuscriptHost } from '../host.ts'
import { CHAPTER_CONTEXT_GUIDANCE, CHAPTER_CONTEXT_LIMIT, INSTRUCTION_LIMIT } from './author-preferences.ts'
import { completePatch, PATCH_LIMITS, parsePatchRequest } from './patch.ts'
import { PROJECT_RULES_TEMPLATE } from './project-rules.ts'

function captured(stream: ReturnType<typeof vi.fn>): { system: string; user: string; maxTokens: number } {
  const options = stream.mock.calls[0]?.[0] as { system: string; maxTokens: number; messages: Array<{ content: Array<{ text: string }> }> }
  return { system: options.system, user: options.messages[0].content[0].text, maxTokens: options.maxTokens }
}
import type { StreamChunkLike } from './completion.ts'

type Node = { type: 'file' | 'directory'; version: string; text?: string }

async function fixture(
  config: { provider?: string; model?: string } = { provider: 'configured-provider', model: 'configured-model' },
  seedFiles: Record<string, string> = {},
) {
  const canonical = '/canonical/workspace'
  const nodes = new Map<string, Node>([[canonical, { type: 'directory', version: 'root' }]])
  for (const [relative, text] of Object.entries(seedFiles)) {
    const parts = relative.split('/')
    for (let index = 1; index < parts.length; index++) {
      nodes.set(`${canonical}/${parts.slice(0, index).join('/')}`, { type: 'directory', version: `dir-${index}` })
    }
    nodes.set(`${canonical}/${relative}`, { type: 'file', version: `initial-${relative}`, text })
  }
  const fs: FileSystemLike = {
    async resolve(path, opts) {
      const targetKey = path === '.' ? canonical : `${opts?.cwd ?? canonical}/${path}`.replace('/./', '/')
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) { return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`) },
    async stat(target): Promise<FsInfoLike | undefined> {
      const node = nodes.get(target.targetKey)
      return node ? { type: node.type, version: node.version, size: node.text?.length } : undefined
    },
    async lstat(path, opts): Promise<FsPathInfoLike | undefined> {
      return this.stat(await this.resolve(path, opts))
    },
    async readText(target) {
      const node = nodes.get(target.targetKey)
      if (!node || node.type !== 'file') throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
      return node.text ?? ''
    },
    async listDir(target): Promise<FsDirEntryLike[]> {
      const prefix = `${target.targetKey}/`
      const entries: FsDirEntryLike[] = []
      for (const [path, node] of nodes) {
        if (!path.startsWith(prefix)) continue
        const name = path.slice(prefix.length)
        if (!name || name.includes('/')) continue
        entries.push({ name, type: node.type, target: { targetKey: path, displayPath: path }, version: node.version })
      }
      return entries
    },
    async writeText() { throw new Error('patch.complete must not write files') },
  }
  const stream = vi.fn(() => chunks([{ type: 'text-delta', text: '雨落在窗台上。' }]))
  const services = new Map<string, unknown>([['llm', { stream }]])
  const rows = new Map<string, unknown>()
  const host = {
    get(name: string) { return services.get(name) },
    provide(name: string, value: unknown) { services.set(name, value) },
    on() { return () => {} },
    effect(setup: () => unknown) { return setup() },
    storageDomain: { async open() { return { table: () => ({ get: (key: string) => rows.get(key), async put(key: string, value: unknown) { rows.set(key, value) } }), close() {} } } },
    sessions: {
      get: () => ({
        id: 'session-1',
        header: { cwd: '/header/workspace' },
        requestHeader: () => ({ config }),
      }),
    },
    workspaceRegistry: { resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: ['session-1'] })) },
    sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: canonical, sessionId: 'session-1' })) },
    fs,
    connection: { rpc: { call: vi.fn(), handle: vi.fn() } },
  } as unknown as ManuscriptHost
  await applyAssist(host as unknown as Context)
  return { host, stream, services, nodes, canonical }
}

async function* chunks(items: StreamChunkLike[]) {
  for (const item of items) yield item
}

describe('patch.complete', () => {
  it('validates required, confined, and bounded request fields', () => {
    expect(() => parsePatchRequest({ path: 'chapter.md', selectedText: '' })).toThrow('selected text is required')
    expect(() => parsePatchRequest({ path: '../secret.md', selectedText: '正文' })).toThrow('path escapes workspace')
    expect(() => parsePatchRequest({ path: '.', selectedText: '正文' })).toThrow('path is required')
    expect(() => parsePatchRequest({ path: 'chapter.md', selectedText: 'x'.repeat(PATCH_LIMITS.selectedText + 1) })).toThrow('exceeds')
  })

  it('normalizes the relative path and bounds context around the selection', () => {
    const request = parsePatchRequest({
      path: './chapters/one.md',
      selectedText: '改写对象',
      before: `d${'a'.repeat(PATCH_LIMITS.context)}`,
      after: `${'b'.repeat(PATCH_LIMITS.context)}e`,
      authorPreferences: `  保持克制\r\n${'x'.repeat(1_300)}  `,
    })
    expect(request.path).toBe('chapters/one.md')
    expect(request.before).toBe('a'.repeat(PATCH_LIMITS.context))
    expect(request.after).toBe('b'.repeat(PATCH_LIMITS.context))
    expect(request.authorPreferences.startsWith('保持克制\n')).toBe(true)
    expect(request.authorPreferences.length).toBe(1_200)
    expect(request.chapterContext).toBe('')
    expect(request.instruction).toBe('')
  })

  it('bounds chapterContext and instruction, ignoring empty values', () => {
    const empty = parsePatchRequest({
      path: 'chapter.md',
      selectedText: '旧句',
      chapterContext: ' \n\t ',
      instruction: '   ',
    })
    expect(empty.chapterContext).toBe('')
    expect(empty.instruction).toBe('')

    const bounded = parsePatchRequest({
      path: 'chapter.md',
      selectedText: '旧句',
      chapterContext: `  节拍：雨夜\u0007\r\n上一章：已逃  ${'x'.repeat(1_300)}`,
      instruction: `  缩短对白\u0001${'y'.repeat(500)}  `,
    })
    expect(bounded.chapterContext.startsWith('节拍：雨夜\n上一章：已逃')).toBe(true)
    expect(bounded.chapterContext.length).toBe(CHAPTER_CONTEXT_LIMIT)
    expect(bounded.chapterContext).not.toContain('\u0007')
    expect(bounded.instruction.startsWith('缩短对白')).toBe(true)
    expect(bounded.instruction.length).toBe(INSTRUCTION_LIMIT)
    expect(bounded.instruction).not.toContain('\u0001')
  })

  it('derives provider and model from the live session, never from RPC input', async () => {
    const { host, stream } = await fixture()
    await expect(dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', before: '前文', after: '后文', provider: 'forged', model: 'forged' },
      new AbortController().signal,
    )).resolves.toEqual({ text: '雨落在窗台上。', route: 'dsh-llm' })
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ provider: 'configured-provider', model: 'configured-model' }))
  })

  it('keeps author preferences in system guidance instead of replacement text', async () => {
    const { host, stream } = await fixture()
    await dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', before: '前文', after: '后文', authorPreferences: '对白保持克制' },
      new AbortController().signal,
    )
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('【作者跨作品约定】\n对白保持克制') }))
    expect(captured(stream).system).not.toContain(CHAPTER_CONTEXT_GUIDANCE)
    expect(captured(stream).user.startsWith('【文件】')).toBe(true)
    expect(captured(stream).user).not.toContain('【本章工作笔记】')
    expect(captured(stream).user).not.toContain('【改写要求】')
    expect(captured(stream).maxTokens).toBeUndefined()
  })

  it('places chapterContext before the file block and instruction before the selection', async () => {
    const { host, stream } = await fixture()
    await dispatch(
      host as unknown as Context,
      'patch.complete',
      {
        sessionId: 'session-1',
        path: 'chapter.md',
        selectedText: '旧句',
        before: '前文',
        after: '后文',
        chapterContext: '节拍：雨夜对峙',
        instruction: '补入感官细节',
      },
      new AbortController().signal,
    )
    const { system, user } = captured(stream)
    expect(user.startsWith('【本章工作笔记】\n节拍：雨夜对峙\n\n【文件】chapter.md')).toBe(true)
    expect(user).toContain('\n\n【改写要求】\n补入感官细节\n\n【待改写】\n旧句')
    expect(user.indexOf('【本章工作笔记】')).toBeLessThan(user.indexOf('【文件】'))
    expect(user.indexOf('【改写要求】')).toBeLessThan(user.indexOf('【待改写】'))
    expect(system).toContain(CHAPTER_CONTEXT_GUIDANCE)
  })

  it('omits rewrite instruction from the user prompt when it is empty', async () => {
    const { host, stream } = await fixture()
    await dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', chapterContext: '节拍：收束' },
      new AbortController().signal,
    )
    const { user } = captured(stream)
    expect(user).toContain('【本章工作笔记】\n节拍：收束\n\n【文件】')
    expect(user).not.toContain('【改写要求】')
  })

  it('reports missing live-session model configuration', async () => {
    const { host, stream } = await fixture({})
    await expect(dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', before: '', after: '' },
      new AbortController().signal,
    )).rejects.toThrow('尚未配置写作模型')
    expect(stream).not.toHaveBeenCalled()
  })

  it('passes cancellation through and returns no stale partial proposal', async () => {
    const controller = new AbortController()
    const stream = vi.fn(() => chunks([{ type: 'text-delta', text: 'partial' }]))
    controller.abort()
    await expect(completePatch({
      ctx: { get: () => ({ stream }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: controller.signal,
    })).resolves.toEqual({ text: '', route: 'dsh-llm' })
    expect(stream).not.toHaveBeenCalled()
  })

  it('reports unavailable and failed streams without offering partial edits', async () => {
    await expect(completePatch({
      ctx: {},
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })).rejects.toThrow('写作模型服务未启用')

    await expect(completePatch({
      ctx: { get: () => ({ stream: () => chunks([{ type: 'text-delta', text: 'partial' }, { type: 'finish', reason: { kind: 'error' } }]) }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })).rejects.toThrow('模型请求失败')

    async function* failed() {
      yield { type: 'text-delta', text: 'partial' }
      throw new Error('provider failed')
    }
    await expect(completePatch({
      ctx: { get: () => ({ stream: () => failed() }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })).rejects.toThrow('provider failed')
  })

  it('caps a successful proposal to the short replacement bound', async () => {
    const result = await completePatch({
      ctx: { get: () => ({ stream: () => chunks([{ type: 'text-delta', text: 'x'.repeat(PATCH_LIMITS.proposal + 20) }]) }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })
    expect(result.text).toHaveLength(PATCH_LIMITS.proposal)
  })

  it('maps invalid patch input to schema-valid Host errors', () => {
    expect(mapError(new Error('unrelated')).error.code).toBe('internal')
    try {
      parsePatchRequest({ path: 'chapter.md', selectedText: '' })
    } catch (error) {
      expect(mapError(error)).toMatchObject({
        error: { code: 'bad-request', details: { issues: [{ code: 'custom', path: [] }] } },
      })
    }
  })
})

describe('current model selection for optional writing assist',()=>{
 it('completes before any chat request and follows later model selection instead of historical headers',async()=>{
   const {host,stream,services}=await fixture({});
   let selected={provider:'minimax-live',model:'MiniMax-M3'};
   const models=vi.fn(async()=>({result:{ok:true,value:{current:selected,routable:true}}}));
   services.set('apiProxy',{sessions:{models}});
   const payload={sessionId:'session-1',path:'chapter.md',prefix:'雨声',suffix:''};
   expect(await dispatch(host as unknown as Context,'fim.complete',payload,new AbortController().signal)).toMatchObject({text:'雨落在窗台上。'});
   expect(stream).toHaveBeenNthCalledWith(1,expect.objectContaining(selected));
   selected={provider:'new-provider',model:'new-model'};
   await dispatch(host as unknown as Context,'patch.complete',{sessionId:'session-1',path:'chapter.md',selectedText:'旧句',instruction:'缩短'},new AbortController().signal);
   expect(stream).toHaveBeenNthCalledWith(2,expect.objectContaining(selected));
   expect(models).toHaveBeenCalledTimes(2);
 });
 it('does not fall back to an old model when the authoritative selection fails',async()=>{
   const {host,stream,services}=await fixture();
   services.set('apiProxy',{sessions:{models:async()=>({result:{ok:false,error:{message:'selected model unavailable'}}})}});
   await expect(dispatch(host as unknown as Context,'fim.complete',{sessionId:'session-1',prefix:'正文',suffix:''},new AbortController().signal)).rejects.toThrow('selected model unavailable');
   expect(stream).not.toHaveBeenCalled();
 });
});

describe('session-bound project rules for FIM and patch', () => {
  it('injects current root rules and global prefs once, ignoring a spoofed client path', async () => {
    const { host, stream } = await fixture(
      { provider: 'configured-provider', model: 'configured-model' },
      { 'AGENTS.md': 'root-rules {{model}}', 'nested/AGENTS.md': 'nested-rules', 'chapter.md': '正文' },
    )
    const spoof = {
      sessionId: 'session-1',
      path: 'nested/AGENTS.md',
      prefix: '雨声',
      suffix: '',
      selectedText: '旧句',
      authorPreferences: '对白保持克制',
      projectRules: 'spoofed-rules',
    }
    await dispatch(host as unknown as Context, 'fim.complete', spoof, new AbortController().signal)
    await dispatch(host as unknown as Context, 'patch.complete', spoof, new AbortController().signal)
    expect(stream).toHaveBeenCalledTimes(2)
    for (const call of stream.mock.calls) {
      const options = call[0] as { system: string; messages: Array<{ content: Array<{ text: string }> }> }
      const system = options.system
      const user = options.messages[0]!.content[0]!.text
      expect(system.indexOf('【作者跨作品约定】')).toBeLessThan(system.indexOf('【本项目协作规则】'))
      expect(system).toContain('【作者跨作品约定】\n对白保持克制')
      expect(system).toContain('【本项目协作规则】\nroot-rules {{model}}')
      expect(system).toContain('当前请求 > 本项目协作规则 > 作者跨作品约定')
      expect(system.split('【本项目协作规则】')).toHaveLength(2)
      expect(system).not.toContain('nested-rules')
      expect(system).not.toContain('spoofed-rules')
      expect(user).not.toContain('【本项目协作规则】')
      expect(user).not.toContain('root-rules')
    }
  })

  it('rereads a changed rules file on the next completion', async () => {
    const { host, stream, nodes, canonical } = await fixture(
      { provider: 'configured-provider', model: 'configured-model' },
      { 'AGENTS.md': 'rules-v1' },
    )
    await dispatch(
      host as unknown as Context,
      'fim.complete',
      { sessionId: 'session-1', prefix: '雨声', suffix: '' },
      new AbortController().signal,
    )
    nodes.set(`${canonical}/AGENTS.md`, { type: 'file', version: 'changed', text: 'rules-v2 {{model}}' })
    await dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句' },
      new AbortController().signal,
    )
    const first = (stream.mock.calls[0]![0] as { system: string }).system
    const second = (stream.mock.calls[1]![0] as { system: string }).system
    expect(first).toContain('【本项目协作规则】\nrules-v1')
    expect(second).toContain('【本项目协作规则】\nrules-v2 {{model}}')
    expect(second).not.toContain('rules-v1')
  })

  it('uses the template when the root rules file is missing', async () => {
    const { host, stream } = await fixture()
    await dispatch(
      host as unknown as Context,
      'fim.complete',
      { sessionId: 'session-1', prefix: '雨声', suffix: '' },
      new AbortController().signal,
    )
    expect((stream.mock.calls[0]![0] as { system: string }).system).toContain(`【本项目协作规则】\n${PROJECT_RULES_TEMPLATE}`)
  })

  it('propagates a readable rule load error instead of an empty completion', async () => {
    const { host, stream } = await fixture(
      { provider: 'configured-provider', model: 'configured-model' },
      { 'AGENTS.md': 'ok' },
    )
    host.fs.readText = async () => {
      throw Object.assign(new Error('disk exploded'), { code: 'EIO' })
    }
    await expect(dispatch(
      host as unknown as Context,
      'fim.complete',
      { sessionId: 'session-1', prefix: '雨声', suffix: '' },
      new AbortController().signal,
    )).rejects.toMatchObject({
      name: 'ProjectRulesError',
      message: expect.stringContaining('无法加载项目协作规则'),
    })
    await expect(dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句' },
      new AbortController().signal,
    )).rejects.toMatchObject({
      name: 'ProjectRulesError',
      message: expect.stringContaining('无法加载项目协作规则'),
    })
    expect(stream).not.toHaveBeenCalled()
  })
})

describe('independent writing model preferences', () => {
  it('uses each configured route without querying or mutating conversation selection, and rereads changes', async () => {
    const {host, stream, services} = await fixture()
    let preferences = {completionModel: {provider: 'fast', model: 'small'}, rewriteModel: {provider: 'edit', model: 'large'}}
    services.set('settings', {get: (ns: string) => ns === 'dsh-editor-writing' ? preferences : undefined})
    const models = vi.fn(() => {throw new Error('chat is unavailable')})
    services.set('apiProxy', {sessions: {models}})
    const payload = {sessionId: 'session-1', path: 'chapter.md', prefix: '雨声', suffix: '', selectedText: '旧句'}
    await dispatch(host as unknown as Context, 'fim.complete', payload, new AbortController().signal)
    await dispatch(host as unknown as Context, 'patch.complete', payload, new AbortController().signal)
    expect(stream).toHaveBeenNthCalledWith(1, expect.objectContaining(preferences.completionModel))
    expect(stream).toHaveBeenNthCalledWith(2, expect.objectContaining(preferences.rewriteModel))
    preferences = {...preferences, completionModel: {provider: 'other', model: 'next'}}
    await dispatch(host as unknown as Context, 'fim.complete', payload, new AbortController().signal)
    expect(stream).toHaveBeenNthCalledWith(3, expect.objectContaining(preferences.completionModel))
    expect(models).not.toHaveBeenCalled()
  })
  it('rejects a partially configured route instead of silently using chat', async () => {
    const {host, stream, services} = await fixture()
    services.set('settings', {get: () => ({completionModel: {provider: 'fast', model: ''}})})
    await expect(dispatch(host as unknown as Context, 'fim.complete', {sessionId: 'session-1', prefix: '雨声'}, new AbortController().signal)).rejects.toThrow('配置不完整')
    expect(stream).not.toHaveBeenCalled()
  })
})
