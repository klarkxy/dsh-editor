/**
 * Offline UI-assistant acceptance: local OpenAI/DeepSeek-compatible stub,
 * real DSH + shell + manuscript RPC/files. No paid vendor calls.
 *
 * Fixtures: `.dev/ui-assistant-*`. Evidence: `e2e/out/ui-assistant`.
 * Method: synthetic local model, real host write. Not live vendor or AI quality.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const output = resolve(root, 'e2e', 'out', 'ui-assistant')
const home = resolve(devRoot, 'ui-assistant-home')
const projectsRoot = resolve(devRoot, 'ui-assistant-projects')
const workspace = resolve(devRoot, 'ui-assistant-workspace')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const PROVIDER_ID = 'local-stub'
const MODEL_ID = 'ui-assistant-stub'
const FIM_MODEL_ID = 'ui-completion-stub'
const REWRITE_MODEL_ID = 'ui-rewrite-stub'
const PLACEHOLDER_KEY = 'dsh-editor-e2e-placeholder-key'

const CHAPTER_REL = '正文/001.md'
const CREATE_REL = '大纲/总纲.md'
const ORIGINAL_LINE = '雾比灯先到，把码头的广播塔切成一段一段的影子。'
const EDITED_LINE = '灯还没亮，雾已经把广播塔切成一段一段的影子。'
const REWRITE_NEEDLE = '她听见广播重复同一句话'
const REWRITE_REPLACEMENT = '广播只剩半句。'
const FIM_PREFIX = '林简推开门，发现窗边的人正握着录音带，她'
const FIM_INSERT = '握着旧票根，没有回头。'
const CHAPTER_TEXT = `# 第一章 试笔\n\n${ORIGINAL_LINE}\n\n${REWRITE_NEEDLE}，脚步缓缓地停在空荡荡的栈桥上。\n`
const CREATE_TEXT = '# 总纲\n\n本地桩生成的忽略用草稿，不应落盘。\n'
const PONG_TEXT = 'UI_STUB_PONG'
const READING_TEXT = "这一段最有力的地方，是雾、广播和旧票根三个细节都指向一件尚未说出的往事。读者能感觉到有人在等她，却还不知道是谁。\n\n我建议先保留码头和广播塔，把“脚步缓缓地停在空荡荡的栈桥上”压短。它与前面的雾气都在延缓节奏，放在一起会让开场迟迟没有动作。\n\n可以让广播突然念出她的名字。她停在栈桥尽头，摸了摸口袋。那张票还在，边角已被汗浸软。对岸没有船，只有一盏忽明忽暗的灯。\n\n名字让危险靠近，摸票让人物作出反应，最后的灯把读者引向下一步。暂时不用解释票的来历，让她先决定要不要过去。\n\n如果希望保留原来的慢节奏，也可以让窗边的人抬起头。先给出一个变化，再继续补充人物的往事。"
const TITLE_TEXT = 'UI_STUB_TITLE'
const AFTER_EDIT_TEXT = 'UI_STUB_EDIT_DONE'
const AFTER_CREATE_TEXT = 'UI_STUB_CREATE_DONE'
const LATE_TEXT = 'UI_STUB_LATE'
const TITLE_USER_PREFIX = 'Generate the session title from this JSON array of human messages:'
const TITLE_SYSTEM_MARK = 'Create a concise title for an AI coding-assistant session from the supplied human messages.'
const MARK = {
  ping: 'UI_ASSISTANT_PING',
  readLong: '请分析这个开头的节奏，并给出修改建议。',
  edit: 'UI_ASSISTANT_EDIT',
  create: 'UI_ASSISTANT_CREATE',
  hold: 'UI_ASSISTANT_HOLD',
}

const owned = [home, projectsRoot, workspace, output]
const forbidden = [template, runtime, resolve(devRoot, 'desktop-dsh-runtime')]

for (const target of owned) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.5-rc.2')

const report = {
  startedAt: new Date().toISOString(),
  method: 'synthetic local model; real DSH host write',
  liveVendor: false,
  aiQualityClaim: false,
  stub: { baseURL: '', requestCount: 0, kinds: [], aborted: 0, hosts: [] },
  profile: 'fresh isolated DSH_HOME with placeholder key',
  selectionMethod: '',
  checks: [],
  gaps: [],
  failures: [],
  screenshots: [],
  phases: [],
}
let shotIndex = 0
let browser
let dshChild
let stub
let activePage

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function note(label, detail = '') {
  report.phases.push({ label, detail, at: new Date().toISOString() })
  console.log(`[ui-assistant] ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(message) {
  report.failures.push(message)
  console.error(`[ui-assistant] ${message}`)
}

function recordCheck(name, ok, detail = '') {
  report.checks.push({ name, ok, detail })
  console.log(`[ui-assistant] ${ok ? 'ok' : 'miss'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) fail(`${name}: ${detail || 'failed'}`)
}

function skipDependents(reason) {
  for (const name of MANDATORY) {
    if (report.checks.some((item) => item.name === name)) continue
    recordCheck(name, false, `dependency-skipped-as-failure: ${reason}`)
  }
}

const MANDATORY = [
  'configure-test-model',
  'open-synthetic-work',
  'open-assistant',
  'ime-composing-enter',
  'ime-keycode-229',
  'enter-positive-control',
  'chat-visible-reply',
  'edit-preview-leaves-file',
  'edit-apply-writes',
  'edit-undo-restores',
  'ignored-create-never-writes',
  'cancel-pending-no-late-mutation',
  'rewrite-custom',
  'fim-complete',
  'no-external-model-calls',
]

async function exists(target) {
  return stat(target).then(() => true, () => false)
}

async function waitFor(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(120)
  }
  throw new Error(`timed out: ${label}`)
}

async function switchAppearance(control) {
  return control.evaluate(el => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return { width: rect.width, height: rect.height, radius: parseFloat(style.borderRadius), background: style.backgroundColor }
  })
}

function assertCapsuleSwitch(style) {
  if (style.width / style.height < 1.5 || style.radius < style.height / 2) {
    throw new Error('feature switch is rendered as a generic button: ' + JSON.stringify(style))
  }
  if (style.background === 'rgba(0, 0, 0, 0)' || style.background === 'transparent') {
    throw new Error('enabled feature switch has no visible track: ' + JSON.stringify(style))
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolvePromise())
      killer.once('exit', () => resolvePromise())
    })
  }
}

async function flushReport() {
  report.stub.requestCount = stub?.requests.length ?? 0
  report.stub.kinds = (stub?.requests ?? []).map((item) => item.kind)
  report.stub.aborted = (stub?.requests ?? []).filter((item) => item.aborted).length
  report.stub.completed = (stub?.requests ?? []).filter((item) => item.completed).length
  report.stub.hosts = [...new Set((stub?.requests ?? []).map((item) => item.host))]
  for (const name of MANDATORY) {
    const check = report.checks.find((item) => item.name === name)
    if (!check || check.ok !== true) {
      const detail = check?.detail || 'mandatory proof missing'
      if (!report.failures.some((item) => item.startsWith(`${name}:`))) fail(`${name}: ${detail}`)
    }
  }
  report.ok = report.failures.length === 0
  report.finishedAt = new Date().toISOString()
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (stub) {
    await writeFile(resolve(output, 'stub-requests.json'), `${JSON.stringify(stub.requests, null, 2)}\n`, 'utf8')
  }
}

async function shot(page, name, intent = '') {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  report.screenshots.push({ name, file: file.replace(`${root}${sep}`, '').replaceAll('\\', '/'), intent })
}

function flattenMessages(body) {
  return JSON.stringify(body?.messages ?? body ?? '')
}

function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part.text === 'string') return part.text
      return JSON.stringify(part ?? '')
    }).join('\n')
  }
  if (content && typeof content.text === 'string') return content.text
  return JSON.stringify(content ?? message ?? '')
}

function lastNonAssistant(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] ?? {}
    if (message.role === 'assistant') continue
    return { role: String(message.role || ''), content: messageText(message) }
  }
  return { role: '', content: flattenMessages(body) }
}

function envelopeUserRequest(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && parsed.schema === 'dsh-editor.project-context' && typeof parsed.user_request === 'string') {
        return parsed.user_request
      }
    } catch { /* not an envelope */ }
  }
  if (trimmed.startsWith('[')) {
    try {
      const parts = JSON.parse(trimmed)
      if (Array.isArray(parts)) {
        const joined = parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('\n')
        return envelopeUserRequest(joined)
      }
    } catch { /* not structured content */ }
  }
  return ''
}

function extractTaskUserRequest(text) {
  return envelopeUserRequest(text) || String(text ?? '').trim()
}

function isTitlePrompt(body) {
  const blob = flattenMessages(body)
  const last = lastNonAssistant(body)
  return blob.includes(TITLE_USER_PREFIX)
    || blob.includes(TITLE_SYSTEM_MARK)
    || last.content.includes(TITLE_USER_PREFIX)
    || last.content.includes(TITLE_SYSTEM_MARK)
}

function isRuntimeContextSnapshot(text) {
  return /^\s*Current runtime context\. This snapshot supersedes earlier runtime-context snapshots\./.test(text)
}

function lastRealUserRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  let lastPlain = ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] ?? {}
    if (message.role !== 'user') continue
    const text = messageText(message)
    if (text.includes(TITLE_USER_PREFIX) || text.includes(TITLE_SYSTEM_MARK)) continue
    if (isRuntimeContextSnapshot(text)) continue
    const fromEnvelope = envelopeUserRequest(text)
    if (fromEnvelope) return fromEnvelope
    if (!lastPlain) lastPlain = extractTaskUserRequest(text)
  }
  return lastPlain
}

function classify(body) {
  if (isTitlePrompt(body)) return 'title'
  const blob = flattenMessages(body)
  const tools = JSON.stringify(body?.tools ?? [])
  const last = lastNonAssistant(body)
  const userRequest = lastRealUserRequest(body)
  if (blob.includes('【待改写】')) return 'rewrite'
  if (blob.includes('【光标前】')) return 'fim'
  const isTool = last.role === 'tool' || last.role === 'toolResult' || /tool_call_id/.test(last.content)
  if (isTool && blob.includes(MARK.edit)) return 'after_edit'
  if (isTool && blob.includes(MARK.create)) return 'after_create'
  if (isTool) return 'after_tool'
  if (userRequest.includes(MARK.hold) || last.content.includes(MARK.hold)) return 'hold'
  if (tools.includes('novel_propose') && userRequest.includes(MARK.edit)) return 'propose_edit'
  if (tools.includes('novel_propose') && userRequest.includes(MARK.create)) return 'propose_create'
  if (userRequest.includes(MARK.ping)) return 'ping'
  if (userRequest.includes(MARK.readLong)) return 'read_long'
  return 'chat_other'
}

function clipWire(text, max = 480) {
  const clean = String(text ?? '').replace(/sk-[A-Za-z0-9]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, '[redacted]')
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

function wireMeta(body, kind) {
  const last = lastNonAssistant(body)
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const messages = Array.isArray(body?.messages) ? body.messages : []
  return {
    kind,
    titlePrompt: isTitlePrompt(body),
    userRequest: clipWire(lastRealUserRequest(body), 160),
    lastRole: last.role,
    lastPreview: clipWire(last.content),
    userPreviews: messages.filter((item) => item?.role === 'user').map((item) => clipWire(messageText(item), 180)),
    toolNames: tools.map((item) => item?.function?.name || item?.name).filter(Boolean),
    messageRoles: messages.map((item) => item?.role),
    hasPing: flattenMessages(body).includes(MARK.ping),
  }
}

function completionId() {
  return `chatcmpl-${randomUUID().replaceAll('-', '')}`
}

function isOpenAiCompletionId(id) {
  return typeof id === 'string' && /^chatcmpl-[A-Za-z0-9]{20,}$/.test(id)
}

function sseChunk(model, delta, finish = null, extra = {}, id) {
  if (!isOpenAiCompletionId(id)) throw new Error('sse chunk requires a unique OpenAI completion id')
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  })}\n\n`
}

function parseSseId(chunk) {
  const line = String(chunk).split('\n').find((item) => item.startsWith('data: '))
  if (!line) throw new Error('sse chunk missing data line')
  return JSON.parse(line.slice(6)).id
}

function assertStableChunkIds(chunks, label) {
  if (!Array.isArray(chunks) || chunks.length < 2) throw new Error(`${label}: expected multiple chunks`)
  const ids = chunks.map((chunk) => parseSseId(chunk))
  if (ids.some((id) => id !== ids[0])) throw new Error(`${label}: unstable id ${JSON.stringify(ids)}`)
  if (!isOpenAiCompletionId(ids[0])) throw new Error(`${label}: invalid id ${ids[0]}`)
  return ids[0]
}

function verifyClassify() {
  const envelope = JSON.stringify({
    schema: 'dsh-editor.project-context',
    version: 3,
    user_request: MARK.ping,
    active_path: CHAPTER_REL,
  })
  const titleBody = {
    messages: [
      { role: 'system', content: `${TITLE_SYSTEM_MARK}\nReturn only the title on one line.` },
      { role: 'user', content: `${TITLE_USER_PREFIX}\n${JSON.stringify([{ seq: 1, text: envelope }])}` },
    ],
  }
  const agentBody = {
    messages: [
      { role: 'developer', content: '项目规则' },
      { role: 'user', content: envelope },
      { role: 'user', content: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: workspace-write.' },
    ],
    tools: [{ type: 'function', function: { name: 'novel_propose' } }],
  }
  const titleKind = classify(titleBody)
  const agentKind = classify(agentBody)
  if (titleKind !== 'title') throw new Error(`title wire classified as ${titleKind}`)
  if (agentKind !== 'ping') throw new Error(`agent envelope classified as ${agentKind}`)
}

function verifyResponseIds() {
  verifyClassify()
  const samples = [
    ['text-a', textChunks(MODEL_ID, PONG_TEXT)],
    ['text-b', textChunks(MODEL_ID, 'UI_STUB_OK')],
    ['tool-a', toolChunks(MODEL_ID, 'novel_propose', { kind: 'edit' }, 'call_ui_edit_1')],
    ['tool-b', toolChunks(MODEL_ID, 'novel_propose', { kind: 'create' }, 'call_ui_create_1')],
  ]
  const ids = samples.map(([label, chunks]) => assertStableChunkIds(chunks, label))
  if (new Set(ids).size !== ids.length) throw new Error(`response ids not unique: ${JSON.stringify(ids)}`)
  const minted = Array.from({ length: 48 }, () => completionId())
  if (new Set(minted).size !== minted.length) throw new Error('completionId collision')
}

function attachCancelFlags(req, res) {
  const flags = { closeBeforeEnd: false }
  req.on('aborted', () => { flags.closeBeforeEnd = true })
  res.on('close', () => { if (!res.writableEnded) flags.closeBeforeEnd = true })
  return flags
}

function clientCancelled(req, res, flags) {
  return Boolean(req.aborted) || res.destroyed || Boolean(flags?.closeBeforeEnd)
}

function finishResponse(res) {
  if (res.writableEnded || res.destroyed) return
  try { res.end() } catch { try { res.destroy() } catch { /* inbound already gone */ } }
}

async function streamSse(req, res, flags, model, chunks) {
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
  }
  try {
    for (const chunk of chunks) {
      if (clientCancelled(req, res, flags)) {
        finishResponse(res)
        return true
      }
      res.write(chunk)
    }
    if (clientCancelled(req, res, flags)) {
      finishResponse(res)
      return true
    }
    res.write('data: [DONE]\n\n')
    res.end()
    return false
  } catch {
    if (!res.writableEnded && !res.destroyed) res.destroy()
    return true
  }
}

function textChunks(model, text) {
  const id = completionId()
  return [
    sseChunk(model, { role: 'assistant', content: '' }, null, {}, id),
    sseChunk(model, { content: text }, null, {}, id),
    sseChunk(model, {}, 'stop', {}, id),
  ]
}

function toolChunks(model, name, args, callId) {
  const id = completionId()
  const payload = JSON.stringify(args)
  return [
    sseChunk(model, {
      role: 'assistant',
      tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: '' } }],
    }, null, {}, id),
    sseChunk(model, { tool_calls: [{ index: 0, function: { arguments: payload } }] }, null, {}, id),
    sseChunk(model, {}, 'tool_calls', {}, id),
  ]
}

function modelsPayload() {
  return {
    object: 'list',
    data: [MODEL_ID, FIM_MODEL_ID, REWRITE_MODEL_ID].map(id => ({ id, object: 'model', owned_by: 'ui-assistant-stub' })),
  }
}

async function respondSse(req, res, flags, record, model, chunks) {
  record.completionId = chunks[0] ? parseSseId(chunks[0]) : undefined
  const aborted = await streamSse(req, res, flags, model, chunks)
  record.aborted = aborted
  record.completed = !aborted
  if (aborted) finishResponse(res)
}

function startStub() {
  const requests = []
  const inbound = new Set()
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const flags = attachCancelFlags(req, res)
    const record = {
      at: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      host: String(req.headers.host || ''),
      kind: 'unknown',
      aborted: false,
      completed: false,
    }
    requests.push(record)
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      void (async () => {
        try {
          if (req.method === 'GET' && /\/models\/?$/.test(url.pathname)) {
            record.kind = 'models'
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(modelsPayload()))
            record.completed = true
            return
          }
          if (req.method !== 'POST' || !/chat\/completions/.test(url.pathname)) {
            record.kind = 'unhandled'
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: 'not found' } }))
            record.completed = true
            return
          }
          const raw = Buffer.concat(chunks).toString('utf8')
          const body = raw ? JSON.parse(raw) : {}
          const model = typeof body.model === 'string' ? body.model : MODEL_ID
          const kind = classify(body)
          record.kind = kind
          record.model = model
          record.wire = wireMeta(body, kind)
          if (kind === 'hold') {
            const deadline = Date.now() + 12_000
            while (Date.now() < deadline) {
              if (clientCancelled(req, res, flags)) {
                record.aborted = true
                finishResponse(res)
                return
              }
              await delay(50)
            }
            if (clientCancelled(req, res, flags)) {
              record.aborted = true
              finishResponse(res)
              return
            }
            await respondSse(req, res, flags, record, model, textChunks(model, LATE_TEXT))
            return
          }
          if (kind === 'rewrite') {
            await respondSse(req, res, flags, record, model, textChunks(model, REWRITE_REPLACEMENT))
            return
          }
          if (kind === 'fim' && flattenMessages(body).includes('UI_FIM_PROVIDER_ERROR')) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: { message: 'UI_FIM_PROVIDER_ERROR: selected model unavailable', type: 'invalid_request_error' } }))
            record.completed = true
            return
          }
          if (kind === 'fim') {
            await respondSse(req, res, flags, record, model, textChunks(model, FIM_INSERT))
            return
          }
          if (kind === 'propose_edit') {
            await respondSse(req, res, flags, record, model, toolChunks(model, 'novel_propose', {
              kind: 'edit',
              path: CHAPTER_REL,
              summary: '替换试笔段',
              oldText: ORIGINAL_LINE,
              newText: EDITED_LINE,
            }, 'call_ui_edit_1'))
            return
          }
          if (kind === 'propose_create') {
            await respondSse(req, res, flags, record, model, toolChunks(model, 'novel_propose', {
              kind: 'create',
              path: CREATE_REL,
              summary: '创建总纲草稿',
              text: CREATE_TEXT,
            }, 'call_ui_create_1'))
            return
          }
          const reply = kind === 'after_edit' ? AFTER_EDIT_TEXT
            : kind === 'after_create' ? AFTER_CREATE_TEXT
              : kind === 'read_long' ? READING_TEXT
              : kind === 'ping' ? PONG_TEXT
                : kind === 'title' ? TITLE_TEXT
                  : 'UI_STUB_OK'
          await respondSse(req, res, flags, record, model, textChunks(model, reply))
        } catch (error) {
          record.kind = 'error'
          record.error = error instanceof Error ? error.message : String(error)
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
          finishResponse(res)
        }
      })()
    })
  })
  server.on('connection', (socket) => {
    inbound.add(socket)
    socket.on('close', () => inbound.delete(socket))
  })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolvePromise({
        server,
        port,
        requests,
        baseURL: `http://127.0.0.1:${port}/v1`,
        async close() {
          for (const socket of inbound) {
            try { socket.destroy() } catch { /* already closed */ }
          }
          inbound.clear()
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
          await new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}

async function startDsh(env) {
  const logs = []
  const logFile = resolve(output, 'dsh.log')
  await writeFile(logFile, '', 'utf8')
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolvePromise, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      void writeFile(logFile, text, { flag: 'a' }).catch(() => undefined)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) resolvePromise(new URL(match[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`DSH exited before readiness (${code}): ${logs.join('').slice(-4_000)}`)))
  })
  const url = await Promise.race([
    ready,
    delay(60_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('').slice(-4_000)}`) }),
  ])
  return { child, url, logs }
}

async function seedWorkspace() {
  await mkdir(resolve(workspace, '正文'), { recursive: true })
  await mkdir(resolve(workspace, '大纲'), { recursive: true })
  await writeFile(resolve(workspace, '正文', '001.md'), CHAPTER_TEXT, 'utf8')
}

async function seedModelConfig() {
  await writeFile(resolve(home, 'settings.yaml'), [
    'ui-theme:',
    '  preference: light',
    'locale:',
    '  preference: zh',
    '',
  ].join('\n'), 'utf8')
}

function envFor() {
  const env = {
    ...process.env,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_DESKTOP_NODE_PATH: process.execPath,
    DSH_DESKTOP_CLI_PATH: cli,
    DSH_DESKTOP_PROFILE_TEMPLATE: template,
    DSH_HOME: home,
    DSH_EDITOR_PROJECTS_ROOT: projectsRoot,
    DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
    SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-ui-assistant',
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  }
  for (const key of [
    'DSH_EDITOR_CUSTOM_API_KEY', 'MINIMAX_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'MMX_CONFIG_PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy',
  ]) delete env[key]
  return env
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    if (!(await continueNotice.isVisible({ timeout: 800 }).catch(() => false))) break
    await continueNotice.click()
    await delay(200)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 1_500 }).catch(() => false)) await configureLater.click()
}

async function dismissOverlays(page = activePage) {
  if (!page) return
  for (let step = 0; step < 8; step += 1) {
    const initIgnore = page.getByRole('article', { name: '项目初始化' }).getByRole('button', { name: '忽略' })
    if (await initIgnore.isVisible().catch(() => false)) {
      await initIgnore.click()
      await delay(200)
      continue
    }
    const overlay = page.locator('.file-dialog-overlay, .palette-overlay, .import-overlay, .settings-overlay').first()
    if (!(await overlay.isVisible().catch(() => false))) return
    const close = overlay.getByRole('button', { name: /^(关闭|取消|关闭设置)$/ }).first()
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined)
    else await page.keyboard.press('Escape')
    await delay(200)
  }
}

async function cover(name, action) {
  try {
    await dismissOverlays()
    const detail = await action()
    recordCheck(name, true, typeof detail === 'string' ? detail : '')
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    recordCheck(name, false, detail)
    if (activePage) {
      await shot(activePage, `failed-${name}`).catch(() => undefined)
      await writeFile(resolve(output, `failed-${name}.html`), await activePage.content().catch(() => ''), 'utf8').catch(() => undefined)
    }
    await dismissOverlays().catch(() => undefined)
    return false
  }
}

function hostPage(scope) {
  return typeof scope.page === 'function' ? scope.page() : scope
}

function modelScope(page) {
  return page.locator('aside.chat .composer-model, aside.chat .model-picker').first()
}

async function chooseCustomSelect(scope, ariaLabel, matcher) {
  const page = hostPage(scope)
  const trigger = scope.getByRole('combobox', { name: ariaLabel }).first()
  await trigger.waitFor({ state: 'visible', timeout: 15_000 })
  await trigger.click()
  let list = page.getByRole('listbox', { name: ariaLabel })
  if (!(await list.isVisible({ timeout: 2_000 }).catch(() => false))) {
    list = page.getByRole('listbox').last()
  }
  await list.waitFor({ state: 'visible', timeout: 10_000 })
  const options = list.getByRole('option')
  const labels = await options.allTextContents()
  const index = labels.findIndex((label) => matcher(label.replace(/\s+/g, ' ').trim()))
  if (index < 0) {
    await page.keyboard.press('Escape')
    throw new Error(`${ariaLabel} option not found in ${JSON.stringify(labels)}`)
  }
  await options.nth(index).click()
  await list.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
  return labels[index]
}

async function openShellSettings(page) {
  const trigger = page.locator('.native-settings-control button').first()
  if (await trigger.isVisible().catch(() => false)) await trigger.click()
  else await page.keyboard.press('Control+,')
  await page.getByRole('dialog', { name: '设置' }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function closeShellSettings(page) {
  const close = page.getByRole('button', { name: '关闭设置' })
  if (await close.isVisible().catch(() => false)) await close.click()
  else await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '设置' }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
}

async function openModelsSettings(page) {
  await openShellSettings(page)
  const dialog = page.locator('.settings-dialog')
  const tab = dialog.getByRole('tab', { name: '模型' })
  const nav = dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '模型' })
  if (await tab.count()) await tab.click()
  else if (await nav.count()) await nav.click()
  else throw new Error('models settings control missing')
  const models = dialog.getByRole('region', { name: '模型' }).or(dialog.locator('.settings-content, .models-page, .models-editor').first())
  await waitFor(async () => !(await dialog.getByText('正在读取…').isVisible().catch(() => false)), 'models loaded', 45_000)
  return { dialog, models }
}

async function forceProtocol(scope) {
  const customized = scope.locator('summary').filter({ hasText: '自定义设置' })
  if (await customized.isVisible().catch(() => false)) {
    const expanded = await customized.evaluate((el) => el.closest('details')?.open === true).catch(() => false)
    if (!expanded) await customized.click()
  }
  const protocolTrigger = scope.getByRole('combobox', { name: 'API 协议' })
  if (!(await protocolTrigger.count())) return
  await protocolTrigger.waitFor({ state: 'visible', timeout: 8_000 })
  const current = await protocolTrigger.innerText()
  if (/openai-completions/i.test(current)) return
  await chooseCustomSelect(scope, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
}

async function fillCustomStubCard(card, baseURL) {
  await card.getByLabel('Provider ID').fill(PROVIDER_ID)
  await card.getByLabel('显示名称').fill('本地桩')
  await card.getByLabel('API 地址').fill(baseURL)
  await forceProtocol(card)
  await card.getByLabel('API 密钥').fill(PLACEHOLDER_KEY)
  if (!(await card.getByLabel('模型 id 1').isVisible().catch(() => false))) {
    await card.getByRole('button', { name: /添加模型/ }).click()
  }
  await card.getByLabel('模型 id 1').fill(MODEL_ID)
  for (const [index, id] of [[2, FIM_MODEL_ID], [3, REWRITE_MODEL_ID]]) {
    if (!(await card.getByLabel(`模型 id ${index}`, { exact: true }).count())) await card.getByRole('button', { name: /添加模型/ }).click()
    await card.getByLabel(`模型 id ${index}`, { exact: true }).fill(id)
  }
}

async function configureTestModel(page, baseURL) {
  const { models } = await openModelsSettings(page)
  const addCustom = models.getByRole('button', { name: '添加自定义提供方' })
  await addCustom.waitFor({ state: 'visible', timeout: 20_000 })
  const setupCancel = models.locator('.models-editor').first().getByRole('button', { name: '取消' })
  if (await setupCancel.isVisible().catch(() => false) && !(await models.locator('.models-add-card').count())) {
    await setupCancel.click()
  }
  const existing = models.locator('.models-row-card').filter({ hasText: /local-stub|本地桩/i })
  if (await existing.count()) {
    await existing.getByRole('button', { name: /编辑/ }).click()
    const editor = models.locator('.models-editor').last()
    await editor.waitFor({ state: 'visible', timeout: 10_000 })
    await editor.getByLabel('API 地址').fill(baseURL)
    await forceProtocol(editor)
    await editor.getByLabel('API 密钥').fill(PLACEHOLDER_KEY)
    const save = editor.getByRole('button', { name: '保存' })
    await waitFor(async () => save.isEnabled(), 'edit save enabled', 15_000)
    await save.click()
    await models.getByText('已保存。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
    await shot(page, 'settings-local-stub', '模型设置 · 编辑本地桩')
    await closeShellSettings(page)
    const yaml = await readFile(resolve(home, 'settings.yaml'), 'utf8')
    if (!yaml.includes(baseURL) || !yaml.includes(PROVIDER_ID) || !yaml.includes(MODEL_ID)) {
      throw new Error(`settings.yaml missing local stub contract after edit: ${yaml.slice(0, 400)}`)
    }
    return 'updated via settings UI'
  }
  await addCustom.click()
  const card = models.locator('.models-add-card, .models-editor').last()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await fillCustomStubCard(card, baseURL)
  const create = card.getByRole('button', { name: '创建提供方' })
  await waitFor(async () => {
    if (!(await card.isVisible().catch(() => false))) {
      if (await addCustom.isVisible().catch(() => false)) await addCustom.click()
      return false
    }
    const provider = await card.getByLabel('Provider ID').inputValue().catch(() => '')
    if (!provider) {
      await fillCustomStubCard(card, baseURL)
      return false
    }
    return create.isEnabled()
  }, 'custom stub create enabled', 30_000)
  await create.click()
  await models.getByText('已保存。', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 })
  await models.locator('.models-row-card').filter({ hasText: /本地桩|local-stub/i }).waitFor({ state: 'visible', timeout: 10_000 })
  await shot(page, 'settings-local-stub', '模型设置 · 创建本地桩')
  await closeShellSettings(page)
  const yaml = await readFile(resolve(home, 'settings.yaml'), 'utf8')
  if (!yaml.includes(baseURL) || !yaml.includes(PROVIDER_ID) || !yaml.includes(MODEL_ID)) {
    throw new Error(`settings.yaml missing local stub contract: ${yaml.slice(0, 400)}`)
  }
  await delay(800)
  return `created via settings UI (${baseURL})`
}

async function openSeededWorkspace(page) {
  await dismissNativeOnboarding(page)
  await page.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = page.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible', timeout: 15_000 })
  await pathBox.fill(workspace)
  await page.getByRole('button', { name: '打开此目录' }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 45_000 })
}

async function expandDirectory(page, name) {
  const dir = page.locator('.tree-directory-row').filter({ hasText: name }).locator('.tree-row[aria-expanded]').first()
  await dir.waitFor({ state: 'attached', timeout: 15_000 })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await dir.getAttribute('aria-expanded') === 'true') return
    await dir.click()
    await delay(200)
  }
}

async function openChapter(page) {
  await expandDirectory(page, '正文')
  const row = page.locator('.tree-row.tree-main').filter({ hasText: '001.md' }).first()
  await row.waitFor({ state: 'visible', timeout: 15_000 })
  await row.click()
  await page.locator('[data-testid="paper-path"]', { hasText: /正文\/001\.md/ }).waitFor({ state: 'visible', timeout: 20_000 })
}

async function ensureAssistantOpen(page) {
  const assistant = page.locator('aside.chat')
  if (await assistant.isVisible().catch(() => false)) return page.getByRole('complementary', { name: '写作助手' })
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  else await page.getByRole('button', { name: '搭档', exact: true }).click()
  await assistant.waitFor({ state: 'visible', timeout: 30_000 })
  return page.getByRole('complementary', { name: '写作助手' })
}

function isStubModelLabel(label) {
  // The fixture ID is unique. Provider identity is still required from the selected value by isExactStubModel.
  return /ui-assistant-stub/.test(label)
}

function isExactStubModel(info) {
  const value = String(info.value || '').replace(/^v:/, '')
  const trigger = String(info.trigger || '').replace(/\s+/g, ' ')
  const label = String(info.label || '').replace(/\s+/g, ' ')
  const blob = `${trigger} ${label} ${value}`
  if (/deepseek|minimax|openai|anthropic/i.test(blob) && !/local-stub|本地桩/.test(blob)) return false
  const hasStubId = /ui-assistant-stub/.test(blob)
  const hasStubProvider = /local-stub/.test(value) || /本地桩/.test(trigger) || /本地桩/.test(label)
  return hasStubId && hasStubProvider
}

async function readModelFrom(root) {
  if (!(await root.count())) return { trigger: '', value: '', label: '' }
  return root.evaluate((node) => {
    const trigger = node.querySelector('[role="combobox"][aria-label="选择模型"]')
      || node.querySelector('[aria-label="选择模型"]')
      || node.querySelector('.select-trigger')
    const proxy = node.querySelector('select')
    const value = proxy instanceof HTMLSelectElement
      ? String(proxy.value || '')
      : String(trigger?.getAttribute('data-value') || '')
    const label = proxy instanceof HTMLSelectElement
      ? String(proxy.selectedOptions[0]?.textContent || '')
      : ''
    return {
      trigger: String(trigger?.textContent || '').replace(/\s+/g, ' ').trim(),
      value: value.replace(/^v:/, ''),
      label: label.replace(/\s+/g, ' ').trim(),
    }
  })
}

async function readActiveModel(page) {
  return readModelFrom(modelScope(page))
}

async function waitForStubRoute(page, label) {
  await waitFor(async () => {
    const trigger = modelScope(page).getByRole('combobox', { name: '选择模型' }).first()
    if (await trigger.isDisabled().catch(() => true)) return false
    return isExactStubModel(await readActiveModel(page))
  }, `${label}: UI shows ${PROVIDER_ID}/${MODEL_ID}`, 15_000)
  await delay(250)
  const info = await readActiveModel(page)
  if (!isExactStubModel(info)) {
    throw new Error(`${label}: after settle still ${JSON.stringify(info)}, need ${PROVIDER_ID}/${MODEL_ID}`)
  }
  return info
}

async function assertStubSelected(page, label) {
  const trigger = modelScope(page).getByRole('combobox', { name: '选择模型' }).first()
  const info = await readActiveModel(page)
  const busy = await trigger.isDisabled().catch(() => true)
  if (!busy && info.trigger && !isExactStubModel(info)) {
    throw new Error(`${label}: refusing send; active model is ${JSON.stringify(info)}, need ${PROVIDER_ID}/${MODEL_ID}`)
  }
  return waitForStubRoute(page, label)
}

async function chooseStubModel(scope, label) {
  const page = hostPage(scope)
  const trigger = scope.getByRole('combobox', { name: '选择模型' }).first()
  await trigger.waitFor({ state: 'visible', timeout: 15_000 })
  let lastLabels = []
  try {
    await waitFor(async () => {
      if (isExactStubModel(await readModelFrom(scope))) return true
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
      let list = page.getByRole('listbox', { name: '选择模型' })
      if (!(await list.isVisible().catch(() => false))) list = page.getByRole('listbox').last()
      if (!(await list.isVisible().catch(() => false))) return false
      lastLabels = (await list.getByRole('option').allTextContents()).map((item) => item.replace(/\s+/g, ' ').trim())
      const index = lastLabels.findIndex((item) => isStubModelLabel(item))
      if (index < 0) {
        await page.keyboard.press('Escape').catch(() => undefined)
        await delay(250)
        return false
      }
      await list.getByRole('option').nth(index).click()
      await list.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
      return isExactStubModel(await readModelFrom(scope))
    }, `${label}: stub option`, 20_000)
  } catch (error) {
    await page.keyboard.press('Escape').catch(() => undefined)
    throw new Error(`${label}: stub option missing in ${JSON.stringify(lastLabels)}; ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function startConversationWithStub(page, assistant) {
  const picker = page.getByRole('dialog', { name: '新对话' })
  if (!(await picker.isVisible().catch(() => false))) {
    await assistant.getByRole('button', { name: '新对话' }).click()
    await picker.waitFor({ state: 'visible', timeout: 10_000 })
  }
  await chooseStubModel(picker, 'new conversation')
  const chosen = await readModelFrom(picker)
  if (!isExactStubModel(chosen) && !isStubModelLabel(`${chosen.trigger} ${chosen.label}`)) {
    throw new Error(`new conversation did not keep stub: ${JSON.stringify(chosen)}`)
  }
  const start = picker.getByRole('button', { name: '开始', exact: true })
  await waitFor(async () => start.isEnabled(), 'new conversation start enabled', 10_000)
  await start.click()
  const failed = picker.locator('.warning')
  if (await failed.isVisible({ timeout: 2_000 }).catch(() => false)) {
    throw new Error(`new conversation failed: ${(await failed.innerText()).trim()}`)
  }
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 1_500 }).catch(() => false)) await discard.click()
  await picker.waitFor({ state: 'hidden', timeout: 20_000 })
}

async function selectAssistantModel(page) {
  const assistant = await ensureAssistantOpen(page)
  const dialog = page.getByRole('dialog', { name: '新对话' })
  const composer = modelScope(page)
  await waitFor(async () => (
    (await dialog.isVisible().catch(() => false))
    || (await composer.getByRole('combobox', { name: '选择模型' }).count()) > 0
  ), 'assistant model combobox attached', 25_000)
  // Prefer the composer Select: Chat is bound to currentSession ?? fileSession,
  // which is the same sessionId manuscript assist reads for FIM/rewrite.
  if (await composer.getByRole('combobox', { name: '选择模型' }).count()) {
    if (await dialog.isVisible().catch(() => false)) {
      const cancel = dialog.getByRole('button', { name: '取消' })
      if (await cancel.isVisible().catch(() => false)) await cancel.click()
      else await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
    }
    if (!isExactStubModel(await readActiveModel(page))) {
      await chooseStubModel(composer, 'composer')
    }
  } else {
    await startConversationWithStub(page, assistant)
  }
  await waitForStubRoute(page, 'open-assistant')
  const effort = assistant.getByRole('combobox', { name: '思考强度' })
  if (await effort.isVisible().catch(() => false)) {
    const effortText = await effort.innerText()
    if (!/off|Off|低/i.test(effortText)) {
      try {
        await chooseCustomSelect(assistant, '思考强度', (label) => /^(off|Off|低)$/i.test(label.trim()) || /\boff\b/i.test(label))
      } catch {
        await page.keyboard.press('Escape').catch(() => undefined)
      }
    }
  }
  const info = await assertStubSelected(page, 'open-assistant')
  return `${info.label || info.trigger}`
}

async function answerPending(page) {
  const approval = page.getByRole('article', { name: '工具审批' }).last()
  if (await approval.isVisible().catch(() => false)) {
    await approval.getByRole('button', { name: '允许一次' }).click()
    return true
  }
  const question = page.getByRole('form', { name: '回答问题' }).last()
  if (await question.isVisible().catch(() => false)) {
    const options = question.locator('.question-option')
    if (await options.count()) await options.first().click()
    else await question.locator('.question-custom').fill('继续。')
    await question.getByRole('button', { name: '提交全部回答' }).click()
    return true
  }
  const memory = page.getByRole('article', { name: '作者侧写建议' }).last()
  if (await memory.isVisible().catch(() => false)) {
    const ignore = memory.getByRole('button', { name: '忽略' })
    if (await ignore.isVisible().catch(() => false)) await ignore.click()
    return true
  }
  const initIgnore = page.getByRole('article', { name: '项目初始化' }).getByRole('button', { name: '忽略' })
  if (await initIgnore.isVisible().catch(() => false)) {
    await initIgnore.click()
    return true
  }
  return false
}

async function waitUntilIdle(page, timeout = 25_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await answerPending(page)
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (!stopVisible) return
    await delay(200)
  }
}

async function sendChat(page, prompt, label, timeout = 30_000) {
  await assertStubSelected(page, label)
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning, .chat-row.notice').filter({ hasText: /未能完成|中断/ }).count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 20_000)
  await send.click()
  await waitFor(async () => page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false), `${label}: turn started`, 20_000)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await answerPending(page)
    if (await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count() > warningBaseline) {
      throw new Error(`${label}: 写作助手未能完成这次请求`)
    }
    const count = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (count > assistantBefore && !stopVisible) {
      const text = (await page.locator('.chat-row.assistant').last().innerText()).trim()
      if (text && !/^正在回复/.test(text)) return text
    }
    await delay(200)
  }
  throw new Error(`${label}: timed out without assistant reply`)
}

async function waitForProposal(page, previousCount, label, expectedPath) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const warnings = page.locator('.chat-history .warning, .chat-row.notice').filter({ hasText: /未能完成|中断/ })
  const warningBaseline = await warnings.count()
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await answerPending(page)
    if (await warnings.count() > warningBaseline) {
      throw new Error(`${label}: ${await warnings.last().innerText()} (model=${JSON.stringify(await readActiveModel(page))})`)
    }
    const count = await cards.count()
    if (count > previousCount) {
      const card = cards.last()
      const text = await card.innerText().catch(() => '')
      if (expectedPath && !text.includes(expectedPath)) {
        await delay(200)
        continue
      }
      const ready = await card.getByText('可以安全应用', { exact: true }).isVisible().catch(() => false)
      const applied = await card.getByText('已应用到作品', { exact: true }).isVisible().catch(() => false)
      if (ready || applied) return card
    }
    await delay(200)
  }
  throw new Error(`${label}: no proposal (model=${JSON.stringify(await readActiveModel(page))})`)
}

async function sendForProposal(page, prompt, expectedPath, label) {
  await assertStubSelected(page, label)
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const before = await cards.count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 20_000)
  await send.click()
  return waitForProposal(page, before, label, expectedPath)
}

async function readChapter() {
  return readFile(resolve(workspace, '正文', '001.md'), 'utf8')
}

function selectPaperRange(page, from, to) {
  report.selectionMethod = 'read CodeMirror __cmView then view.dispatch selection (matches e2e/feature-coverage selectPaperRange); normal input uses Playwright fill/insertText, not CM dispatch'
  return page.evaluate(({ start, end }) => {
    const el = document.querySelector('[data-testid="paper-editor"]')
    const view = /** @type {any} */ (el)?.__cmView
    if (!view) return false
    const length = view.state.doc.length
    view.dispatch({ selection: { anchor: Math.max(0, Math.min(start, length)), head: Math.max(0, Math.min(end, length)) } })
    view.focus()
    return true
  }, { start: from, end: to })
}

async function armImeCapture(page, flags) {
  await page.evaluate((next) => {
    const patch = (event, key, value) => {
      try {
        Object.defineProperty(event, key, { configurable: true, get: () => value })
      } catch { /* trusted event field may already be non-configurable */ }
    }
    const handler = (event) => {
      if (event.key !== 'Enter') return
      if (next.isComposing) patch(event, 'isComposing', true)
      if (typeof next.keyCode === 'number') patch(event, 'keyCode', next.keyCode)
    }
    document.addEventListener('keydown', handler, { capture: true, once: true })
  }, flags)
}

function scanExternalHosts(text) {
  return [...new Set(String(text).match(/https?:\/\/[^\s"'<>]+/gi) || [])]
    .filter((url) => !/127\.0\.0\.1|localhost/i.test(url))
    .filter((url) => /minimax|deepseek|openai|anthropic|openrouter|minimaxi/i.test(url))
}

async function assertNoExternalModelCalls() {
  const log = await readFile(resolve(output, 'dsh.log'), 'utf8').catch(() => '')
  const leaked = scanExternalHosts(log)
  if (leaked.length) throw new Error(`external host in dsh.log: ${leaked.slice(0, 5).join(', ')}`)
  const badHost = (stub?.requests ?? []).find((item) => item.host && !/127\.0\.0\.1/.test(item.host))
  if (badHost) throw new Error(`stub host was not loopback: ${badHost.host}`)
  if (!stub?.baseURL.startsWith('http://127.0.0.1:')) throw new Error(`stub base was ${stub?.baseURL}`)
}

async function savePaper(page) {
  const save = page.getByRole('button', { name: '保存', exact: true })
  if (await save.isVisible().catch(() => false) && await save.isEnabled().catch(() => false)) await save.click()
  else await page.keyboard.press('Control+s')
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function main() {
  verifyResponseIds()
  for (const target of owned) {
    if (forbidden.some((item) => target === item || target.startsWith(`${item}${sep}`))) {
      throw new Error(`refusing to delete forbidden path: ${target}`)
    }
  }
  stub = await startStub()
  report.stub.baseURL = stub.baseURL
  note('stub listening', stub.baseURL)

  await rm(home, { recursive: true, force: true })
  await rm(projectsRoot, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  await rm(output, { recursive: true, force: true })
  await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
  await mkdir(projectsRoot, { recursive: true })
  await mkdir(output, { recursive: true })
  await seedWorkspace()
  await deployProfile(home, template, resolve(runtime, 'node_modules'))
  await seedModelConfig()

  const started = await startDsh(envFor())
  dshChild = started.child
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    recordVideo: { dir: resolve(output, 'video'), size: { width: 1440, height: 900 } },
  })
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
  report.modelSelections = []
  page.on('request', request => {
    try {
      const body = request.postDataJSON()
      if (body?.method === 'session.selectModel' || request.url().includes('selectModel')) report.modelSelections.push({url: new URL(request.url()).pathname, payload: body?.payload})
    } catch {}
  })


  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)
  await shot(page, 'home', '首页')

  if (!(await cover('configure-test-model', async () => configureTestModel(page, stub.baseURL)))) {
    skipDependents('configure-test-model failed; stub provider not in settings')
    return
  }
  if (!(await cover('open-synthetic-work', async () => {
    await openSeededWorkspace(page)
    await openChapter(page)
    const onDisk = await readChapter()
    if (!onDisk.includes(ORIGINAL_LINE)) throw new Error('seeded chapter missing original line')
    await shot(page, 'workbench', '合成作品与章节')
    return CHAPTER_REL
  }))) {
    skipDependents('open-synthetic-work failed')
    return
  }
  if (!(await cover('independent-model-settings', async () => {
    const { dialog } = await openModelsSettings(page)
    for (const [label, id] of [['补全模型', FIM_MODEL_ID], ['改写模型', REWRITE_MODEL_ID], ['默认对话模型', MODEL_ID]]) {
      await chooseCustomSelect(dialog, label, text => text.includes(id))
      await waitFor(async () => !(await dialog.getByRole('combobox', { name: label, exact: true }).isDisabled()), `${label} saved`, 10000)
    }
    await shot(page, 'model-roles', '三个用途分别选择模型')
    await closeShellSettings(page)
    await page.evaluate(() => localStorage.setItem('dsh-editor.layout.assistant-width', '300'))
    await page.reload()
    await page.locator('.shell').waitFor()
    const reloaded = (await openModelsSettings(page)).dialog
    for (const [label, id] of [['补全模型', FIM_MODEL_ID], ['改写模型', REWRITE_MODEL_ID], ['默认对话模型', MODEL_ID]]) {
      await reloaded.getByRole('combobox', { name: label, exact: true }).filter({hasText: id}).waitFor()
    }
    await closeShellSettings(page)
    await openChapter(page)
    return 'three distinct persisted routes after reload'
  }))) return

  await cover('writing-settings-without-goal', async () => {
    await openShellSettings(page)
    const dialog = page.getByRole('dialog', {name: '设置'})
    await dialog.getByRole('tab', {name: '写作', exact: true}).click()
    await dialog.getByRole('checkbox', {name: /^打字机滚动/}).waitFor()
    await dialog.getByRole('checkbox', {name: /^聚焦当前段落/}).waitFor()
    if (await dialog.getByText(/每日目标/).count()) throw new Error('daily goal still shown')
    await shot(page, 'writing-settings', '写作设置，已移除每日目标')
    await closeShellSettings(page)
    return 'paper controls in settings, no daily goal'
  })

  await cover('settings-motion-and-draft', async () => {
    await openShellSettings(page)
    const dialog = page.getByRole('dialog', {name: '设置'})
    await dialog.getByRole('tab', {name: '写作', exact: true}).click()
    const authorDraft = dialog.getByRole('textbox', {name: '跨作品作者约定', exact: true})
    await authorDraft.fill('UI_DRAFT_PRESERVED')
    const sample = async tab => {
      await delay(500)
      await page.evaluate(() => {
        globalThis.__pageMotionSamples = []
        const end = performance.now() + 650
        const sample = () => {
          for (const el of document.querySelectorAll('.settings-content.is-active .settings-page')) {
            if (!el.getClientRects().length) continue
            const style = getComputedStyle(el)
            globalThis.__pageMotionSamples.push({opacity: Number(style.opacity), transform: style.transform})
          }
          if (performance.now() < end) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await dialog.getByRole('tab', {name: tab, exact: true}).click()
      await delay(700)
      return page.evaluate(() => globalThis.__pageMotionSamples)
    }
    const samples = await sample('模型')
    if (await dialog.getByRole('tabpanel').count() !== 1) throw new Error('inactive settings tabs remain in the accessibility tree')
    const moved = row => row.opacity < 0.99 || !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(row.transform)
    if (!samples.some(moved)) throw new Error('tab switch has no visible entrance motion')
    await dialog.getByRole('tab', {name: '写作', exact: true}).click()
    if (await authorDraft.inputValue() !== 'UI_DRAFT_PRESERVED') throw new Error('switching settings tabs lost unsaved author draft')
    await page.emulateMedia({reducedMotion: 'reduce'})
    await delay(200)
    const reduced = await sample('模型')
    if (reduced.some(moved)) throw new Error('reduced-motion still moves settings content')
    await page.emulateMedia({reducedMotion: 'no-preference'})
    await closeShellSettings(page)
    return 'real tab entrance, draft retained across tabs, reduced motion respected'
  })

  await cover('feature-switch-ui', async () => {
    await openShellSettings(page)
    const dialog = page.getByRole('dialog', {name: '设置'})
    await dialog.getByRole('tab', {name: '插件', exact: true}).click()
    const switches = dialog.getByRole('switch', {name: /知乎|资料检索/})
    await switches.first().waitFor()
    if (await switches.count() !== 1) throw new Error('Zhihu still has separate switches')
    if (await dialog.getByRole('switch', {name: '校对', exact: true}).count() !== 1) throw new Error('proofreading is not one user-facing feature')
    if (await dialog.getByRole('switch', {name: '作品概览', exact: true}).count() !== 1) throw new Error('overview is not one user-facing feature')
    if (await dialog.getByRole('switch').count() > 6) throw new Error('bundled features are still split by implementation package')
    const control = switches.first()
    await waitFor(async () => !(await control.isDisabled()), 'feature switch ready', 10000)
    const enabledAppearance = await switchAppearance(control)
    assertCapsuleSwitch(enabledAppearance)
    await control.focus()
    await page.keyboard.press('Space')
    await waitFor(async () => await control.getAttribute('aria-checked') === 'false', 'feature disabled through keyboard', 15000)
    await waitFor(async () => !(await control.isDisabled()), 'feature disable operation settled', 10000)
    const state = JSON.parse(await readFile(resolve(home, 'dsh-plugins.json'), 'utf8'))
    if (state.overrides.zhihu !== false || state.overrides['zhihu-tools'] !== false) throw new Error('feature switch did not persist both Zhihu entries')
    if (await dialog.locator('.dsh-plugins-error').isVisible().catch(() => false)) throw new Error('feature disable reported an error: ' + await dialog.locator('.dsh-plugins-error').innerText())
    const disabledAppearance = await switchAppearance(control)
    if (disabledAppearance.background === enabledAppearance.background) throw new Error('enabled and disabled switch tracks are indistinguishable')
    await control.click()
    await waitFor(async () => await control.getAttribute('aria-checked') === 'true', 'feature enabled through click', 15000)
    await waitFor(async () => !(await control.isDisabled()), 'switch idle', 10000)
    await page.route(/\/dsh-editor-plugins\/entr(?:y|ies)\.setEnabled$/, route => route.abort('failed'), {times: 1})
    await control.click()
    await dialog.locator('.dsh-plugins-error').waitFor()
    await waitFor(async () => !(await control.isDisabled()), 'switch recovers after transport rejection', 10000)
    if (await control.getAttribute('aria-checked') !== 'true') throw new Error('failed toggle lied about actual state')
    await shot(page, 'feature-switches', '合并后的功能开关')
    await closeShellSettings(page)
    return 'visible capsule switch, distinct on/off tracks, persisted group state, and transport failure recovery'
  })

  if (!(await cover('open-assistant', async () => {
    const chosen = await selectAssistantModel(page)
    await waitUntilIdle(page)
    await shot(page, 'assistant-ready', '写作助手已选本地桩')
    return chosen
  }))) {
    skipDependents('open-assistant failed; active conversation is not local-stub/ui-assistant-stub')
    return
  }

  await cover('ime-composing-enter', async () => {
    await waitUntilIdle(page)
    const composer = page.getByRole('textbox', { name: '输入消息' })
    await composer.click()
    await composer.fill('IME_COMPOSING_SHOULD_NOT_SEND')
    const before = stub.requests.length
    await armImeCapture(page, { isComposing: true })
    await page.keyboard.press('Enter')
    await delay(400)
    const value = await composer.inputValue()
    if (!value.includes('IME_COMPOSING_SHOULD_NOT_SEND')) throw new Error('isComposing Enter submitted the composer')
    if (stub.requests.length !== before) throw new Error('isComposing Enter reached the stub')
    if (await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)) {
      throw new Error('isComposing Enter started a turn')
    }
    return 'trusted Playwright Enter + oneshot capture isComposing'
  })

  await cover('ime-keycode-229', async () => {
    const composer = page.getByRole('textbox', { name: '输入消息' })
    await composer.click()
    await composer.fill('IME_229_SHOULD_NOT_SEND')
    const before = stub.requests.length
    await armImeCapture(page, { keyCode: 229 })
    await page.keyboard.press('Enter')
    await delay(400)
    const value = await composer.inputValue()
    if (!value.includes('IME_229_SHOULD_NOT_SEND')) throw new Error('keyCode 229 Enter submitted the composer')
    if (stub.requests.length !== before) throw new Error('keyCode 229 Enter reached the stub')
    if (await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)) {
      throw new Error('keyCode 229 Enter started a turn')
    }
    return 'trusted Playwright Enter + oneshot capture keyCode 229'
  })

  const pingOk = await cover('enter-positive-control', async () => {
    const composer = page.getByRole('textbox', { name: '输入消息' })
    await composer.click()
    await composer.fill(MARK.ping)
    const send = page.getByRole('button', { name: '发送', exact: true })
    await waitFor(async () => send.isEnabled(), 'positive Enter: send enabled', 15_000)
    await assertStubSelected(page, 'positive Enter')
    const before = stub.requests.length
    await page.keyboard.press('Enter')
    await waitFor(async () => {
      if (stub.requests.length > before) return true
      const failed = await page.locator('.chat-history .warning, .chat-row.notice').filter({ hasText: /未能完成/ }).count()
      if (failed) throw new Error(`ordinary Enter used non-stub route: model=${JSON.stringify(await readActiveModel(page))}`)
      return false
    }, 'positive Enter reached stub', 20_000)
    await waitFor(async () => {
      const last = (await page.locator('.chat-row.assistant').last().innerText().catch(() => '')).trim()
      return last.includes(PONG_TEXT) && !/^正在回复/.test(last)
    }, 'visible pong after ordinary Enter', 25_000)
    await waitUntilIdle(page)
    await shot(page, 'assistant-pong', '普通 Enter 到达本地桩')
    return PONG_TEXT
  })

  if (pingOk) {
    await cover('chat-visible-reply', async () => {
      await waitUntilIdle(page)
      const last = (await page.locator('.chat-row.assistant').last().innerText().catch(() => '')).trim()
      if (!last || /^正在回复/.test(last)) throw new Error('assistant turn not finished')
      if (last.includes(TITLE_TEXT) && !last.includes(PONG_TEXT)) {
        throw new Error('visible assistant reply is title stub, not PONG')
      }
      if (last.includes('UI_STUB_OK') && !last.includes(PONG_TEXT)) {
        throw new Error('visible assistant reply is UI_STUB_OK, not PONG')
      }
      if (!last.includes(PONG_TEXT)) throw new Error('visible assistant reply missing')
      const ping = stub.requests.find((item) => item.kind === 'ping')
      if (!ping) throw new Error(`stub kinds ${JSON.stringify(stub.requests.map((item) => item.kind))}`)
      if (ping.aborted) throw new Error('uncancelled ping reported aborted')
      if (!ping.completed) throw new Error('ping SSE did not complete with [DONE]')
      if (ping.wire?.titlePrompt) throw new Error('ping kind was the title prompt')
      if (ping.wire && !String(ping.wire.userRequest || '').includes(MARK.ping)) {
        throw new Error(`ping wire user_request was ${JSON.stringify(ping.wire.userRequest)}`)
      }
      return PONG_TEXT
    })
  } else {
    recordCheck('chat-visible-reply', false, 'dependency-skipped-as-failure: enter-positive-control failed')
  }

  const previewOk = await cover('edit-preview-leaves-file', async () => {
    const before = await readChapter()
    const card = await sendForProposal(page, MARK.edit, CHAPTER_REL, 'edit proposal')
    const ready = await card.getByText('可以安全应用', { exact: true }).isVisible()
    if (!ready) throw new Error('edit proposal not ready')
    const after = await readChapter()
    if (after !== before) throw new Error('preview mutated the file')
    if (!after.includes(ORIGINAL_LINE) || after.includes(EDITED_LINE)) throw new Error('preview changed chapter text')
    await shot(page, 'edit-preview', 'EDIT 预览未写盘')
    return 'file unchanged before apply'
  })
  if (!previewOk) {
    recordCheck('edit-apply-writes', false, 'dependency-skipped-as-failure: edit-preview-leaves-file failed')
    recordCheck('edit-undo-restores', false, 'dependency-skipped-as-failure: edit-preview-leaves-file failed')
  } else if (!(await cover('edit-apply-writes', async () => {
    const card = page.getByRole('article', { name: '文件修改建议' }).last()
    await card.getByRole('button', { name: '应用', exact: true }).click()
    await card.getByText('已应用到作品', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    await waitFor(async () => (await readChapter()).includes(EDITED_LINE), 'applied text on disk', 10_000)
    const text = await readChapter()
    if (text.includes(ORIGINAL_LINE)) throw new Error('original line still present after apply')
    await shot(page, 'edit-applied', '应用后真实写盘')
    return 'proposal.apply wrote expected text'
  }))) {
    recordCheck('edit-undo-restores', false, 'dependency-skipped-as-failure: edit-apply-writes failed')
  } else {
    await cover('edit-undo-restores', async () => {
      const card = page.getByRole('article', { name: '文件修改建议' }).last()
      const undo = card.getByRole('button', { name: '撤销此次修改' })
      await undo.waitFor({ state: 'visible', timeout: 10_000 })
      await undo.click()
      await card.getByText('已撤销，作品已恢复到应用前的内容', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
      await waitFor(async () => (await readChapter()).includes(ORIGINAL_LINE), 'undo restored disk', 10_000)
      const text = await readChapter()
      if (text.includes(EDITED_LINE)) throw new Error('edited line remained after undo')
      await shot(page, 'edit-undone', '撤销恢复原文')
      return 'file.write undo restored original'
    })
  }

  await cover('ignored-create-never-writes', async () => {
    if (await exists(resolve(workspace, '大纲', '总纲.md'))) throw new Error('create target already existed')
    const card = await sendForProposal(page, MARK.create, CREATE_REL, 'create proposal')
    await card.getByRole('button', { name: '忽略' }).click()
    await card.getByText('已忽略，未修改作品', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    await delay(500)
    if (await exists(resolve(workspace, '大纲', '总纲.md'))) throw new Error('ignored CREATE wrote the file')
    await shot(page, 'create-ignored', '忽略 CREATE 未写盘')
    return 'create file absent'
  })

  await cover('cancel-pending-no-late-mutation', async () => {
    await assertStubSelected(page, 'hold')
    const beforeFile = await readChapter()
    const composer = page.getByRole('textbox', { name: '输入消息' })
    await composer.fill(MARK.hold)
    const send = page.getByRole('button', { name: '发送', exact: true })
    await waitFor(async () => send.isEnabled(), 'hold send enabled', 15_000)
    await send.click()
    await waitFor(async () => page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false), 'hold started', 15_000)
    await page.getByRole('button', { name: /停止/ }).click()
    await waitFor(async () => !(await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)), 'stop finished', 15_000)
    await delay(6_000)
    const afterText = await page.locator('aside.chat').innerText()
    if (afterText.includes(LATE_TEXT)) throw new Error('late stub reply became visible after stop')
    const afterFile = await readChapter()
    if (afterFile !== beforeFile) throw new Error('pending cancel mutated the chapter file')
    const hold = stub.requests.filter((item) => item.kind === 'hold')
    report.stub.hold = hold.map((item) => ({ aborted: item.aborted, completed: item.completed, at: item.at }))
    await shot(page, 'cancelled', '停止后无迟到可见写入')
    return hold.some((item) => item.aborted) ? 'HTTP aborted; no late UI' : 'HTTP completed LATE; UI did not show it'
  })

  await cover('rewrite-custom', async () => {
    await assertStubSelected(page, 'rewrite')
    await openChapter(page)
    const menuTrigger = page.getByTestId('paper-editor-menu-trigger')
    if (!(await menuTrigger.count())) throw new Error('paper editor menu trigger missing')
    const text = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = /** @type {any} */ (el)?.__cmView
      return view ? view.state.doc.toString() : ''
    })
    const start = text.indexOf(REWRITE_NEEDLE)
    if (start < 0) throw new Error('rewrite needle missing in editor')
    const end = text.indexOf('\n', start)
    if (!(await selectPaperRange(page, start, end > start ? end : start + REWRITE_NEEDLE.length))) {
      throw new Error('CodeMirror view missing for rewrite selection')
    }
    await menuTrigger.click()
    await page.getByTestId('editor-menu-rewrite').click()
    const customRewrite = page.getByRole('dialog', { name: '自定义改写' })
    await customRewrite.getByLabel('输入改写要求').fill('缩短并保留信息')
    await customRewrite.getByRole('button', { name: '改写', exact: true }).click()
    const proposal = page.locator('[aria-label="选段修改建议"]')
    try {
      await waitFor(async () => {
        if (await proposal.isVisible().catch(() => false)) return true
        const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
        if (!/^正在/.test(notice) && /未返回|失败|未启用|不可用/.test(notice)) throw new Error(notice)
        return false
      }, 'rewrite suggestion', 25_000)
    } catch (error) {
      const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
      const rewrite = stub.requests.find((item) => item.kind === 'rewrite')
      if (rewrite?.completed && !rewrite.aborted) {
        throw new Error(`product: stub completed rewrite but UI failed (${notice || (error instanceof Error ? error.message : String(error))})`)
      }
      throw new Error(`rewrite did not complete on stub kinds=${JSON.stringify(stub.requests.map((item) => item.kind))} notice=${notice} ${error instanceof Error ? error.message : String(error)}`)
    }
    await proposal.getByRole('button', { name: '应用修改' }).click()
    await savePaper(page)
    const saved = await readChapter()
    if (!saved.includes(REWRITE_REPLACEMENT)) throw new Error('rewrite apply+save did not write expected text')
    const request = stub.requests.findLast(item => item.kind === 'rewrite')
    if (request?.model !== REWRITE_MODEL_ID) throw new Error(`rewrite route was ${request?.model}`)
    await assertStubSelected(page, 'chat model unchanged after rewrite')
    await shot(page, 'rewrite', '选段缩短已保存')
    return 'UI apply + save'
  })

  await cover('fim-complete', async () => {
    await assertStubSelected(page, 'fim')
    await openChapter(page)
    const menuTrigger = page.getByTestId('paper-editor-menu-trigger')
    if (!(await menuTrigger.count())) throw new Error('paper editor menu trigger missing')
    const content = page.locator('[data-testid="paper-editor"] .cm-content')
    await content.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText(`\n\n${FIM_PREFIX}`)
    await savePaper(page)
    await page.waitForFunction(() => {
      const view = document.querySelector('[data-testid="paper-editor"]')?.__cmView
      return view && view.state.selection.main.head === view.state.doc.length
    })
    await menuTrigger.click()
    await page.getByTestId('editor-menu-complete').click()
    try {
      await waitFor(async () => {
        if (await page.locator('[data-testid="paper-ghost"]').count()) return true
        const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
        if (!/^正在/.test(notice) && /未返回|失败|已停止|未启用|不可用/.test(notice)) throw new Error(notice)
        return false
      }, 'fim ghost', 25_000)
    } catch (error) {
      const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
      const fimReq = stub.requests.find((item) => item.kind === 'fim')
      if (fimReq?.completed && !fimReq.aborted) {
        throw new Error(`product: stub completed FIM but UI failed (${notice || (error instanceof Error ? error.message : String(error))})`)
      }
      throw new Error(`fim did not complete on stub kinds=${JSON.stringify(stub.requests.map((item) => item.kind))} notice=${notice} ${error instanceof Error ? error.message : String(error)}`)
    }
    const accept = page.getByRole('button', { name: '接受补全' })
    if (await accept.isVisible().catch(() => false)) await accept.click()
    await savePaper(page)
    const saved = await readChapter()
    if (!saved.includes(FIM_INSERT)) throw new Error('accepted FIM did not save inserted text')
    const request = stub.requests.findLast(item => item.kind === 'fim')
    if (request?.model !== FIM_MODEL_ID) throw new Error(`completion route was ${request?.model}`)
    await assertStubSelected(page, 'chat model unchanged after completion')
    await shot(page, 'fim', 'FIM 接受并保存')
    return 'ghost accepted and saved'
  })

  await cover('narrow-chat-layout', async () => {
    const layout = await page.locator('.chat').evaluate(el => ({width: el.clientWidth, scroll: el.scrollWidth, composer: el.querySelector('.composer')?.getBoundingClientRect().toJSON(), bounds: el.getBoundingClientRect().toJSON()}))
    if (layout.scroll > layout.width + 1) throw new Error(`chat overflows: ${JSON.stringify(layout)}`)
    if (!layout.composer || layout.composer.right > layout.bounds.right + 1) throw new Error('composer clipped')
    await shot(page, 'narrow-chat', '300 像素侧栏中的对话')
    return `sidebar ${layout.width}px, no horizontal overflow`
  })

  await cover('provider-error-visible-without-edit', async () => {
    await openChapter(page)
    const editor = page.getByTestId('paper-editor')
    await editor.evaluate(el => {
      const v = el.__cmView
      const end = v.state.doc.length
      const insert = '\nUI_FIM_PROVIDER_ERROR'
      v.dispatch({changes: {from: end, insert}, selection: {anchor: end + insert.length}})
      v.focus()
    })
    const before = await editor.evaluate(el => el.__cmView.state.doc.toString())
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.getByTestId('editor-menu-complete').click()
    await waitFor(async () => (await page.getByTestId('paper-notice').innerText()).includes('UI_FIM_PROVIDER_ERROR'), 'provider failure surfaced', 25000)
    if ((await editor.evaluate(el => el.__cmView.state.doc.toString())) !== before) throw new Error('failed completion modified manuscript')
    if (await page.getByRole('button', {name: '接受补全', exact: true}).count()) throw new Error('failed completion exposed partial suggestion')
    await savePaper(page)
    return 'runtime terminal error shown without inserting text'
  })

  await cover('long-chat-readable-without-truncation', async () => {
    await waitUntilIdle(page)
    const assistant = await ensureAssistantOpen(page)
    await page.getByRole('textbox', {name: '输入消息', exact: true}).fill(MARK.readLong)
    await page.getByRole('textbox', {name: '输入消息', exact: true}).press('Enter')
    const response = page.locator('.chat-row.assistant').last()
    await waitFor(async () => (await response.innerText()).includes('先给出一个变化'), 'full reading reply arrives', 25000)
    await waitUntilIdle(page)
    const rendered = await response.innerText()
    if (!rendered.includes('这一段最有力的地方') || !rendered.includes('再继续补充人物的往事。')) throw new Error('reading reply truncated')
    const typography = await response.locator('p').first().evaluate(el => ({fontSize: parseFloat(getComputedStyle(el).fontSize), lineHeight: parseFloat(getComputedStyle(el).lineHeight)}))
    if (typography.fontSize < 14 || typography.lineHeight < typography.fontSize * 1.65) throw new Error('long reply still uses cramped typography: ' + JSON.stringify(typography))
    await page.setViewportSize({width: 1280, height: 720})
    await delay(350)
    const overflow = await assistant.evaluate(el => ({client: el.clientWidth, scroll: el.scrollWidth}))
    if (overflow.scroll > overflow.client + 1) throw new Error('long reply overflows narrow sidebar: ' + JSON.stringify(overflow))
    await shot(page, 'long-chat-reading', '正常中文长回复与窄窗口阅读')
    await page.setViewportSize({width: 1440, height: 900})
    return 'full Chinese reply, 14px or larger type, comfortable line spacing, no sidebar horizontal overflow'
  })

  await cover('default-chat-only-affects-new-conversations', async () => {
    const {dialog} = await openModelsSettings(page)
    await chooseCustomSelect(dialog, '默认对话模型', text => text.includes(REWRITE_MODEL_ID))
    await waitFor(async () => !(await dialog.getByRole('combobox', {name: '默认对话模型', exact: true}).isDisabled()), 'default saved', 10000)
    await closeShellSettings(page)
    await assertStubSelected(page, 'existing chat retains selected model')
    const assistant = await ensureAssistantOpen(page)
    await assistant.getByRole('button', {name: '新对话', exact: true}).click()
    const picker = page.getByRole('dialog', {name: '新对话', exact: true})
    await picker.waitFor()
    await picker.getByRole('combobox', {name: '选择模型', exact: true}).filter({hasText: REWRITE_MODEL_ID}).waitFor()
    await chooseCustomSelect(picker, '选择模型', text => text.includes(FIM_MODEL_ID))
    await picker.getByRole('combobox', {name: '选择模型', exact: true}).filter({hasText: FIM_MODEL_ID}).waitFor({timeout: 5000})
    await delay(250)
    if (!(await picker.getByRole('combobox', {name: '选择模型', exact: true}).innerText()).includes(FIM_MODEL_ID)) throw new Error('new-conversation picker reset manual selection before submit')
    await picker.getByRole('button', {name: '开始', exact: true}).click()
    await picker.waitFor({state: 'hidden'})
    const priorPings = stub.requests.filter(item => item.kind === 'ping').length
    await waitUntilIdle(page)
    await page.getByRole('textbox', {name: '输入消息', exact: true}).fill(MARK.ping)
    await page.getByRole('textbox', {name: '输入消息', exact: true}).press('Enter')
    await waitFor(async () => stub.requests.filter(item => item.kind === 'ping').length > priorPings, 'first request from new conversation', 20000)
    const firstRequest = stub.requests.filter(item => item.kind === 'ping')[priorPings]
    if (firstRequest.model !== FIM_MODEL_ID) throw new Error(`explicit new-conversation choice lost on first actual request: ${firstRequest.model}`)
    await waitUntilIdle(page)
    await waitFor(async () => (await readActiveModel(page)).trigger.includes(FIM_MODEL_ID), 'new conversation honors explicit choice over default', 20000)
    await delay(500)
    if (!(await readActiveModel(page)).trigger.includes(FIM_MODEL_ID)) throw new Error('default model overwrote explicit new-conversation choice')
    return 'default preselection, existing chat untouched, explicit new-conversation choice retained'
  })

  await cover('no-external-model-calls', async () => {
    await assertNoExternalModelCalls()
    if (!stub.baseURL.startsWith('http://127.0.0.1:')) throw new Error(stub.baseURL)
    if (stub.requests.length < 1) throw new Error('stub received no requests')
    const uncancelled = stub.requests.filter((item) => item.kind !== 'hold' && /chat\/completions/.test(item.path))
    const falselyAborted = uncancelled.find((item) => item.aborted)
    if (falselyAborted) throw new Error(`uncancelled ${falselyAborted.kind} reported aborted`)
    const incomplete = uncancelled.find((item) => !item.completed)
    if (incomplete) throw new Error(`${incomplete.kind} SSE did not complete`)
    return `${stub.requests.length} local requests; base ${stub.baseURL}`
  })

  await shot(page, 'complete', '离线助手链结束')
  const video = page.video()
  await context.close()
  if (!video) {
    fail('recordVideo produced no page.video()')
  } else {
    const raw = await video.path()
    if (!raw || !(await exists(raw))) fail(`video file missing: ${raw || '(empty path)'}`)
    else report.video = String(raw).replace(`${root}${sep}`, '').replaceAll('\\', '/')
  }
}

if (process.argv.includes('--verify-ids')) {
  try {
    verifyResponseIds()
    console.log('response-id verification ok')
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exit(1)
  }
}

try {
  await main()
} catch (error) {
  fail(error instanceof Error ? error.stack || error.message : String(error))
  if (activePage) {
    await shot(activePage, 'failure').catch(() => undefined)
    await writeFile(resolve(output, 'failure.html'), await activePage.content().catch(() => ''), 'utf8').catch(() => undefined)
  }
} finally {
  if (browser) await browser.close().catch(() => undefined)
  await stopProcess(dshChild)
  if (stub) await stub.close().catch(() => undefined)
  await flushReport()
}

console.log(JSON.stringify({
  ok: report.ok,
  method: report.method,
  liveVendor: report.liveVendor,
  checks: report.checks,
  gaps: report.gaps,
  failures: report.failures,
  stub: { baseURL: report.stub.baseURL, requestCount: report.stub.requestCount, kinds: report.stub.kinds },
}, null, 2))
if (!report.ok) process.exitCode = 1
