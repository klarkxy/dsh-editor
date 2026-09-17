/**
 * Offline UI-assistant acceptance: local OpenAI/DeepSeek-compatible stub,
 * real DSH + shell + manuscript RPC/files. No paid vendor calls.
 *
 * Product files are created through the visible UI. The main chat path opens a
 * 小说创作 conversation from the new-conversation picker and drives
 * writing_propose V2 (marker/version 2). Edit/split carry targetVersion from a
 * Host file.read receipt of the target; merge would need targetVersion+sourceVersion;
 * each renames item needs version. Create is exclusive and must omit targetVersion.
 * Optional basis is other source path/version/label and must not substitute for
 * those generation baselines. Selecting a preset must not pre-seed directories.
 * One workspace opens four isolated conversations (通用写作 / 文章与自媒体 /
 * 技术文档 / 小说创作) and proves persona, each preset's own main workflow Skill,
 * session identity, and the live tool surface do not cross on the stub wire.
 * New 小说创作 exposes only novel_knowledge plus common writing_propose/
 * author_observe; legacy novel_* write/maintain tools stay on hidden dsh-editor,
 * which is not in this four-preset matrix. The novel conversation stays current
 * for the V2 flow. A separate legacy scenario enables developer mode through the
 * real settings dialog, creates a hidden dsh-editor session from the picker
 * (诊断用途 badge), proves the context.compile V3 send path and the init-guide
 * card, applies/stale-rejects V1 (unmarked, no targetVersion) proposals, and
 * restores the session after reload; developer mode is switched off again so
 * the picker-hides-legacy assertions below still run against the default.
 *
 * Fixtures: `.dev/ui-assistant-*`. Evidence: `e2e/out/ui-assistant`.
 * Method: synthetic local model, real host write. Not live vendor or AI quality.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const planningOnly = process.argv.includes('--planning-only')
const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const output = resolve(root, 'e2e', 'out', planningOnly ? 'planning-flow' : 'ui-assistant')
const home = resolve(devRoot, planningOnly ? 'planning-flow-home' : 'ui-assistant-home')
const projectsRoot = resolve(devRoot, planningOnly ? 'planning-flow-projects' : 'ui-assistant-projects')
const book = planningOnly ? 'planning-flow-workspace' : 'ui-assistant-workspace'
const workspace = resolve(projectsRoot, book)
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const PROVIDER_ID = 'local-stub'
const MODEL_ID = 'ui-assistant-stub'
const FIM_MODEL_ID = 'ui-completion-stub'
const REWRITE_MODEL_ID = 'ui-rewrite-stub'
const PLACEHOLDER_KEY = 'dsh-editor-e2e-placeholder-key'

const WRITING_PROPOSE = 'writing_propose'
const WRITING_MARKER = 'dsh-editor.proposal'
const WRITING_VERSION = 2
const CHAPTER_REL = '正文/001.md'
const PLAN_REL = '大纲/章纲.md'
const CREATE_REL = '大纲/总纲.md'
const BASIS_NOTE_REL = '正文/依据.md'
const NOVEL_DIR_NAMES = ['正文', '大纲', '人物卡', '世界书']
const PRESET_DIR_NAMES = [...NOVEL_DIR_NAMES, '选题', '资料', '主稿', '渠道稿', '需求', '决策', '文档', '验收']
const COMMON_SKILL = 'prose-revision'
const PRESET_OK_TEXT = 'UI_STUB_PRESET_OK'
const BASIS_LABEL = {
  [CHAPTER_REL]: '正文',
  [PLAN_REL]: '章纲',
  [CREATE_REL]: '总纲',
  [BASIS_NOTE_REL]: '依据',
}
const ORIGINAL_LINE = '雾比灯先到，把码头的广播塔切成一段一段的影子。'
const EDITED_LINE = '灯还没亮，雾已经把广播塔切成一段一段的影子。'
const REWRITE_NEEDLE = '她听见广播重复同一句话'
const REWRITE_REPLACEMENT = '广播只剩半句。'
const FIM_PREFIX = '林简推开门，发现窗边的人正握着录音带，她'
const FIM_INSERT = '握着旧票根，没有回头。'
const CHAPTER_TEXT = `# 第一章 试笔\n\n${ORIGINAL_LINE}\n\n${REWRITE_NEEDLE}，脚步缓缓地停在空荡荡的栈桥上。\n`
const CREATE_TEXT = '# 总纲\n\n本地桩生成的忽略用草稿，不应落盘。\n'
const PONG_TEXT = 'UI_STUB_PONG'
/* Legacy dsh-editor (写作助手) session: only reachable with developer mode on. */
const LEGACY_PROPOSE_TOOL = 'novel_propose'
const LEGACY_PONG_TEXT = 'UI_STUB_LEGACY_PONG'
const LEGACY_TITLE_TEXT = 'UI_STUB_TITLE_LEGACY'
const AFTER_LEGACY_EDIT_TEXT = 'UI_STUB_LEGACY_EDIT_DONE'
const LEGACY_EDIT_OLD = '第一章 试笔'
const LEGACY_EDIT_NEW = '第一章 旧版试笔'
const LEGACY_STALE_OLD = '脚步缓缓地停在空荡荡的栈桥上'
const LEGACY_STALE_NEW = '脚步停在空荡的栈桥上'
const LEGACY_AUTHOR_MUTATION = '作者改了正文，旧版提案应失效。'
const READING_TEXT = "这一段最有力的地方，是雾、广播和旧票根三个细节都指向一件尚未说出的往事。读者能感觉到有人在等她，却还不知道是谁。\n\n我建议先保留码头和广播塔，把“脚步缓缓地停在空荡荡的栈桥上”压短。它与前面的雾气都在延缓节奏，放在一起会让开场迟迟没有动作。\n\n可以让广播突然念出她的名字。她停在栈桥尽头，摸了摸口袋。那张票还在，边角已被汗浸软。对岸没有船，只有一盏忽明忽暗的灯。\n\n名字让危险靠近，摸票让人物作出反应，最后的灯把读者引向下一步。暂时不用解释票的来历，让她先决定要不要过去。\n\n如果希望保留原来的慢节奏，也可以让窗边的人抬起头。先给出一个变化，再继续补充人物的往事。"
const TITLE_TEXT = 'UI_STUB_TITLE'
const PRESET_TITLE = {
  'dsh-editor-writing': 'UI_STUB_TITLE_WRITING',
  'dsh-editor-article': 'UI_STUB_TITLE_ARTICLE',
  'dsh-editor-technical': 'UI_STUB_TITLE_TECHNICAL',
  'dsh-editor-novel': 'UI_STUB_TITLE_NOVEL',
}
const AFTER_EDIT_TEXT = 'UI_STUB_EDIT_DONE'
const AFTER_CREATE_TEXT = 'UI_STUB_CREATE_DONE'
const LATE_TEXT = 'UI_STUB_LATE'
const TITLE_USER_PREFIX = 'Generate the session title from this JSON array of human messages:'
const TITLE_SYSTEM_MARK = 'Create a concise title for an AI coding-assistant session from the supplied human messages.'
const MARK = {
  ping: 'UI_ASSISTANT_PING',
  readLong: '请分析这个开头的节奏，并给出修改建议。',
  edit: 'UI_ASSISTANT_EDIT',
  editMissingTarget: 'UI_ASSISTANT_EDIT_MISSING_TARGET',
  editStaleTarget: 'UI_ASSISTANT_EDIT_STALE_TARGET',
  writeBypass: 'UI_ASSISTANT_WRITE_BYPASS',
  unknownTool: 'UI_ASSISTANT_UNKNOWN_TOOL',
  create: 'UI_ASSISTANT_CREATE',
  hold: 'UI_ASSISTANT_HOLD',
  presetWriting: 'UI_PRESET_WRITING',
  presetArticle: 'UI_PRESET_ARTICLE',
  presetTechnical: 'UI_PRESET_TECHNICAL',
  presetNovel: 'UI_PRESET_NOVEL',
  legacyPing: 'UI_ASSISTANT_LEGACY_PING',
  legacyEdit: 'UI_ASSISTANT_LEGACY_EDIT',
  legacyEditStale: 'UI_ASSISTANT_LEGACY_EDIT_STALE',
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
  agentPreset: '',
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
let capturedSessionId = ''
let lastPresetTitle = TITLE_TEXT
const contextCompileCalls = []
const workbenchCalls = []

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

function recordGap(name, reason) {
  report.gaps.push({ name, reason })
  note('gap', `${name}: ${reason}`)
}

function skipDependents(reason) {
  for (const name of MANDATORY) {
    if (report.checks.some((item) => item.name === name)) continue
    recordCheck(name, false, `dependency-skipped-as-failure: ${reason}`)
  }
}

const MANDATORY = planningOnly ? ['configure-test-model', 'open-synthetic-work', 'planning-assistant', 'planning-create-directories', 'planning-outline-markdown', 'planning-stale-proposal', 'planning-glob', 'no-external-model-calls'] : [
  'configure-test-model',
  'open-synthetic-work',
  'legacy-session-create',
  'legacy-context-compile-v3',
  'legacy-v1-proposal-apply',
  'legacy-session-restore',
  'legacy-v1-stale-rejected',
  'legacy-developer-mode-off',
  'four-preset-runtime-isolation',
  'open-assistant',
  'ime-composing-enter',
  'ime-keycode-229',
  'enter-positive-control',
  'chat-visible-reply',
  'edit-preview-leaves-file',
  'edit-apply-writes',
  'edit-undo-restores',
  'v2-edit-missing-target-rejected',
  'stale-generation-target-rejected',
  'host-write-guard-blocks-direct-write',
  'host-write-guard-blocks-unknown-tool',
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

function isProjectContextEnvelope(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed = JSON.parse(trimmed)
    return parsed?.schema === 'dsh-editor.project-context' && parsed?.version === 3 && typeof parsed?.user_request === 'string'
  } catch {
    return false
  }
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

function isInjectedSystemReminder(text) {
  return /^\s*<system-reminder>/.test(String(text ?? ''))
}

function lastRealUserRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  let lastPlain = ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] ?? {}
    if (message.role !== 'user') continue
    const text = messageText(message)
    if (text.includes(TITLE_USER_PREFIX) || text.includes(TITLE_SYSTEM_MARK)) continue
    if (isRuntimeContextSnapshot(text) || isInjectedSystemReminder(text)) continue
    const fromEnvelope = envelopeUserRequest(text)
    if (fromEnvelope) return fromEnvelope
    if (!lastPlain) lastPlain = extractTaskUserRequest(text)
  }
  return lastPlain
}

function listedToolNames(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  return tools.map((item) => item?.function?.name || item?.name).filter(Boolean)
}

function personaText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  return messages
    .filter((item) => item?.role === 'developer' || item?.role === 'system')
    .map((item) => messageText(item))
    .join('\n')
}

function listedSkillNames(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const blob = messages.map((item) => messageText(item)).join('\n')
  const names = []
  for (const block of blob.matchAll(/<available_skills>([\s\S]*?)(?:<\/available_skills>|<\/system-reminder>|$)/g)) {
    for (const item of block[1].matchAll(/^\s*-\s*`([^`]+)`/gm)) names.push(item[1])
  }
  return [...new Set(names)]
}

function classify(body) {
  if (isTitlePrompt(body)) return 'title'
  const blob = flattenMessages(body)
  const tools = JSON.stringify(body?.tools ?? [])
  const last = lastNonAssistant(body)
  const userRequest = lastRealUserRequest(body)
  if (planningOnly && userRequest.startsWith('PLANNING_')) {
    const messages = body.messages ?? []
    let start = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && extractTaskUserRequest(messageText(messages[i])) === userRequest) { start = i; break }
    }
    const calls = messages.slice(start + 1).flatMap(message => message.tool_calls ?? []).map(call => call.function?.name)
    if (calls.includes(WRITING_PROPOSE) || calls.includes('glob')) return 'planning_done'
    if (calls.includes('novel_propose')) return 'legacy_propose_forbidden'
    if (userRequest === 'PLANNING_GLOB') return 'planning_glob'
    if (userRequest === 'PLANNING_OUTLINE') return 'planning_outline'
    if (userRequest === 'PLANNING_CARD') return 'planning_card'
    if (userRequest === 'PLANNING_WORLD') return 'planning_world'
    if (!calls.includes('read')) return userRequest === 'PLANNING_STALE' ? 'planning_stale_read' : 'planning_read'
    return userRequest === 'PLANNING_STALE' ? 'planning_stale' : 'planning_plan'
  }
  if (blob.includes('【待改写】')) return 'rewrite'
  if (blob.includes('【光标前】')) return 'fim'
  const isTool = last.role === 'tool' || last.role === 'toolResult' || /tool_call_id/.test(last.content)
  if (isTool && blob.includes(MARK.editMissingTarget)) return 'after_edit_missing_target'
  if (isTool && blob.includes(MARK.writeBypass)) return 'after_write_bypass'
  if (isTool && blob.includes(MARK.unknownTool)) return 'after_unknown_tool'
  if (isTool && blob.includes(MARK.legacyEdit)) return 'after_legacy_edit'
  if (isTool && blob.includes(MARK.edit)) return 'after_edit'
  if (isTool && blob.includes(MARK.create)) return 'after_create'
  if (isTool) return 'after_tool'
  if (userRequest.includes(MARK.hold) || last.content.includes(MARK.hold)) return 'hold'
  const hasWritingPropose = listedToolNames(body).includes(WRITING_PROPOSE) || tools.includes(WRITING_PROPOSE)
  if (userRequest.includes(MARK.editMissingTarget)) {
    if (!hasWritingPropose) return 'missing_writing_propose'
    return 'propose_edit_missing_target'
  }
  if (userRequest.includes(MARK.editStaleTarget)) {
    if (!hasWritingPropose) return 'missing_writing_propose'
    return 'propose_edit_stale_target'
  }
  if (userRequest.includes(MARK.writeBypass)) return 'write_bypass'
  if (userRequest.includes(MARK.unknownTool)) return 'unknown_tool'
  if (userRequest.includes(MARK.legacyEditStale)) return 'legacy_propose_edit_stale'
  if (userRequest.includes(MARK.legacyEdit)) return 'legacy_propose_edit'
  if (userRequest.includes(MARK.legacyPing)) return 'legacy_ping'
  if (userRequest.includes(MARK.edit) || userRequest.includes(MARK.create)) {
    if (!hasWritingPropose) return 'missing_writing_propose'
    return userRequest.includes(MARK.edit) ? 'propose_edit' : 'propose_create'
  }
  if (userRequest.includes(MARK.ping)) return 'ping'
  if (userRequest.includes(MARK.readLong)) return 'read_long'
  if (
    userRequest.includes(MARK.presetWriting)
    || userRequest.includes(MARK.presetArticle)
    || userRequest.includes(MARK.presetTechnical)
    || userRequest.includes(MARK.presetNovel)
  ) return 'preset_probe'
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
    skills: listedSkillNames(body),
    persona: clipWire(personaText(body), 240),
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
    tools: [{ type: 'function', function: { name: WRITING_PROPOSE } }],
  }
  const editEnvelope = JSON.stringify({
    schema: 'dsh-editor.project-context',
    version: 3,
    user_request: MARK.edit,
    active_path: CHAPTER_REL,
  })
  const v2EditBody = {
    messages: [{ role: 'user', content: editEnvelope }],
    tools: [{ type: 'function', function: { name: WRITING_PROPOSE } }],
  }
  const legacyEditBody = {
    messages: [{ role: 'user', content: editEnvelope }],
    tools: [{ type: 'function', function: { name: 'novel_propose' } }],
  }
  const reminder = '<system-reminder>\nAvailable skills: grill-your-novel.\n</system-reminder>'
  const runtimeSnapshot = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: workspace-write.'
  const pingWithInjected = {
    messages: [
      { role: 'user', content: MARK.ping },
      { role: 'user', content: runtimeSnapshot },
      { role: 'user', content: `  ${reminder}` },
    ],
  }
  const v2EditWithReminder = {
    messages: [
      { role: 'user', content: editEnvelope },
      { role: 'user', content: reminder },
    ],
    tools: [{ type: 'function', function: { name: WRITING_PROPOSE } }],
  }
  const titleWithReminder = {
    messages: [
      { role: 'system', content: `${TITLE_SYSTEM_MARK}\nReturn only the title on one line.` },
      { role: 'user', content: `${TITLE_USER_PREFIX}\n${JSON.stringify([{ seq: 1, text: envelope }, { seq: 2, text: reminder }])}` },
      { role: 'user', content: reminder },
    ],
  }
  const authorMentionsReminder = {
    messages: [{ role: 'user', content: `${MARK.edit}\n作者正文里提到 <system-reminder> 不应被跳过` }],
    tools: [{ type: 'function', function: { name: WRITING_PROPOSE } }],
  }
  const titleKind = classify(titleBody)
  const agentKind = classify(agentBody)
  const v2EditKind = classify(v2EditBody)
  const legacyEditKind = classify(legacyEditBody)
  const pingInjectedKind = classify(pingWithInjected)
  const v2EditReminderKind = classify(v2EditWithReminder)
  const titleReminderKind = classify(titleWithReminder)
  const authorMentionKind = classify(authorMentionsReminder)
  if (titleKind !== 'title') throw new Error(`title wire classified as ${titleKind}`)
  if (agentKind !== 'ping') throw new Error(`agent envelope classified as ${agentKind}`)
  if (v2EditKind !== 'propose_edit') throw new Error(`writing_propose edit classified as ${v2EditKind}`)
  if (legacyEditKind !== 'missing_writing_propose') {
    throw new Error(`legacy novel_propose still classified as ${legacyEditKind}`)
  }
  if (pingInjectedKind !== 'ping') throw new Error(`raw ping + runtime + system-reminder classified as ${pingInjectedKind}`)
  if (v2EditReminderKind !== 'propose_edit') throw new Error(`V2 edit + system-reminder classified as ${v2EditReminderKind}`)
  if (titleReminderKind !== 'title') throw new Error(`title prompt + system-reminder classified as ${titleReminderKind}`)
  if (authorMentionKind !== 'propose_edit') {
    throw new Error(`author text mentioning system-reminder classified as ${authorMentionKind}`)
  }
  if (classify({ messages: [{ role: 'user', content: MARK.presetWriting }] }) !== 'preset_probe') {
    throw new Error('preset probe classified incorrectly')
  }
  const legacyEnvelope = (marker) => JSON.stringify({ schema: 'dsh-editor.project-context', version: 3, user_request: marker, active_path: CHAPTER_REL })
  if (classify({ messages: [{ role: 'user', content: legacyEnvelope(MARK.legacyPing) }] }) !== 'legacy_ping') {
    throw new Error('legacy envelope ping classified incorrectly')
  }
  if (classify({ messages: [{ role: 'user', content: legacyEnvelope(MARK.legacyEdit) }] }) !== 'legacy_propose_edit') {
    throw new Error('legacy envelope edit classified incorrectly')
  }
  if (classify({ messages: [{ role: 'user', content: legacyEnvelope(MARK.legacyEditStale) }] }) !== 'legacy_propose_edit_stale') {
    throw new Error('legacy stale edit classified as its non-stale marker')
  }
  if (classify({ messages: [{ role: 'tool', content: `tool_call_id call_ui_legacy_edit_1 ${MARK.legacyEdit}` }] }) !== 'after_legacy_edit') {
    throw new Error('legacy tool follow-up classified incorrectly')
  }
  if (!isProjectContextEnvelope(legacyEnvelope(MARK.legacyPing)) || isProjectContextEnvelope(MARK.legacyPing)) {
    throw new Error('project-context envelope detection broken')
  }
  const v2Tools = { tools: [{ type: 'function', function: { name: WRITING_PROPOSE } }] }
  if (classify({ messages: [{ role: 'user', content: MARK.editMissingTarget }], ...v2Tools }) !== 'propose_edit_missing_target') {
    throw new Error('missing-target edit classified incorrectly')
  }
  if (classify({ messages: [{ role: 'user', content: MARK.editStaleTarget }], ...v2Tools }) !== 'propose_edit_stale_target') {
    throw new Error('stale-target edit classified incorrectly')
  }
  if (classify({ messages: [{ role: 'user', content: MARK.writeBypass }] }) !== 'write_bypass') {
    throw new Error('write bypass classified incorrectly')
  }
  if (classify({ messages: [{ role: 'user', content: MARK.unknownTool }] }) !== 'unknown_tool') {
    throw new Error('unknown tool classified incorrectly')
  }
  if (planningOnly) {
    const planningCreate = classify({ messages: [{ role: 'user', content: 'PLANNING_OUTLINE' }] })
    const planningRead = classify({ messages: [{ role: 'user', content: 'PLANNING_PLAN' }] })
    const planningLegacy = classify({
      messages: [
        { role: 'user', content: 'PLANNING_OUTLINE' },
        { role: 'assistant', tool_calls: [{ function: { name: 'novel_propose' } }] },
      ],
    })
    const planningV2 = classify({
      messages: [
        { role: 'user', content: 'PLANNING_OUTLINE' },
        { role: 'assistant', tool_calls: [{ function: { name: WRITING_PROPOSE } }] },
      ],
    })
    if (planningCreate !== 'planning_outline') throw new Error(`planning outline classified as ${planningCreate}`)
    if (planningRead !== 'planning_read') throw new Error(`planning plan classified as ${planningRead}`)
    if (planningLegacy !== 'legacy_propose_forbidden') throw new Error(`planning novel_propose classified as ${planningLegacy}`)
    if (planningV2 !== 'planning_done') throw new Error(`planning writing_propose classified as ${planningV2}`)
  }
}

function verifyResponseIds() {
  verifyClassify()
  const samples = [
    ['text-a', textChunks(MODEL_ID, PONG_TEXT)],
    ['text-b', textChunks(MODEL_ID, 'UI_STUB_OK')],
    // id-stability samples only; apply fixtures below attach real Host target baselines.
    ['tool-a', toolChunks(MODEL_ID, WRITING_PROPOSE, { marker: WRITING_MARKER, version: WRITING_VERSION, kind: 'edit' }, 'call_ui_edit_1')],
    ['tool-b', toolChunks(MODEL_ID, WRITING_PROPOSE, { marker: WRITING_MARKER, version: WRITING_VERSION, kind: 'create' }, 'call_ui_create_1')],
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

function writingProposePayload(partial, basis) {
  return {
    marker: WRITING_MARKER,
    version: WRITING_VERSION,
    ...partial,
    ...(basis?.length ? { basis } : {}),
  }
}

function lastWritingProposal() {
  return [...(stub?.requests ?? [])].reverse().find((item) => item.proposal)?.proposal
}

function titleForBody(body) {
  const blob = flattenMessages(body)
  if (blob.includes(MARK.legacyPing) || blob.includes(MARK.legacyEdit)) return LEGACY_TITLE_TEXT
  if (blob.includes(MARK.presetWriting)) return PRESET_TITLE['dsh-editor-writing']
  if (blob.includes(MARK.presetArticle)) return PRESET_TITLE['dsh-editor-article']
  if (blob.includes(MARK.presetTechnical)) return PRESET_TITLE['dsh-editor-technical']
  if (blob.includes(MARK.presetNovel)) return PRESET_TITLE['dsh-editor-novel']
  return TITLE_TEXT
}

function captureManuscriptSession(request) {
  if (request.method() !== 'POST') return
  try {
    const id = request.postDataJSON()?.payload?.sessionId
    if (typeof id === 'string' && id.trim()) capturedSessionId = id.trim()
  } catch { /* ignore non-JSON posts */ }
}

async function manuscriptFileRead(page, path) {
  if (!page) throw new Error(`no page available before reading ${path}`)
  if (!capturedSessionId) throw new Error(`no manuscript session captured before reading ${path}`)
  const response = await page.request.post(new URL('/manuscript/file.read', page.url()).href, {
    data: {
      type: 'client-request',
      rpcId: `ui-assistant-${Date.now().toString(36)}`,
      method: 'file.read',
      payload: { sessionId: capturedSessionId, path },
    },
  })
  if (!response.ok()) throw new Error(`file.read ${path}: HTTP ${response.status()}`)
  const result = (await response.json()).result
  if (!result?.ok) throw new Error(`file.read ${path}: ${JSON.stringify(result)}`)
  const version = result.value?.version
  if (typeof version !== 'string' || !version.trim()) throw new Error(`file.read ${path}: missing version`)
  return { path, version: version.trim() }
}

async function liveBasis(paths) {
  const basis = []
  for (const path of paths) {
    const row = await manuscriptFileRead(activePage, path)
    const label = BASIS_LABEL[path]
    basis.push(label ? { ...row, label } : row)
  }
  return basis
}

async function liveTargetVersion(path) {
  return (await manuscriptFileRead(activePage, path)).version
}

async function writingEditPayload(partial, basisPaths) {
  const targetVersion = await liveTargetVersion(partial.path)
  return writingProposePayload({
    ...partial,
    targetVersion,
  }, await liveBasis(basisPaths))
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
          record.personaText = personaText(body)
          record.skills = listedSkillNames(body)
          record.toolNames = listedToolNames(body)
          record.contextEnvelope = (body.messages ?? []).some((message) => message?.role === 'user' && isProjectContextEnvelope(messageText(message)))
          if (kind === 'missing_writing_propose' || kind === 'legacy_propose_forbidden') {
            await respondSse(req, res, flags, record, model, textChunks(model, kind === 'legacy_propose_forbidden' ? 'UI_STUB_LEGACY_PROPOSE_FORBIDDEN' : 'UI_STUB_MISSING_WRITING_PROPOSE'))
            return
          }
          if (kind.startsWith('planning_')) {
            const action = kind === 'planning_read' ? ['read', { file_path: CHAPTER_REL }]
              : kind === 'planning_stale_read' ? ['read', { file_path: PLAN_REL }]
              : kind === 'planning_glob' ? ['glob', { pattern: '**/*.{md,txt}' }]
              : kind === 'planning_outline' ? [WRITING_PROPOSE, writingProposePayload({
                kind: 'create', path: '大纲/第一卷/卷纲.md', summary: '采用第一卷大纲', text: '# 第一卷\n\n少年下山，在城市寻找师叔。\n',
              }, await liveBasis([CHAPTER_REL]))]
              : kind === 'planning_card' ? [WRITING_PROPOSE, writingProposePayload({
                kind: 'create', path: '人物卡/少年.md', summary: '整理少年人物卡', text: '# 少年\n\n修为真实，初到城市。\n',
              }, await liveBasis([CHAPTER_REL]))]
              : kind === 'planning_world' ? [WRITING_PROPOSE, writingProposePayload({
                kind: 'create', path: '世界书/山门.md', summary: '整理已确认山门设定', text: '# 山门\n\n山门外是现代都市。\n',
              }, await liveBasis([CHAPTER_REL]))]
              : kind === 'planning_plan' ? [WRITING_PROPOSE, writingProposePayload({
                kind: 'create', path: PLAN_REL, summary: '本章章纲写入大纲 Markdown', text: '# 第一章章纲\n\n- 少年出山\n- 铜钱换不了面钱\n- 读信寻找师叔\n',
              }, await liveBasis([CHAPTER_REL]))]
              : kind === 'planning_stale' ? [WRITING_PROPOSE, await writingEditPayload({
                kind: 'edit', path: PLAN_REL, summary: '补充章纲节拍', oldText: '读信寻找师叔', newText: '读信寻找师叔，随后码头夜谈',
              }, [CHAPTER_REL])]
              : null
            if (kind === 'planning_done') {
              record.toolReplies = (body.messages ?? []).filter(message => message.role === 'tool').slice(-2).map(messageText)
            }
            if (action?.[0] === WRITING_PROPOSE) record.proposal = { tool: WRITING_PROPOSE, ...action[1] }
            await respondSse(req, res, flags, record, model, action ? toolChunks(model, action[0], action[1], `call_${randomUUID().replaceAll('-', '')}`) : textChunks(model, '规划操作完成，请作者核对采用。'))
            return
          }
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
          if (kind === 'legacy_propose_edit' || kind === 'legacy_propose_edit_stale') {
            const stale = kind === 'legacy_propose_edit_stale'
            /* Unmarked V1 args: the kernel adds marker/version 1; no targetVersion exists on this path. */
            const args = {
              kind: 'edit',
              path: CHAPTER_REL,
              summary: stale ? '旧版 V1 过期探测' : '旧版 V1 改题',
              oldText: stale ? LEGACY_STALE_OLD : LEGACY_EDIT_OLD,
              newText: stale ? LEGACY_STALE_NEW : LEGACY_EDIT_NEW,
            }
            record.proposal = { tool: LEGACY_PROPOSE_TOOL, ...args }
            await respondSse(req, res, flags, record, model, toolChunks(model, LEGACY_PROPOSE_TOOL, args, stale ? 'call_ui_legacy_stale_1' : 'call_ui_legacy_edit_1'))
            return
          }
          if (kind === 'propose_edit') {
            const args = await writingEditPayload({
              kind: 'edit',
              path: CHAPTER_REL,
              summary: '替换试笔段',
              oldText: ORIGINAL_LINE,
              newText: EDITED_LINE,
            }, [CHAPTER_REL])
            record.proposal = { tool: WRITING_PROPOSE, ...args }
            await respondSse(req, res, flags, record, model, toolChunks(model, WRITING_PROPOSE, args, 'call_ui_edit_1'))
            return
          }
          if (kind === 'propose_edit_missing_target') {
            const args = writingProposePayload({
              kind: 'edit',
              path: CHAPTER_REL,
              summary: '缺少生成基线',
              oldText: ORIGINAL_LINE,
              newText: EDITED_LINE,
            }, await liveBasis([CHAPTER_REL]))
            record.proposal = { tool: WRITING_PROPOSE, ...args }
            await respondSse(req, res, flags, record, model, toolChunks(model, WRITING_PROPOSE, args, 'call_ui_edit_missing_1'))
            return
          }
          if (kind === 'propose_edit_stale_target') {
            const args = await writingEditPayload({
              kind: 'edit',
              path: CHAPTER_REL,
              summary: '过期生成基线探测',
              oldText: ORIGINAL_LINE,
              newText: EDITED_LINE,
            }, [BASIS_NOTE_REL])
            record.proposal = { tool: WRITING_PROPOSE, ...args }
            await respondSse(req, res, flags, record, model, toolChunks(model, WRITING_PROPOSE, args, 'call_ui_edit_stale_1'))
            return
          }
          if (kind === 'write_bypass') {
            await respondSse(req, res, flags, record, model, toolChunks(model, 'write', {
              path: CHAPTER_REL,
              file_path: CHAPTER_REL,
              contents: 'HOST_GUARD_SHOULD_BLOCK\n',
              content: 'HOST_GUARD_SHOULD_BLOCK\n',
            }, 'call_ui_write_1'))
            return
          }
          if (kind === 'unknown_tool') {
            await respondSse(req, res, flags, record, model, toolChunks(model, 'unknown_tool', {
              path: CHAPTER_REL,
              text: 'HOST_GUARD_SHOULD_BLOCK\n',
            }, 'call_ui_unknown_1'))
            return
          }
          if (kind === 'preset_probe') lastPresetTitle = titleForBody(body)
          if (kind === 'propose_create') {
            const args = writingProposePayload({
              kind: 'create',
              path: CREATE_REL,
              summary: '创建总纲草稿',
              text: CREATE_TEXT,
            }, await liveBasis([CHAPTER_REL]))
            record.proposal = { tool: WRITING_PROPOSE, ...args }
            await respondSse(req, res, flags, record, model, toolChunks(model, WRITING_PROPOSE, args, 'call_ui_create_1'))
            return
          }
          const reply = kind === 'after_edit' ? AFTER_EDIT_TEXT
            : kind === 'after_create' ? AFTER_CREATE_TEXT
              : kind === 'after_legacy_edit' ? AFTER_LEGACY_EDIT_TEXT
                : kind === 'legacy_ping' ? LEGACY_PONG_TEXT
                  : kind === 'read_long' ? READING_TEXT
              : kind === 'ping' ? PONG_TEXT
                : kind === 'preset_probe' ? PRESET_OK_TEXT
                  : kind === 'title' ? (titleForBody(body) === TITLE_TEXT ? lastPresetTitle : titleForBody(body))
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

async function listNovelDirs(page) {
  const found = []
  for (const name of NOVEL_DIR_NAMES) {
    if (await exists(resolve(workspace, name))) found.push(`${name}:disk`)
    if (page && await page.locator('.tree').getByText(name, { exact: true }).count()) found.push(`${name}:tree`)
  }
  return found
}

async function unexpectedNovelDirs(page, allowed = []) {
  return (await listNovelDirs(page)).filter((item) => !allowed.some((name) => item.startsWith(`${name}:`)))
}

async function listPresetDirs(page) {
  const found = []
  for (const name of PRESET_DIR_NAMES) {
    if (await exists(resolve(workspace, name))) found.push(`${name}:disk`)
    if (page && await page.locator('.tree').getByText(name, { exact: true }).count()) found.push(`${name}:tree`)
  }
  return found
}

async function unexpectedPresetDirs(page, allowed = []) {
  return (await listPresetDirs(page)).filter((item) => !allowed.some((name) => item.startsWith(`${name}:`)))
}

async function createProjectFromHome(page) {
  await dismissNativeOnboarding(page)
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建作品' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('作品名称').fill(book)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('tree', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await page.locator('.tree-empty').waitFor({ state: 'visible', timeout: 20_000 })
  const extra = await unexpectedNovelDirs(page)
  if (extra.length) throw new Error(`new project should not pre-seed ${extra.join(', ')}`)
}

async function createFolder(page, name) {
  if (await exists(resolve(workspace, name)) || await page.locator('.tree-row', { hasText: name }).first().isVisible().catch(() => false)) {
    await page.locator('.tree-row', { hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
    return
  }
  const tree = page.locator('.tree')
  const box = await tree.boundingBox()
  if (!box) throw new Error('tree missing')
  await tree.click({ button: 'right', position: { x: 16, y: Math.max(12, box.height - 18) } })
  await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '新建文件夹' }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件夹' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件夹名称').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('.tree-row', { hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function createFileIn(page, directory, name) {
  const row = page.locator('.tree-row').filter({ hasText: directory }).first()
  await row.waitFor({ state: 'visible', timeout: 15_000 })
  await row.hover()
  await page.getByRole('button', { name: `在 ${directory} 中新建文件`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件名称（无扩展名时按 .md 创建）').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('[data-testid="paper-path"]', { hasText: `${directory}/${name}.md` }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function typeIntoPaper(page, text) {
  const content = page.locator('[data-testid="paper-editor"] .cm-content')
  await content.waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  await content.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(text)
  await savePaper(page)
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function seedWorkspaceThroughUi(page) {
  const extraBefore = await unexpectedNovelDirs(page)
  if (extraBefore.length) throw new Error(`workspace was not empty before UI seed: ${extraBefore.join(', ')}`)
  await createFolder(page, '正文')
  await createFileIn(page, '正文', '001')
  await typeIntoPaper(page, CHAPTER_TEXT)
  const extraAfter = await unexpectedNovelDirs(page, ['正文'])
  if (extraAfter.length) throw new Error(`UI seed created extra directories: ${extraAfter.join(', ')}`)
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
    const initIgnore = page.getByRole('article', { name: '作品初始化' }).getByRole('button', { name: '忽略' })
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

async function openEmptyProject(page) {
  await createProjectFromHome(page)
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
  /* 重载后水合未完成时第一次点击可能丢失；两个入口轮询重试直到面板出现。 */
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  const toggle = page.getByRole('button', { name: '搭档', exact: true })
  await waitFor(async () => {
    if (await assistant.isVisible().catch(() => false)) return true
    if (await launcher.isVisible().catch(() => false)) await launcher.click().catch(() => undefined)
    else if (await toggle.isVisible().catch(() => false) && await toggle.isEnabled().catch(() => false)) await toggle.click().catch(() => undefined)
    await delay(600)
    return false
  }, 'assistant panel opens', 45_000)
  await assistant.waitFor({ state: 'visible', timeout: 30_000 })
  return page.getByRole('complementary', { name: '写作助手' })
}

async function confirmConversationPreset(page, radioName, presetId) {
  const picker = page.getByRole('dialog', { name: '选择对话模式' })
  await picker.waitFor({ state: 'visible', timeout: 15_000 })
  const labels = await picker.getByRole('radio').allTextContents()
  if (labels.some((label) => /旧采访|写作助手|dsh-editor(?!-)/i.test(label))) {
    throw new Error(`hidden legacy preset is visible: ${JSON.stringify(labels)}`)
  }
  const choice = picker.getByRole('radio', { name: radioName })
  await choice.waitFor({ state: 'visible', timeout: 15_000 })
  if (await choice.isDisabled()) throw new Error(`${presetId} preset is unavailable`)
  await choice.click()
  const confirm = picker.getByRole('button', { name: '开始对话' })
  await waitFor(async () => confirm.isEnabled(), `${presetId} confirm enabled`, 10_000)
  await confirm.click()
  await picker.waitFor({ state: 'hidden', timeout: 20_000 })
  report.agentPreset = presetId
}

async function confirmNovelPreset(page) {
  return confirmConversationPreset(page, /小说创作/, 'dsh-editor-novel')
}

async function startPresetConversation(page, radioName, presetId) {
  const assistant = await ensureAssistantOpen(page)
  const neu = assistant.getByRole('button', { name: '新对话' })
  await waitFor(async () => neu.isEnabled().catch(() => false), `${presetId}: new conversation enabled`, 20_000)
  await neu.click()
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  await confirmConversationPreset(page, radioName, presetId)
  await assistant.waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('textbox', { name: '输入消息' }).waitFor({ state: 'visible', timeout: 15_000 })
  const mode = assistant.locator('.composer-mode')
  await waitFor(async () => (await mode.getAttribute('data-chat-mode')) === presetId, `${presetId}: current mode visible`, 15_000)
  return assistant
}

async function startNovelConversation(page) {
  return startPresetConversation(page, /小说创作/, 'dsh-editor-novel')
}

async function switchConversationByTitle(page, title) {
  const assistant = await ensureAssistantOpen(page)
  const trigger = assistant.getByRole('combobox', { name: '切换对话' })
  const current = (await trigger.innerText()).replace(/\s+/g, ' ').trim()
  if (current.includes(title)) return
  await trigger.click()
  const list = page.getByRole('listbox', { name: '切换对话' })
  await list.waitFor({ state: 'visible', timeout: 10_000 })
  await list.getByRole('option', { name: title, exact: true }).click()
  await waitFor(async () => {
    const text = (await trigger.innerText()).replace(/\s+/g, ' ').trim()
    return text.includes(title)
  }, `switch to ${title}`, 15_000)
}

function lastSelectedSessionId() {
  for (const item of [...(report.modelSelections ?? [])].reverse()) {
    const payload = item?.payload
    const id = payload?.sessionId || payload?.args?.request?.sessionId || payload?.request?.sessionId
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return ''
}

async function readActiveSessionId(page) {
  const root = page.locator('aside.chat .conversation-select').first()
  await root.waitFor({ state: 'visible', timeout: 10_000 })
  /* 会话切换 Select 的当前值在隐藏的原生 select 代理上，trigger 没有 data-value。 */
  const fromUi = await root.evaluate((node) => {
    const proxy = node.querySelector('select')
    if (proxy instanceof HTMLSelectElement && proxy.value) return proxy.value.replace(/^v:/, '').trim()
    const trigger = node.querySelector('[role="combobox"]')
    const raw = String(trigger?.getAttribute('data-value') || trigger?.getAttribute('value') || '')
    return raw.replace(/^v:/, '').trim()
  }).catch(() => '')
  if (fromUi) return fromUi
  return lastSelectedSessionId()
}

/* 开发者模式走真实设置弹窗（通用设置 → 开发者模式开关，role="switch"），持久化在 settings.yaml 的 ui-developer 命名空间。 */
async function setDeveloperMode(page, enabled) {
  await openShellSettings(page)
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('tab', { name: '通用设置', exact: true }).click()
  /* 开关在 settings scope ready 前点击是静默无效操作；种子里的浅色外观偏好
     只在 scope ready 后才会激活，用它当作就绪信号。 */
  const appearance = dialog.getByRole('group', { name: '外观' })
  await waitFor(async () => (await appearance.getByRole('button', { name: '浅色', exact: true }).getAttribute('aria-pressed')) === 'true', 'settings scopes ready', 20_000)
  const reveal = dialog.getByRole('button', { name: '显示开发者选项', exact: true })
  if (await reveal.isVisible().catch(() => false)) await reveal.click()
  const target = dialog.getByRole('switch', { name: '开发者模式' })
  await target.waitFor({ state: 'visible', timeout: 15_000 })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if ((await target.getAttribute('aria-checked')) === String(enabled)) break
    await target.click().catch(() => undefined)
    await delay(700)
  }
  if ((await target.getAttribute('aria-checked')) !== String(enabled)) throw new Error(`developer mode ${enabled ? 'on' : 'off'} did not stick`)
  await closeShellSettings(page)
  await waitFor(async () => {
    const yaml = await readFile(resolve(home, 'settings.yaml'), 'utf8').catch(() => '')
    const block = /ui-developer:\n((?:\s.*\n?)*)/.exec(yaml)?.[1] ?? ''
    const value = /developerMode:\s*(true|false)/.exec(block)?.[1]
    return value ? value === String(enabled) : !enabled
  }, `settings.yaml ui-developer developerMode=${enabled}`, 15_000)
}

/* 与 confirmConversationPreset 相对：开发者模式下旧版 preset 必须带徽标可见可选。 */async function confirmLegacyConversationPreset(page) {
  const picker = page.getByRole('dialog', { name: '选择对话模式' })
  await picker.waitFor({ state: 'visible', timeout: 15_000 })
  const choice = picker.getByRole('radio', { name: /写作助手/ })
  await choice.waitFor({ state: 'visible', timeout: 15_000 })
  const label = (await choice.getAttribute('aria-label')) || ''
  if (!label.includes('诊断用途')) throw new Error(`legacy preset lost its diagnostic badge: ${label}`)
  if (await choice.isDisabled()) throw new Error('dsh-editor preset is unavailable')
  await choice.click()
  const confirm = picker.getByRole('button', { name: '开始对话' })
  await waitFor(async () => confirm.isEnabled(), 'dsh-editor confirm enabled', 10_000)
  await confirm.click()
  await picker.waitFor({ state: 'hidden', timeout: 20_000 })
}

async function startLegacyConversation(page) {
  const assistant = await ensureAssistantOpen(page)
  const neu = assistant.getByRole('button', { name: '新对话' })
  await waitFor(async () => neu.isEnabled().catch(() => false), 'dsh-editor: new conversation enabled', 20_000)
  await neu.click()
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  await confirmLegacyConversationPreset(page)
  await assistant.waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('textbox', { name: '输入消息' }).waitFor({ state: 'visible', timeout: 15_000 })
  return assistant
}

/* 本地自动标题与宿主生成标题是竞态；恢复步骤需要一个确定的标题，走真实重命名 UI 钉死它。 */
async function renameCurrentConversation(page, title) {
  const assistant = await ensureAssistantOpen(page)
  await assistant.getByRole('button', { name: '对话操作' }).click()
  await page.getByRole('menuitem', { name: '重命名对话' }).click()
  const dialog = page.getByRole('dialog', { name: '重命名对话' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('对话名称').fill(title)
  await dialog.getByRole('button', { name: '保存名称' }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
  await waitFor(async () => {
    const text = (await assistant.getByRole('combobox', { name: '切换对话' }).innerText()).replace(/\s+/g, ' ').trim()
    return text.includes(title)
  }, `rename to ${title}`, 15_000)
}

async function exportedToolName(file, exportName) {
  const text = await readFile(file, 'utf8')
  const match = new RegExp(`(?:export )?const ${exportName} = '([a-z0-9_]+)'`).exec(text)
  if (!match) throw new Error(`missing ${exportName} in ${file}`)
  return match[1]
}

async function novelKnowledgeNameFromSource() {
  return exportedToolName(
    resolve(root, 'packages/dsh-editor-novel-kernel/src/contracts.ts'),
    'NOVEL_KNOWLEDGE_TOOL_NAME',
  )
}

async function legacyNovelToolNamesFromSource(knowledgeName) {
  const text = await readFile(resolve(root, 'packages/dsh-editor-workbench/src/host-guard.ts'), 'utf8')
  const block = /const LEGACY_NOVEL_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(text)
  if (!block) throw new Error('could not derive legacy novel tools from host-guard')
  const names = [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((item) => item[1])
    .filter((name) => name.startsWith('novel_') && name !== knowledgeName)
  if (!names.length) throw new Error('legacy novel tool list was empty')
  return [...new Set(names)].sort()
}

async function skillNamesForPreset(presetId) {
  /* 三个第一方 preset 已迁入插件包；物化模板是唯一完整 roster 源。 */
  const dir = resolve(template, 'agent-presets', presetId, 'skills')
  const names = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const text = await readFile(resolve(dir, entry.name, 'SKILL.md'), 'utf8')
    const match = /^---\s*\nname:\s*(\S+)/.exec(text)
    if (!match) throw new Error(`skill name missing in ${presetId}/${entry.name}`)
    names.push(match[1])
  }
  return names.sort()
}

function mainWorkflowSkill(presetId, names) {
  const own = names.filter((name) => name !== COMMON_SKILL)
  if (own.length === 1) return own[0]
  if (own.length === 0 && names.includes(COMMON_SKILL)) return COMMON_SKILL
  throw new Error(`${presetId}: expected one main workflow Skill, got ${JSON.stringify(names)}`)
}

async function assertPresetDidNotSeedDirs(page, allowed) {
  const extra = await unexpectedNovelDirs(page, allowed)
  if (extra.length) throw new Error(`selecting 小说创作 pre-seeded ${extra.join(', ')}`)
}

async function assertNoPresetSeededDirs(page, label) {
  const extra = await unexpectedPresetDirs(page, ['正文'])
  if (extra.length) throw new Error(`${label} pre-seeded ${extra.join(', ')}`)
}

async function runFourPresetIsolation(page) {
  const knowledgeName = await novelKnowledgeNameFromSource()
  const legacyNovelTools = await legacyNovelToolNamesFromSource(knowledgeName)
  const specs = [
    { id: 'dsh-editor-writing', radio: /通用写作/, marker: MARK.presetWriting, persona: '通用写作助手' },
    { id: 'dsh-editor-article', radio: /文章与自媒体/, marker: MARK.presetArticle, persona: '文章写作助手' },
    { id: 'dsh-editor-technical', radio: /技术文档/, marker: MARK.presetTechnical, persona: '技术写作助手' },
    { id: 'dsh-editor-novel', radio: /小说创作/, marker: MARK.presetNovel, persona: '小说写作助手' },
  ]
  const skillByPreset = {}
  const workflowByPreset = {}
  for (const spec of specs) {
    skillByPreset[spec.id] = await skillNamesForPreset(spec.id)
    workflowByPreset[spec.id] = mainWorkflowSkill(spec.id, skillByPreset[spec.id])
  }
  const otherWorkflowSkills = (presetId) => [...new Set(Object.entries(workflowByPreset)
    .filter(([id, name]) => id !== presetId && name !== COMMON_SKILL)
    .map(([, name]) => name))].sort()
  const otherPersonas = (persona) => specs.map((item) => item.persona).filter((item) => item !== persona)
  const sessionIds = []
  const rows = []
  for (const spec of specs) {
    await startPresetConversation(page, spec.radio, spec.id)
    await assertNoPresetSeededDirs(page, spec.id)
    await selectAssistantModel(page)
    await waitForChatReady(page, spec.id)
    const sessionId = await readActiveSessionId(page)
    if (!sessionId) throw new Error(`${spec.id}: DSH did not expose an active session id`)
    if (sessionIds.includes(sessionId)) throw new Error(`${spec.id}: reused session ${sessionId}`)
    sessionIds.push(sessionId)
    const before = stub.requests.length
    const reply = await sendChat(page, spec.marker, spec.id, 30_000)
    if (!reply.includes(PRESET_OK_TEXT)) throw new Error(`${spec.id}: stub reply was ${JSON.stringify(reply.slice(0, 160))}`)
    await waitUntilIdle(page)
    await waitFor(async () => stub.requests.slice(before).some((item) => item.kind === 'title'), `${spec.id}: title settled`, 12_000).catch(() => undefined)
    await waitFor(async () => {
      const text = (await page.locator('aside.chat').getByRole('combobox', { name: '切换对话' }).innerText()).replace(/\s+/g, ' ').trim()
      return text.includes(PRESET_TITLE[spec.id])
    }, `${spec.id}: unique title visible`, 12_000)
    await waitForChatReady(page, `${spec.id} after probe`)
    const request = stub.requests.slice(before).find((item) => item.kind === 'preset_probe')
    if (!request) {
      throw new Error(`${spec.id}: no preset_probe on kinds=${JSON.stringify(stub.requests.slice(before).map((item) => item.kind))}`)
    }
    if (!String(request.wire?.userRequest || '').includes(spec.marker)) {
      throw new Error(`${spec.id}: probe user_request was ${JSON.stringify(request.wire?.userRequest)}`)
    }
    const personaBlob = String(request.personaText || '')
    const tools = request.toolNames ?? request.wire?.toolNames ?? []
    const skills = request.skills ?? request.wire?.skills ?? []
    if (!personaBlob.includes(spec.persona)) {
      throw new Error(`${spec.id}: persona missing ${spec.persona}: ${clipWire(personaBlob, 240)}`)
    }
    const leakedPersona = otherPersonas(spec.persona).filter((item) => personaBlob.includes(item))
    if (leakedPersona.length) throw new Error(`${spec.id}: persona leaked ${leakedPersona.join(', ')}`)
    if (!tools.includes(WRITING_PROPOSE) || !tools.includes('author_observe')) {
      throw new Error(`${spec.id}: missing writing_propose/author_observe in ${JSON.stringify(tools)}`)
    }
    const visibleNovel = tools.filter((name) => typeof name === 'string' && name.startsWith('novel_'))
    if (spec.id === 'dsh-editor-novel') {
      if (!tools.includes(knowledgeName)) {
        throw new Error(`novel missing ${knowledgeName} in ${JSON.stringify(tools)}`)
      }
      const leakedLegacy = legacyNovelTools.filter((name) => tools.includes(name))
      if (leakedLegacy.length) throw new Error(`novel leaked legacy tools ${leakedLegacy.join(', ')}`)
      const extraNovel = visibleNovel.filter((name) => name !== knowledgeName)
      if (extraNovel.length) throw new Error(`novel leaked extra novel_* ${extraNovel.join(', ')}`)
    } else if (visibleNovel.length) {
      throw new Error(`${spec.id}: leaked novel tools ${visibleNovel.join(', ')}`)
    }
    const workflowSkill = workflowByPreset[spec.id]
    if (!skills.includes(workflowSkill)) {
      throw new Error(`${spec.id}: Skill reminder missing own workflow ${workflowSkill}: ${JSON.stringify(skills)}`)
    }
    if (!skills.includes(COMMON_SKILL)) {
      throw new Error(`${spec.id}: Skill reminder missing ${COMMON_SKILL}: ${JSON.stringify(skills)}`)
    }
    const leakedSkills = otherWorkflowSkills(spec.id).filter((name) => skills.includes(name))
    if (leakedSkills.length) throw new Error(`${spec.id}: leaked other preset workflow Skills ${leakedSkills.join(', ')}`)
    const row = {
      id: spec.id,
      sessionId,
      title: PRESET_TITLE[spec.id],
      persona: spec.persona,
      workflowSkill,
      commonSkill: COMMON_SKILL,
      novelTools: visibleNovel,
    }
    rows.push(row)
    request.isolation = row
  }
  const writing = rows[0]
  const novel = rows[rows.length - 1]
  // Radix conversation options expose titles, not session ids. Distinct stub
  // titles are the only honest UI handle for switching without writing Host state.
  await switchConversationByTitle(page, writing.title)
  await selectAssistantModel(page)
  await waitForChatReady(page, 'switch-back writing')
  const switchBefore = stub.requests.length
  const switchReply = await sendChat(page, MARK.presetWriting, 'switch-back writing', 30_000)
  if (!switchReply.includes(PRESET_OK_TEXT)) {
    throw new Error(`switch-back writing reply was ${JSON.stringify(switchReply.slice(0, 160))}`)
  }
  await waitUntilIdle(page)
  const switchRequest = stub.requests.slice(switchBefore).find((item) => item.kind === 'preset_probe')
  if (!switchRequest) throw new Error('switch-back writing produced no preset_probe')
  const switchTools = switchRequest.toolNames ?? switchRequest.wire?.toolNames ?? []
  const switchPersona = String(switchRequest.personaText || '')
  if (!switchPersona.includes(writing.persona)) throw new Error('switch-back writing lost its persona')
  if (switchPersona.includes(novel.persona)) throw new Error('switch-back writing leaked novel persona')
  if (!switchTools.includes(WRITING_PROPOSE) || switchTools.some((name) => String(name).startsWith('novel_'))) {
    throw new Error(`switch-back writing leaked tools ${JSON.stringify(switchTools)}`)
  }
  await switchConversationByTitle(page, novel.title)
  await selectAssistantModel(page)
  await waitForChatReady(page, 'restore novel')
  report.presetIsolation = rows
  return `${specs.map((item) => item.id).join(' → ')}; ${sessionIds.length} sessions; switch-back ${writing.id}↔${novel.id}`
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

async function selectAssistantModel(page) {
  const assistant = await ensureAssistantOpen(page)
  const composer = modelScope(page)
  await waitFor(async () => (await composer.getByRole('combobox', { name: '选择模型' }).count()) > 0, 'assistant model combobox attached', 25_000)
  if (!isExactStubModel(await readActiveModel(page))) {
    await chooseStubModel(composer, 'composer')
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
  const initIgnore = page.getByRole('article', { name: '作品初始化' }).getByRole('button', { name: '忽略' })
  if (await initIgnore.isVisible().catch(() => false)) {
    await initIgnore.click()
    return true
  }
  return false
}

async function chatTurnBlocked(page) {
  const chat = page.locator('aside.chat')
  if (await chat.getByRole('button', { name: /^停止$/ }).isVisible().catch(() => false)) return true
  if (await chat.locator('.chat-history').getAttribute('data-running') === 'true') return true
  return chat.locator('.chat-row.assistant').filter({ hasText: /^正在回复/ }).isVisible().catch(() => false)
}

async function waitUntilIdle(page, timeout = 25_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await answerPending(page)
    if (!(await chatTurnBlocked(page))) return
    await delay(200)
  }
  throw new Error('timed out: chat still busy')
}

async function chatReconnecting(page) {
  return page.locator('aside.chat .chat-status').filter({ hasText: /重连中|Reconnecting/ }).isVisible().catch(() => false)
}

async function waitForChatReady(page, label) {
  await waitUntilIdle(page)
  await waitFor(async () => {
    if (await chatReconnecting(page)) return false
    if (await chatTurnBlocked(page)) return false
    const box = page.getByRole('textbox', { name: '输入消息' })
    if (!(await box.isEditable().catch(() => false))) return false
    const trigger = modelScope(page).getByRole('combobox', { name: '选择模型' }).first()
    if (await trigger.isDisabled().catch(() => true)) return false
    if (!isExactStubModel(await readActiveModel(page))) return false
    return page.locator('aside.chat').getByRole('button', { name: '新对话' }).isEnabled().catch(() => false)
  }, `${label}: chat ready`, 25_000)
}

async function sendChat(page, prompt, label, timeout = 30_000) {
  await assertStubSelected(page, label)
  const chat = page.locator('aside.chat')
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning, .chat-row.notice').filter({ hasText: /未能完成|中断/ }).count()
  await waitFor(async () => {
    if (await chat.getByRole('button', { name: /^停止$/ }).isVisible().catch(() => false)) return true
    if ((await page.locator('.chat-row.assistant').count()) > assistantBefore) return true
    if (await chatReconnecting(page)) return false
    const box = page.getByRole('textbox', { name: '输入消息' })
    if (!(await box.isEditable().catch(() => false))) return false
    if (!(await box.inputValue().catch(() => '')).includes(prompt)) {
      await box.fill(prompt).catch(() => undefined)
      return false
    }
    const send = page.getByRole('button', { name: '发送', exact: true })
    if (!(await send.isEnabled().catch(() => false))) return false
    await send.click({ timeout: 2_000 }).catch(() => undefined)
    return false
  }, `${label}: turn started`, 30_000)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await answerPending(page)
    if (await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count() > warningBaseline) {
      throw new Error(`${label}: 写作助手未能完成这次请求`)
    }
    const count = await page.locator('.chat-row.assistant').count()
    if (count > assistantBefore && !(await chatTurnBlocked(page))) {
      const text = (await page.locator('.chat-row.assistant').last().innerText()).trim()
      if (text && !/^正在回复/.test(text)) return text
    }
    await delay(200)
  }
  throw new Error(`${label}: timed out without assistant reply`)
}

async function waitForProposal(page, previousCount, label, expectedPath) {
  const cards = page.locator('.proposal-card[aria-label="文件修改建议"]')
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

async function assertWritingV2Card(card, expectedPath) {
  const proposal = lastWritingProposal()
  const text = await card.innerText()
  if (await pageHasAuthorMemoryCard(activePage)) {
    throw new Error('main flow still surfaced an author-memory card')
  }
  if (!text.includes(expectedPath)) throw new Error(`proposal card missing ${expectedPath}`)
  if (!proposal || proposal.tool !== WRITING_PROPOSE) {
    throw new Error(`proposal was not ${WRITING_PROPOSE}: ${JSON.stringify(proposal)}`)
  }
  if (proposal.marker !== WRITING_MARKER || proposal.version !== WRITING_VERSION) {
    throw new Error(`proposal was not V2: ${JSON.stringify(proposal)}`)
  }
  const basis = proposal.basis ?? []
  if (!basis.length) throw new Error('writing_propose V2 missing real basis')
  for (const item of basis) {
    if (!item.path || !item.version || !item.label) throw new Error(`basis incomplete: ${JSON.stringify(item)}`)
    if (!text.includes(item.path) || !text.includes(item.version) || !text.includes(item.label)) {
      throw new Error(`card missing basis ${item.label} ${item.path} ${item.version}`)
    }
  }
  if (!(await card.locator('.proposal-basis').count()) && !text.includes('依据与基线')) {
    throw new Error('V2 basis section missing on card')
  }
  if (proposal.kind === 'create') {
    if (proposal.targetVersion) throw new Error(`V2 create carried targetVersion: ${JSON.stringify(proposal)}`)
  }
  if (proposal.kind === 'edit' || proposal.kind === 'split') {
    if (!proposal.targetVersion) throw new Error(`V2 ${proposal.kind} missing targetVersion: ${JSON.stringify(proposal)}`)
    if (!text.includes('生成基线')) throw new Error('V2 target baseline section missing on card')
    if (!text.includes(proposal.targetVersion)) throw new Error(`card missing targetVersion ${proposal.targetVersion}`)
  }
  if (proposal.kind === 'merge') {
    if (!proposal.targetVersion || !proposal.sourceVersion) {
      throw new Error(`V2 merge missing target/source versions: ${JSON.stringify(proposal)}`)
    }
  }
}

function pageHasAuthorMemoryCard(page) {
  return page.getByRole('article', { name: '作者侧写建议' }).count().then((count) => count > 0)
}

async function sendForProposal(page, prompt, expectedPath, label) {
  await assertStubSelected(page, label)
  const cards = page.locator('.proposal-card[aria-label="文件修改建议"]')
  const before = await cards.count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 20_000)
  await send.click()
  const card = await waitForProposal(page, before, label, expectedPath)
  await assertWritingV2Card(card, expectedPath)
  return card
}

/* V1 legacy proposals carry no targetVersion/basis; the card contract is asserted by the scenario itself. */
async function sendLegacyProposal(page, prompt, expectedPath, label) {
  await assertStubSelected(page, label)
  const cards = page.locator('.proposal-card[aria-label="文件修改建议"]')
  const before = await cards.count()
  await page.getByRole('textbox', { name: '输入消息' }).fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 20_000)
  await send.click()
  return waitForProposal(page, before, label, expectedPath)
}

async function sendExpectingHostRejection(page, prompt, label, expectedName) {
  await assertStubSelected(page, label)
  const readyBefore = await page.getByText('可以安全应用', { exact: true }).count()
  const beforeFile = await readChapter()
  await sendChat(page, prompt, label, 30_000)
  await waitUntilIdle(page)
  const chat = page.locator('aside.chat')
  await waitFor(async () => {
    const text = await chat.innerText().catch(() => '')
    return text.includes('这项操作没有执行') || text.includes('不在允许范围') || (await chat.locator('.chat-row.tool.error').count()) > 0
  }, `${label}: Host rejection visible`, 20_000)
  const text = await chat.innerText()
  if (expectedName && !text.includes(expectedName) && !text.includes('不在允许范围') && !text.includes('这项操作没有执行')) {
    throw new Error(`${label}: rejection did not name ${expectedName}: ${text.slice(-800)}`)
  }
  if ((await page.getByText('可以安全应用', { exact: true }).count()) > readyBefore) {
    throw new Error(`${label}: rejected call surfaced an applyable proposal`)
  }
  const afterFile = await readChapter()
  if (afterFile !== beforeFile) throw new Error(`${label}: Host rejection still mutated the file`)
  if (afterFile.includes('HOST_GUARD_SHOULD_BLOCK')) throw new Error(`${label}: direct write landed`)
  return text
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

async function runPlanningFlow(page) {
  const chapter = () => readFile(resolve(workspace, CHAPTER_REL), 'utf8')
  const plan = () => readFile(resolve(workspace, PLAN_REL), 'utf8')
  const openPlan = async () => {
    await expandDirectory(page, '大纲')
    const row = page.locator('.tree-row.tree-main').filter({ hasText: '章纲.md' }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.click()
    await page.locator('[data-testid="paper-path"]', { hasText: /大纲\/章纲\.md/ }).waitFor({ state: 'visible', timeout: 20_000 })
  }
  const proposal = async (request, path) => {
    await assertStubSelected(page, request)
    const before = await page.locator('.proposal-card').count()
    await page.getByRole('textbox', { name: '输入消息' }).fill(request)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await waitFor(async () => (await page.locator('.proposal-card').count()) > before, request + ' proposal', 35000)
    const card = page.locator('.proposal-card').last()
    await card.getByRole('button', { name: /^(应用|采用)$/ }).waitFor({ state: 'visible' })
    if (!(await card.innerText()).includes(path)) throw new Error('proposal target missing: ' + path)
    await assertWritingV2Card(card, path)
    return card
  }
  const apply = async card => {
    await card.getByRole('button', { name: /^(应用|采用)$/ }).click()
    await waitFor(async () => /已应用|已采用/.test(await card.innerText()), 'applied card')
  }
  if (!(await cover('planning-assistant', async () => {
    const beforePreset = await listNovelDirs(page)
    await startNovelConversation(page)
    await assertPresetDidNotSeedDirs(page, ['正文'])
    const afterPreset = await listNovelDirs(page)
    if (JSON.stringify(beforePreset) !== JSON.stringify(afterPreset)) {
      throw new Error(`小说创作 changed directories: ${beforePreset.join(',')} → ${afterPreset.join(',')}`)
    }
    await chooseStubModel(modelScope(page), 'planning')
    await assertStubSelected(page, 'planning')
    return 'novel conversation; isolated stub selected'
  }))) return
  await cover('planning-create-directories', async () => {
    for (const [request, path, expectedDirectory] of [['PLANNING_OUTLINE', '大纲/第一卷/卷纲.md', '大纲/第一卷'], ['PLANNING_CARD', '人物卡/少年.md', '人物卡'], ['PLANNING_WORLD', '世界书/山门.md', '世界书']]) {
      const card = await proposal(request, path)
      if (await exists(resolve(workspace, path))) throw new Error('preview wrote file')
      if (!(await card.innerText()).includes(expectedDirectory)) throw new Error('missing parent preview')
      if (request === 'PLANNING_OUTLINE' && !(await card.innerText()).includes('大纲')) throw new Error('missing outline label')
      // A transport failure must retain this proposal and permit explicit recheck.
      if (request === 'PLANNING_CARD') {
        await page.route(/\/dsh-editor-workbench\/proposal\.apply$/, route => route.abort('failed'), { times: 1 })
        await card.getByRole('button', { name: /^(应用|采用)$/ }).click()
        const retry = card.getByRole('button', { name: /重新核对|重试/ })
        await retry.waitFor()
        await retry.click()
        await card.getByRole('button', { name: /^(应用|采用)$/ }).waitFor()
      }
      await apply(card)
      await waitFor(() => exists(resolve(workspace, path)), path + ' on disk')
    }
    await openChapter(page)
    await shot(page, 'planning-directories', '一次采用创建大纲、人物卡和世界书目录')
    return 'three first-use directories; retained failed proposal retry'
  })
  await cover('planning-outline-markdown', async () => {
    const before = await chapter()
    const card = await proposal('PLANNING_PLAN', PLAN_REL)
    if (!/章纲/.test(await card.innerText())) throw new Error('plan card lacks chapter purpose')
    await apply(card)
    await waitFor(() => exists(resolve(workspace, PLAN_REL)), PLAN_REL + ' on disk')
    const text = await plan()
    if (!text.includes('少年出山') || !text.includes('读信寻找师叔')) throw new Error('outline markdown missing beats')
    if (text.includes('beats:') || /^---/.test(text)) throw new Error('outline is not ordinary Markdown')
    if ((await chapter()) !== before) throw new Error('chapter planning touched manuscript')
    await shot(page, 'planning-proposals', '章纲经 大纲/ 普通 Markdown 提案落盘，正文不动')
    return 'chapter planning persisted as plain Markdown under 大纲/, manuscript untouched'
  })
  await cover('planning-stale-proposal', async () => {
    await ensureAssistantOpen(page)
    await chooseStubModel(modelScope(page), 'stale planning')
    const card = await proposal('PLANNING_STALE', PLAN_REL)
    await openPlan(page)
    await page.locator('[data-testid="paper-editor"] .cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n作者改变了章纲走向。\n')
    await waitFor(async () => (await plan()).includes('作者改变了章纲走向。'), 'author changes persisted')
    const before = await plan()
    await card.getByRole('button', { name: /^(应用|采用)$/ }).click()
    await waitFor(async () => /变化|变更|失效|重新生成/.test(await card.innerText()), 'stale proposal feedback')
    if ((await plan()) !== before) throw new Error('stale proposal altered current outline')
    const proposal = lastWritingProposal()
    if (!proposal?.targetVersion) throw new Error('planning stale fixture omitted targetVersion')
    if (!proposal.basis?.some((item) => item.path === CHAPTER_REL)) {
      throw new Error('planning stale fixture did not keep a current non-target basis')
    }
    return 'stale generation target refused while chapter basis stayed current'
  })
  await cover('planning-glob', async () => {
    await assertStubSelected(page, 'glob')
    const before = stub.requests.length
    await page.getByRole('textbox', { name: '输入消息' }).fill('PLANNING_GLOB')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await waitFor(async () => stub.requests.slice(before).some(row => row.kind === 'planning_done' && row.completed), 'glob tool done')
    const row = stub.requests.slice(before).find(row => row.kind === 'planning_done')
    if (!row?.toolReplies?.some(text => text.includes('001.md')) || row.toolReplies.some(text => /Glob is limited|isError":true/.test(text))) throw new Error('real glob did not find manuscript: ' + JSON.stringify(row?.toolReplies))
    return 'real glob accepts Markdown/TXT brace pattern'
  })
  await cover('no-external-model-calls', async () => {
    if (!stub.requests.length || stub.requests.some(row => !/^127\.0\.0\.1:\d+$/.test(row.host))) throw new Error('invalid local stub request audit')
    return `${stub.requests.length} local requests; no paid vendor calls`
  })
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
  page.on('request', captureManuscriptSession)
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/dsh-editor-workbench/')) return
    const method = new URL(request.url()).pathname.split('/').pop() ?? ''
    let sessionId = ''
    try { sessionId = String(request.postDataJSON()?.payload?.sessionId ?? '') } catch { /* non-JSON post */ }
    workbenchCalls.push({ method, sessionId, at: Date.now() })
    if (method === 'context.compile') contextCompileCalls.push({ sessionId, at: Date.now() })
  })
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
  if (planningOnly) page.on('console', message => {
    if (message.type() !== 'error') return
    void Promise.all(message.args().map(arg => arg.evaluate(value => value instanceof Error ? value.stack : String(value)).catch(() => 'unreadable'))).then(lines => {
      report.consoleErrors ??= []
      report.consoleErrors.push(lines.join(' ').slice(0, 5000))
    })
  })
  report.modelSelections = []
  page.on('request', request => {
    try {
      const body = request.postDataJSON()
      if (body?.method === 'session.selectModel' || request.url().includes('selectModel')) report.modelSelections.push({url: new URL(request.url()).pathname, payload: body?.payload})
    } catch {}
  })


  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="shell-error"]')) || (document.title === 'DSH Editor' && Boolean(document.querySelector('.shell'))), undefined, { timeout: 45_000 })
  if (await page.getByTestId('shell-error').count()) throw new Error('shell boot: ' + await page.getByTestId('shell-error').first().innerText())
  await dismissNativeOnboarding(page)
  await shot(page, 'home', '首页')

  if (!(await cover('configure-test-model', async () => configureTestModel(page, stub.baseURL)))) {
    skipDependents('configure-test-model failed; stub provider not in settings')
    return
  }
  if (!(await cover('open-synthetic-work', async () => {
    await openEmptyProject(page)
    await seedWorkspaceThroughUi(page)
    await openChapter(page)
    const onDisk = await readChapter()
    if (!onDisk.includes(ORIGINAL_LINE)) throw new Error('seeded chapter missing original line')
    await shot(page, 'workbench', '空作品经 UI 创建章节')
    return CHAPTER_REL
  }))) {
    skipDependents('open-synthetic-work failed')
    return
  }
  if (planningOnly) {
    await runPlanningFlow(page)
    await shot(page, 'planning-complete', '章纲经大纲 Markdown 协作闭环')
    await context.close()
    return
  }

  /* 旧版 dsh-editor 会话：开发者模式（真实设置弹窗）→ picker 徽标 → context.compile V3 →
     V1 提案应用 → 重载恢复 → V1 过期拒绝。chapter_plan 的 sourceVersion 冲突在工具层已被拒
     （章纲只走 大纲/ Markdown），这里用同一 prepare-version→apply 核对管线的 V1 edit 代替。 */
  const legacyCreated = await cover('legacy-session-create', async () => {
    await setDeveloperMode(page, true)
    const assistant = await startLegacyConversation(page)
    const card = assistant.locator('.init-guide-quiet')
    try {
      await card.waitFor({ state: 'visible', timeout: 20_000 })
    } catch (error) {
      const chatState = await assistant.evaluate((el) => el.outerHTML.slice(0, 600)).catch(() => '')
      throw new Error(`init-guide card missing; workbenchCalls=${JSON.stringify(workbenchCalls.map((item) => item.method))}; chat=${chatState}`)
    }
    const cardText = await card.evaluate((el) => el.textContent || '')
    if (!cardText.includes('了解作品') || !cardText.includes('通读现有内容')) {
      throw new Error(`legacy init-guide card unexpected: ${cardText.slice(0, 160)}`)
    }
    const sessionId = await readActiveSessionId(page)
    if (!sessionId) throw new Error('legacy session id missing')
    report.legacySessionId = sessionId
    await selectAssistantModel(page)
    await waitForChatReady(page, 'legacy session')
    await shot(page, 'legacy-session', '开发者模式下的旧版会话与了解作品卡片')
    return `dsh-editor session ${sessionId}; init-guide card visible on non-indexed project`
  })
  const legacyPingOk = legacyCreated && await cover('legacy-context-compile-v3', async () => {
    const compileBefore = contextCompileCalls.length
    const requestsBefore = stub.requests.length
    const reply = await sendChat(page, MARK.legacyPing, 'legacy ping', 30_000)
    if (!reply.includes(LEGACY_PONG_TEXT)) throw new Error(`legacy reply was ${JSON.stringify(reply.slice(0, 160))}`)
    await waitUntilIdle(page)
    await waitFor(async () => contextCompileCalls.slice(compileBefore).some((item) => item.sessionId === report.legacySessionId), 'context.compile RPC for legacy session', 15_000)
    const request = stub.requests.slice(requestsBefore).find((item) => item.kind === 'legacy_ping')
    if (!request) throw new Error(`no legacy_ping on kinds=${JSON.stringify(stub.requests.slice(requestsBefore).map((item) => item.kind))}`)
    if (!request.contextEnvelope) throw new Error('legacy send did not carry the dsh-editor.project-context V3 envelope')
    if ((request.wire?.userPreviews ?? []).some((preview) => preview.trim() === MARK.legacyPing)) {
      throw new Error('legacy send used the plain-text path')
    }
    await renameCurrentConversation(page, LEGACY_TITLE_TEXT)
    await waitForChatReady(page, 'legacy after ping')
    return 'context.compile V3 envelope observed on the stub wire; conversation renamed for restore'
  })
  if (!legacyPingOk) {
    for (const name of ['legacy-v1-proposal-apply', 'legacy-session-restore', 'legacy-v1-stale-rejected']) {
      recordCheck(name, false, `dependency-skipped-as-failure: ${legacyCreated ? 'legacy-context-compile-v3' : 'legacy-session-create'} failed`)
    }
  }
  const legacyApplied = legacyPingOk && await cover('legacy-v1-proposal-apply', async () => {
    const card = await sendLegacyProposal(page, MARK.legacyEdit, CHAPTER_REL, 'legacy V1 edit')
    const proposal = lastWritingProposal()
    if (!proposal || proposal.tool !== LEGACY_PROPOSE_TOOL) {
      throw new Error(`legacy proposal was not ${LEGACY_PROPOSE_TOOL}: ${JSON.stringify(proposal)}`)
    }
    if ('targetVersion' in proposal || 'marker' in proposal || 'version' in proposal) {
      throw new Error(`legacy fixture should stay unmarked V1 args: ${JSON.stringify(proposal)}`)
    }
    await card.getByRole('button', { name: '应用', exact: true }).click()
    await card.getByText('已应用到作品', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await waitFor(async () => (await readChapter()).includes(LEGACY_EDIT_NEW), 'legacy V1 edit on disk', 10_000)
    if (!(await readChapter()).includes(ORIGINAL_LINE)) throw new Error('legacy V1 edit disturbed the main-flow line')
    return 'V1 edit (no targetVersion) applied through /manuscript proposal.apply'
  })
  const legacyRestored = legacyApplied && await cover('legacy-session-restore', async () => {
    await page.reload()
    await page.locator('.shell').waitFor({ timeout: 45_000 })
    if (await page.getByTestId('shell-error').count()) throw new Error('shell boot after reload: ' + await page.getByTestId('shell-error').first().innerText())
    const assistant = await ensureAssistantOpen(page)
    await switchConversationByTitle(page, LEGACY_TITLE_TEXT)
    await selectAssistantModel(page)
    await waitForChatReady(page, 'legacy restored')
    const sessionId = await readActiveSessionId(page)
    if (sessionId !== report.legacySessionId) throw new Error(`restored session ${sessionId} ≠ ${report.legacySessionId}`)
    const history = await assistant.locator('.chat-history').innerText()
    if (!history.includes(LEGACY_PONG_TEXT)) throw new Error('restored legacy transcript lost the assistant reply')
    /* 应用完成态是 UI 局部状态；重载后卡片重新核对。这里只要求历史提案卡还在并指向正文文件。 */
    const cardTexts = await assistant.locator('.proposal-card[aria-label="文件修改建议"]').allTextContents()
    if (!cardTexts.some((text) => text.includes(CHAPTER_REL) && text.includes('旧版 V1 改题'))) {
      throw new Error(`restored legacy transcript lost the historical proposal card: ${JSON.stringify(cardTexts).slice(0, 240)}`)
    }
    const compileBefore = contextCompileCalls.length
    const requestsBefore = stub.requests.length
    const reply = await sendChat(page, MARK.legacyPing, 'legacy ping after restore', 30_000)
    if (!reply.includes(LEGACY_PONG_TEXT)) throw new Error(`restored legacy reply was ${JSON.stringify(reply.slice(0, 160))}`)
    await waitUntilIdle(page)
    await waitFor(async () => contextCompileCalls.slice(compileBefore).some((item) => item.sessionId === report.legacySessionId), 'context.compile after restore', 15_000)
    const request = stub.requests.slice(requestsBefore).find((item) => item.kind === 'legacy_ping')
    if (!request?.contextEnvelope) throw new Error('restored legacy session lost the V3 envelope path')
    const banner = assistant.getByRole('note', { name: '旧版会话' })
    await banner.waitFor({ state: 'visible', timeout: 15_000 })
    const bannerText = await banner.innerText()
    if (!bannerText.includes('此会话使用旧版模式') || !bannerText.includes('新建写作会话')) {
      throw new Error(`migration banner copy unexpected: ${bannerText.slice(0, 160)}`)
    }
    await shot(page, 'legacy-restored', '重载后经对话切换恢复旧版会话')
    await banner.getByRole('button', { name: '关闭', exact: true }).click()
    await banner.waitFor({ state: 'hidden', timeout: 10_000 })
    return 'reload + combobox restore kept legacyEditor behavior; migration banner shown and dismissed'
  })
  if (legacyApplied && !legacyRestored) {
    recordCheck('legacy-v1-stale-rejected', false, 'dependency-skipped-as-failure: legacy-session-restore failed')
  }
  if (legacyRestored) await cover('legacy-v1-stale-rejected', async () => {
    await openChapter(page)
    const card = await sendLegacyProposal(page, MARK.legacyEditStale, CHAPTER_REL, 'legacy V1 stale')
    const proposal = lastWritingProposal()
    if (!proposal || proposal.tool !== LEGACY_PROPOSE_TOOL) {
      throw new Error(`legacy stale proposal was not ${LEGACY_PROPOSE_TOOL}: ${JSON.stringify(proposal)}`)
    }
    await page.locator('[data-testid="paper-editor"] .cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText(`\n${LEGACY_AUTHOR_MUTATION}\n`)
    await savePaper(page)
    const mutated = await readChapter()
    if (!mutated.includes(LEGACY_AUTHOR_MUTATION)) throw new Error('author mutation did not persist')
    await card.getByRole('button', { name: '应用', exact: true }).click()
    await waitFor(async () => /变化|变更|失效|重新生成/.test(await card.innerText()), 'legacy stale feedback')
    if ((await readChapter()) !== mutated) throw new Error('stale V1 edit wrote the chapter')
    if (mutated.includes(LEGACY_STALE_NEW)) throw new Error('stale V1 edit applied its text')
    await typeIntoPaper(page, CHAPTER_TEXT)
    await openChapter(page)
    return 'stale V1 apply refused (substitute for the tool-guarded chapter_plan sourceVersion conflict)'
  })
  await cover('legacy-developer-mode-off', async () => {
    await setDeveloperMode(page, false)
    const assistant = await ensureAssistantOpen(page)
    await assistant.getByRole('button', { name: '新对话' }).click()
    const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
    if (await discard.isVisible({ timeout: 1_500 }).catch(() => false)) await discard.click()
    const picker = page.getByRole('dialog', { name: '选择对话模式' })
    await picker.waitFor({ state: 'visible', timeout: 15_000 })
    const labels = await picker.getByRole('radio').allTextContents()
    if (labels.some((label) => /旧采访|写作助手|dsh-editor(?!-)/i.test(label))) {
      throw new Error(`legacy preset visible after developer mode off: ${JSON.stringify(labels)}`)
    }
    await picker.getByRole('button', { name: '取消', exact: true }).click()
    await picker.waitFor({ state: 'hidden', timeout: 10_000 })
    return 'developer mode off; picker hides 写作助手 again'
  })

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
    /* 写作功能 4 个（写作辅助/校对/作品概览/知乎资料）+ 写作模式 3 个可开关 preset；再多才算按实现包拆散。 */
    if (await dialog.getByRole('switch').count() > 9) throw new Error('bundled features are still split by implementation package')
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
    await waitFor(async () => control.evaluate((el, enabledBackground) => {
      if (el.getAttribute('aria-checked') !== 'false' || el.classList.contains('is-on')) return false
      const thumb = el.querySelector('.dsh-plugins-switch-thumb')
      const transform = thumb ? getComputedStyle(thumb).transform : 'none'
      const thumbOff = transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)'
      return thumbOff && getComputedStyle(el).backgroundColor !== enabledBackground
    }, enabledAppearance.background), 'disabled switch track differs from enabled', 10000)
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

  recordGap(
    'unknown-preset-picker',
    'The visible picker only offers the four professional presets (developer mode adds only deployed legacy/plugin presets). There is no UI in this harness to select an unknown agentPreset, so Host write-guard coverage uses a direct write tool and an unknown_tool call on the current novel session instead of inventing a fake preset binding.',
  )

  if (!(await cover('four-preset-runtime-isolation', async () => {
    const before = await listPresetDirs(page)
    const detail = await runFourPresetIsolation(page)
    await assertNoPresetSeededDirs(page, 'after four presets')
    const after = await listPresetDirs(page)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`four presets changed directories: ${before.join(',')} → ${after.join(',')}`)
    }
    if (report.agentPreset !== 'dsh-editor-novel') throw new Error(`novel was not left current: ${report.agentPreset}`)
    await shot(page, 'four-preset-isolation', '同一作品下四个会话的运行时隔离')
    return detail
  }))) {
    skipDependents('four-preset-runtime-isolation failed; novel conversation is not current')
    return
  }

  if (!(await cover('open-assistant', async () => {
    const beforePreset = await listNovelDirs(page)
    await ensureAssistantOpen(page)
    await page.getByRole('textbox', { name: '输入消息' }).waitFor({ state: 'visible', timeout: 15_000 })
    await assertPresetDidNotSeedDirs(page, ['正文'])
    const afterPreset = await listNovelDirs(page)
    if (JSON.stringify(beforePreset) !== JSON.stringify(afterPreset)) {
      throw new Error(`小说创作 changed directories: ${beforePreset.join(',')} → ${afterPreset.join(',')}`)
    }
    if (report.agentPreset !== 'dsh-editor-novel') throw new Error(`open-assistant is not on novel: ${report.agentPreset}`)
    const chosen = await selectAssistantModel(page)
    await waitUntilIdle(page)
    await shot(page, 'assistant-ready', '小说创作会话已选本地桩')
    return `${report.agentPreset}; ${chosen}`
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
    const card = page.locator('.proposal-card[aria-label="文件修改建议"]').last()
    await card.getByRole('button', { name: '应用', exact: true }).click()
    await card.getByText('已应用到作品', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await waitFor(async () => (await readChapter()).includes(EDITED_LINE), 'applied text on disk', 10_000)
    const text = await readChapter()
    if (text.includes(ORIGINAL_LINE)) throw new Error('original line still present after apply')
    await shot(page, 'edit-applied', '应用后真实写盘')
    return 'proposal.apply wrote expected text'
  }))) {
    recordCheck('edit-undo-restores', false, 'dependency-skipped-as-failure: edit-apply-writes failed')
  } else {
    await cover('edit-undo-restores', async () => {
      const card = page.locator('.proposal-card[aria-label="文件修改建议"]').last()
      // Settled cards render as a collapsed <details>: expand before reaching footer actions.
      await card.locator('summary').click()
      const undo = card.getByRole('button', { name: '撤销此次修改' })
      await undo.waitFor({ state: 'visible', timeout: 10_000 })
      await undo.click()
      await card.getByText('已撤销，作品已恢复到应用前的内容', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
      await waitFor(async () => (await readChapter()).includes(ORIGINAL_LINE), 'undo restored disk', 10_000)
      const text = await readChapter()
      if (text.includes(EDITED_LINE)) throw new Error('edited line remained after undo')
      await shot(page, 'edit-undone', '撤销恢复原文')
      return 'file.write undo restored original'
    })
  }

  await cover('v2-edit-missing-target-rejected', async () => {
    const before = await readChapter()
    const readyBefore = await page.getByText('可以安全应用', { exact: true }).count()
    await sendChat(page, MARK.editMissingTarget, 'missing targetVersion', 30_000)
    await waitUntilIdle(page)
    const chat = await page.locator('aside.chat').innerText()
    if (!/这项操作没有执行|targetVersion/.test(chat)) {
      throw new Error(`missing targetVersion did not surface a Host parse rejection: ${chat.slice(-800)}`)
    }
    if ((await page.getByText('可以安全应用', { exact: true }).count()) > readyBefore) {
      throw new Error('V2 edit without targetVersion still became applyable')
    }
    const proposal = lastWritingProposal()
    if (proposal?.targetVersion) throw new Error('missing-target fixture unexpectedly carried targetVersion')
    if (!proposal?.basis?.length) throw new Error('missing-target fixture should keep basis so it cannot substitute')
    if ((await readChapter()) !== before) throw new Error('rejected missing-target edit wrote the file')
    return 'V2 edit without targetVersion rejected; current basis did not substitute'
  })

  if (!(await cover('stale-generation-target-rejected', async () => {
    await createFileIn(page, '正文', '依据')
    await typeIntoPaper(page, '# 依据\n\n雾港广播塔是开场锚点。\n')
    await openChapter(page)
    const basisBefore = await manuscriptFileRead(page, BASIS_NOTE_REL)
    const card = await sendForProposal(page, MARK.editStaleTarget, CHAPTER_REL, 'stale target')
    const generated = lastWritingProposal()
    if (!generated?.targetVersion) throw new Error('stale-target fixture omitted targetVersion')
    if (generated.basis?.some((item) => item.path === CHAPTER_REL)) {
      throw new Error('stale-target fixture used the target as basis')
    }
    if (!generated.basis?.some((item) => item.path === BASIS_NOTE_REL && item.version === basisBefore.version)) {
      throw new Error(`stale-target basis was not the live note receipt: ${JSON.stringify(generated.basis)}`)
    }
    await page.locator('[data-testid="paper-editor"] .cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n作者改了正文，生成基线应失效。\n')
    await savePaper(page)
    const mutated = await readChapter()
    if (!mutated.includes('作者改了正文，生成基线应失效。')) throw new Error('author mutation did not persist')
    const basisAfter = await manuscriptFileRead(page, BASIS_NOTE_REL)
    if (basisAfter.version !== basisBefore.version) throw new Error('basis note version changed; cannot prove target-only stale')
    await card.getByRole('button', { name: '应用', exact: true }).click()
    await waitFor(async () => /变化|变更|失效|重新生成/.test(await card.innerText()), 'stale generation target feedback')
    if ((await readChapter()) !== mutated) throw new Error('stale generation target still wrote the chapter')
    if ((await readChapter()).includes(EDITED_LINE)) throw new Error('stale generation target applied the edit')
    await typeIntoPaper(page, CHAPTER_TEXT)
    await openChapter(page)
    return 'stale targetVersion refused while basis note stayed current'
  }))) {
    await typeIntoPaper(page, CHAPTER_TEXT).catch(() => undefined)
    await openChapter(page).catch(() => undefined)
  }

  await cover('host-write-guard-blocks-direct-write', async () => {
    const text = await sendExpectingHostRejection(page, MARK.writeBypass, 'write bypass', 'write')
    if (!/不在允许范围|这项操作没有执行/.test(text)) {
      throw new Error(`write bypass missing Host guard copy: ${text.slice(-800)}`)
    }
    return 'write tool rejected; chapter unchanged'
  })

  await cover('host-write-guard-blocks-unknown-tool', async () => {
    const text = await sendExpectingHostRejection(page, MARK.unknownTool, 'unknown tool', 'unknown_tool')
    if (!/不在允许范围|这项操作没有执行/.test(text)) {
      throw new Error(`unknown tool missing Host guard copy: ${text.slice(-800)}`)
    }
    return 'unknown_tool rejected; chapter unchanged'
  })

  await cover('ignored-create-never-writes', async () => {
    if (await exists(resolve(workspace, '大纲', '总纲.md'))) throw new Error('create target already existed')
    if (await exists(resolve(workspace, '大纲'))) throw new Error('大纲 should not exist before ignored create')
    const card = await sendForProposal(page, MARK.create, CREATE_REL, 'create proposal')
    await card.getByRole('button', { name: '忽略' }).click()
    await card.getByText('已忽略，未修改作品', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    await delay(500)
    if (await exists(resolve(workspace, '大纲', '总纲.md'))) throw new Error('ignored CREATE wrote the file')
    if (await exists(resolve(workspace, '大纲'))) throw new Error('ignored CREATE created 大纲')
    await shot(page, 'create-ignored', '忽略 CREATE 未写盘')
    return 'create file absent'
  })

  await cover('cancel-pending-no-late-mutation', async () => {
    await assertStubSelected(page, 'hold')
    const beforeFile = await readChapter()
    const beforeHold = stub.requests.filter((item) => item.kind === 'hold').length
    const composer = page.getByRole('textbox', { name: '输入消息' })
    await composer.fill(MARK.hold)
    const send = page.getByRole('button', { name: '发送', exact: true })
    await waitFor(async () => send.isEnabled(), 'hold send enabled', 15_000)
    await send.click()
    await waitFor(async () => stub.requests.filter((item) => item.kind === 'hold').length > beforeHold, 'hold reached stub', 15_000)
    const stop = page.locator('aside.chat').getByRole('button', { name: /^停止$/ })
    await waitFor(async () => stop.isVisible().catch(() => false), 'hold started', 15_000)
    await stop.click()
    await waitFor(async () => !(await chatTurnBlocked(page)), 'stop released composer', 15_000)
    await delay(6_000)
    const afterText = await page.locator('aside.chat').innerText()
    if (afterText.includes(LATE_TEXT)) throw new Error('late stub reply became visible after stop')
    const afterFile = await readChapter()
    if (afterFile !== beforeFile) throw new Error('pending cancel mutated the chapter file')
    const hold = stub.requests.filter((item) => item.kind === 'hold')
    if (!hold.length) throw new Error('hold never reached stub')
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
    const beforeLong = stub.requests.filter((item) => item.kind === 'read_long').length
    const reply = await sendChat(page, MARK.readLong, 'long-chat', 30_000)
    await waitFor(async () => stub.requests.filter((item) => item.kind === 'read_long').length > beforeLong, 'read_long reached stub', 10_000)
    const request = stub.requests.findLast((item) => item.kind === 'read_long')
    if (!request?.completed || request.aborted) throw new Error(`read_long SSE incomplete: ${JSON.stringify({ completed: request?.completed, aborted: request?.aborted })}`)
    if (!String(request.wire?.userRequest || '').includes(MARK.readLong)) {
      throw new Error(`read_long wire user_request was ${JSON.stringify(request.wire?.userRequest)}`)
    }
    const response = page.locator('.chat-row.assistant').last()
    const rendered = (await response.innerText()).trim()
    if (!rendered.includes('先给出一个变化') || !rendered.includes('这一段最有力的地方') || !rendered.includes('再继续补充人物的往事。')) {
      throw new Error(`reading reply truncated: ${rendered.slice(0, 240)}`)
    }
    if (!reply.includes('先给出一个变化') || !reply.includes('这一段最有力的地方') || !reply.includes('再继续补充人物的往事。')) {
      throw new Error(`sendChat reply truncated: ${reply.slice(0, 240)}`)
    }
    await waitUntilIdle(page)
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
    const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
    if (await discard.isVisible({ timeout: 1_500 }).catch(() => false)) await discard.click()
    await confirmNovelPreset(page)
    await waitFor(async () => (await readActiveModel(page)).trigger.includes(REWRITE_MODEL_ID), 'new conversation uses default model', 20000)
    const priorPings = stub.requests.filter(item => item.kind === 'ping').length
    await waitUntilIdle(page)
    await page.getByRole('textbox', {name: '输入消息', exact: true}).fill(MARK.ping)
    await page.getByRole('textbox', {name: '输入消息', exact: true}).press('Enter')
    await waitFor(async () => stub.requests.filter(item => item.kind === 'ping').length > priorPings, 'first request from new conversation', 20000)
    const firstRequest = stub.requests.filter(item => item.kind === 'ping')[priorPings]
    if (firstRequest.model !== REWRITE_MODEL_ID) throw new Error(`new conversation did not use default model: ${firstRequest.model}`)
    return 'default applied to new conversation, existing chat untouched'
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
    const source = await readFile(new URL(import.meta.url), 'utf8')
    if (/toolChunks\([^;\n]*'novel_propose'/.test(source)) throw new Error('stub emits novel_propose outside the named legacy constant')
    if (!/kind === 'legacy_propose_edit_stale'[\s\S]{0,600}?toolChunks\(model, LEGACY_PROPOSE_TOOL/.test(source)) {
      throw new Error('legacy stub branch no longer emits the V1 novel_propose fixture')
    }
    if (/tools\.includes\('novel_propose'\)/.test(source)) throw new Error('classify still keys off novel_propose')
    const answerPendingFn = source.match(/async function answerPending\([\s\S]*?\nasync function /)?.[0] ?? ''
    if (answerPendingFn.includes('作者侧写建议')) {
      throw new Error('answerPending still depends on author-memory cards')
    }
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
  agentPreset: report.agentPreset,
  checks: report.checks,
  gaps: report.gaps,
  failures: report.failures,
  stub: { baseURL: report.stub.baseURL, requestCount: report.stub.requestCount, kinds: report.stub.kinds },
  presetIsolation: report.presetIsolation,
}, null, 2))
if (!report.ok) process.exitCode = 1
