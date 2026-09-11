/** Test-only plugin: a deterministic model exercises the real Agent/tool/session loop. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
const root = resolve(import.meta.dirname, '..')
const runtimeRequire = createRequire(resolve(root, '.dev/desktop-dsh-runtime/package.json'))
const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href)
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const { setSandboxMode } = await load('@deepseek-ai/dsh-sandbox-policy')
const fsTools = await load('@deepseek-ai/dsh-tool-fs')
const searchTools = await load('@deepseek-ai/dsh-tool-fs-search')

export const inject = ['connection', 'agents', 'workspaceRegistry', 'llm', 'sessions', 'sandboxPolicy', 'webServer']
export function apply(ctx) {
  const requests = []
  let steps = []
  let handle
  let workspace
  let id
  const toolResults = options => options.messages.flatMap(m => m.content).filter(b => b.type === 'tool-result')
  const textOf = result => result.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
  const readVersion = options => {
    const result = toolResults(options).at(-1)
    assert.equal(result.isError, false, textOf(result))
    const version = /文件版本（维护时使用）：([^\n]+)/.exec(textOf(result))?.[1]
    assert.ok(version, 'native read must expose its real observed version')
    return version
  }
  class ProbeAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'scripted', name: 'Memory runtime test' }] }
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 128000 }, defaultMaxTokens: 4096 } }
    async *stream(options) {
      requests.push({ system: options.system, messages: options.messages, tools: options.tools?.map(t => t.name), model: options.model })
      assert.ok(!options.tools?.some(t => ['novel_search', 'project_knowledge'].includes(t.name)))
      assert.equal(options.system.split('RULES_LITERAL {{model}}').length - 1, 1)
      assert.ok(!options.system.includes('NEVER_AUTOINJECT'))
      assert.ok(!JSON.stringify(options.messages).includes('OLD_PACKET_SECRET'))
      const next = steps.shift()
      if (next) {
        const args = typeof next.args === 'function' ? next.args(options) : next.args
        const callId = `memory-probe-${requests.length}`
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: callId, name: next.name, argumentsDelta: JSON.stringify(args) }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: next.name, arguments: JSON.stringify(args) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        const last = toolResults(options).at(-1)
        if (last) assert.equal(last.isError, false, textOf(last))
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '已完成本轮验收。' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '已完成本轮验收。' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['memory-probe'], new ProbeAdapter())
  const setup = async agentCtx => { await agentCtx.plugin(fsTools); await agentCtx.plugin(searchTools, { sampleOverCapGlobResults: false }) }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/memory-probe',
    handler: async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const endpoint = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice('/memory-probe/'.length)
      const result = await dispatch(endpoint, body.payload)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId ?? 'memory-probe', result }))
    },
  }))
  const dispatch = async (endpoint, body) => {
    try {
      if (endpoint === 'start') {
        workspace = body.workspace; id = body.sessionId
        const registered = await ctx.workspaceRegistry.create(workspace, '规则与维护验收')
        handle = body.resume
          ? await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'memory-probe', model: 'scripted' }, setup })
          : await ctx.agents.create({ sessionId: id, meta: { cwd: workspace, agentPreset: 'dsh-editor' }, agentOptions: { provider: 'memory-probe', model: 'scripted' }, setup })
        await registered.attachSession(id)
        setSandboxMode(handle.agent.session, 'workspace-write')
        return { ok: true, value: { sessionId: id, workspaceId: registered.id, policy: ctx.sandboxPolicy.resolve({ session: handle.agent.session }) } }
      }
      if (endpoint === 'run') {
        assert.ok(handle)
        if (body.mode === 'fact') steps = [
          { name: 'grep', args: { pattern: '远章证据', path: '正文', include: '*.md' } },
          { name: 'read', args: options => { assert.ok(textOf(toolResults(options).at(-1)).includes('1000.md')); return { file_path: '正文/1000.md', offset: 350, limit: 10 } } },
          { name: 'novel_memory_update', args: options => ({ path: '世界书/林舟.md', operation: 'create', category: 'fact', certainty: 'explicit', summary: '记录第一千章的出生地事实', text: '# 林舟\n\n第1000章确认：林舟出生于雾港。', evidence: [{ kind: 'file', path: '正文/1000.md', version: readVersion(options), quote: '远章证据：林舟出生于雾港。' }] }) },
        ]
        else if (body.mode === 'rule') steps = [
          { name: 'read', args: { file_path: 'AGENTS.md' } },
          { name: 'novel_memory_update', args: options => ({ path: 'AGENTS.md', operation: 'append', category: 'rule', certainty: 'explicit', summary: '记录长期视角要求', expectedVersion: readVersion(options), text: '- 使用第三人称。', evidence: [{ kind: 'user', messageId: 'current', quote: '以后都使用第三人称。' }] }) },
        ]
        else if (body.mode === 'edit') steps = [
          { name: 'read', args: { file_path: 'AGENTS.md' } },
          { name: 'novel_memory_update', args: options => ({ path: 'AGENTS.md', operation: 'edit', category: 'rule', certainty: 'explicit', summary: '修订视角要求', expectedVersion: readVersion(options), oldText: '- 使用第三人称。', newText: '- 使用第一人称。', evidence: [{ kind: 'user', messageId: 'current', quote: '把第三人称改成第一人称。' }] }) },
        ]
        else steps = []
        const text = body.mode === 'rule' ? '以后都使用第三人称。' : body.mode === 'edit' ? '把第三人称改成第一人称。' : '查找远章证据，核实林舟的出生地并维护世界书。'
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: JSON.stringify({ schema: 'dsh-editor.project-context', version: 3, user_request: text, active_path: '正文/1000.md' }) }] }))
        await handle.agent.whenIdle()
        const errors = handle.agent.session.events.filter(e => e.type === 'tool/result' && e.data.message.content.some(b => b.type === 'tool-result' && b.isError))
        const receipts = handle.agent.session.events.filter(e => e.type === 'tool/result').flatMap(e => e.data.message.content).filter(b => b.type === 'tool-result').flatMap(b => b.content).filter(b => b.type === 'text').flatMap(b => { try { const v = JSON.parse(b.text); return v.marker === 'dsh-editor.memory-update' ? [v] : [] } catch { return [] } })
        return { ok: true, value: { errors, receipts, requests: requests.length, lastEvents: handle.agent.session.events.slice(-4) } }
      }
      if (endpoint === 'inspect') return { ok: true, value: { requests, header: handle?.agent.session.requestHeader(), events: handle?.agent.session.events } }
      if (endpoint === 'stop') { await handle?.dispose(); handle = undefined; return { ok: true, value: {} } }
      throw new Error('unknown probe endpoint')
    } catch (error) { return { ok: false, error: { message: error.stack ?? String(error) } } }
  }
}
