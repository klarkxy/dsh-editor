/** Standalone native Web Fusion acceptance from published-shape npm archives. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { chromium } from 'playwright'
import { FusionModelFixture } from './fusion-fixture.mjs'

const root = resolve(import.meta.dirname, '..')
const stamp = String(Date.now())
const home = resolve(root, '.dev', 'fusion-standalone-' + stamp)
const workspace = resolve(home, 'workspace')
const output = resolve(root, 'e2e/out/fusion', 'standalone-' + stamp)
const runtime = resolve(root, '.dev/desktop-dsh-runtime-0.1.7-alpha.1')
const cli = resolve(runtime, 'lib/bin.js')
const report = { ok: false, home, output, checks: [], errors: [], stage: 'setup' }
const fixture = new FusionModelFixture()
const logs = []
const requests = []
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_AI_TEST_KEY: 'local-fixture', SSH_CONNECTION: 'fusion-standalone-acceptance' }
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
env.DSH_AI_TEST_KEY = 'local-fixture'
let browser, page, child, baseUrl, sessionId
let phase = { name: 'idle', step: 0 }
let currentCandidate
let heldTakeoverTask, releaseHeldTakeover, pendingTakeoverCancel
const resultText = 'Standalone native Web Fusion result.\n'
const takeoverText = 'Native Lead takeover completed in the same turn.\n'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitUntil(read, predicate, label, timeout = 45_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await delay(150)
  }
  throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(last)?.slice(0, 1000))
}
function command(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 5 * 1024 * 1024 })
  assert.equal(result.status, 0, 'native CLI ' + args.join(' ') + '\n' + result.stderr + '\n' + result.stdout)
  return result.stdout
}
function textOf(call) { return call.messages.map(message => message.text).join('\n') }
const takeoverCancel = task => ({ tool: 'fusion_cancel', arguments: { taskId: task.id, taskRevision: task.revision } })
function directTask(call) {
  const messages = call.messages.filter(message => message.role === 'user' &&
    (message.text.startsWith('Fusion task ') || /^Agent .* sent a message: Fusion task /.test(message.text)))
  const match = [...(messages.at(-1)?.text ?? '').matchAll(/Fusion task ([^;\s]+); revision (\d+); dispatch ([^\s.]+)/g)].at(-1)
  return match && { id: match[1], revision: Number(match[2]) }
}
fixture.responder = call => {
  const all = textOf(call)
  if (all.includes('Name the current task')) return { text: JSON.stringify({ type: 'discuss', summary: 'Generic Fusion acceptance' }) }
  if (call.tools.includes('fusion_report') && !call.tools.includes('fusion_delegate')) {
    assert.equal(call.model, 'fixture-child')
    const task = directTask(call)
    if (!task) return { text: 'Waiting for native task.' }
    const reportId = task.id + ':' + task.revision
    if (phase.name === 'takeover') {
      heldTakeoverTask = task
      const deferred = new Promise(resolve => { releaseHeldTakeover = resolve })
      return deferred
    }
    assert.ok(call.tools.includes('write'), 'generic Sidekick retains native write capability')
    if (!fixture.toolCalls.some(row => row.name === 'write' && row.arguments?.file_path === 'fusion-result.txt'))
      return { tool: 'write', arguments: { file_path: 'fusion-result.txt', content: resultText } }
    if (fixture.toolCalls.some(row => row.name === 'fusion_report' && row.arguments?.reportId === reportId)) return { text: 'Reported.' }
    return { tool: 'fusion_report', arguments: { taskId: task.id, taskRevision: task.revision, reportId,
      kind: 'candidate', text: 'GENERIC_RESULT_WITH_EVIDENCE', report: 'Verified from isolated workspace note.' } }
  }
  if (!call.tools.includes('fusion_delegate')) return { text: 'Generic fixture ready.' }
  if (phase.name === 'delegate' && phase.step++ === 0) return { tool: 'fusion_delegate', arguments: {
    title: 'Create a workspace result', goal: 'Write fusion-result.txt using the native write tool and report evidence', context: 'The current workspace contains note.txt.',
    constraints: ['Keep changes within this workspace'], acceptance: ['The result file exists with exact requested content'],
  } }
  if (phase.name === 'takeover') {
    const step = phase.step++
    if (step === 0) return { tool: 'fusion_delegate', arguments: {
      title: 'Take over an active generic task', goal: 'Stop the active Sidekick and write takeover.txt as Lead in this same turn',
      context: 'Only use the isolated current workspace.', constraints: ['Cancel before takeover'],
      acceptance: ['Native Lead writes exact takeover result after cancellation'],
    } }
    if (step === 1) return new Promise(resolve => { pendingTakeoverCancel = resolve })
    if (step === 2) return { tool: 'write', arguments: { file_path: 'takeover.txt', content: takeoverText } }
    return { text: 'Lead completed the native write after explicit takeover.' }
  }
  if (phase.name === 'accept') {
    if (phase.step++ === 0) return { tool: 'fusion_read', arguments: { taskId: currentCandidate.task.id, candidateId: currentCandidate.candidate.id } }
    if (phase.step === 2) {
      assert.ok(call.messages.findLast(message => message.role === 'tool')?.text.includes(currentCandidate.candidate.text))
      return { tool: 'fusion_review', arguments: { taskId: currentCandidate.task.id, taskRevision: currentCandidate.task.revision,
        candidateId: currentCandidate.candidate.id, hash: currentCandidate.candidate.hash, verdict: 'accept', feedback: 'Generic result checked.' } }
    }
  }
  return { text: 'Generic Fusion task complete.' }
}
async function stop() {
  if (child?.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
    if (child.exitCode === null && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  child?.stdout?.destroy(); child?.stderr?.destroy()
}
async function boot(label) {
  child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  baseUrl = await new Promise((resolveUrl, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Host startup timeout: ' + buffer.slice(-1000))), 60_000)
    const inspect = chunk => {
      buffer += String(chunk); logs.push(String(chunk))
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) { clearTimeout(timer); resolveUrl(match[0]) }
    }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error('Host exited ' + code + ': ' + buffer.slice(-1000))) })
  })
  page = await browser.newPage({ viewport: { width: 1360, height: 950 }, locale: 'en-US' })
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST') { try { requests.push({ ...request.postDataJSON(), __path: new URL(request.url()).pathname }) } catch {} } })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor()
  const notice = page.getByRole('button', { name: 'Continue', exact: true })
  await notice.waitFor({ timeout: 5000 }).catch(() => {})
  for (let n = 0; n < 5 && await notice.isVisible(); n++) {
    await waitUntil(() => notice.isEnabled(), Boolean, 'native welcome Continue enabled', 12_000)
    await notice.click()
    await waitUntil(async () => !await notice.isVisible() ||
      await page.getByText('The acknowledgement could not be saved. Please try again.', { exact: true }).isVisible(),
    Boolean, 'welcome dismissal or explicit error', 12_000)
  }
  assert.equal(await notice.isVisible(), false, 'native welcome notice must be dismissed before conversation use')
  const later = page.getByRole('button', { name: 'Configure later', exact: true })
  if (await later.isVisible()) await later.click()
  await page.screenshot({ path: resolve(output, label + '.png'), fullPage: true })
}
async function rpc(channel, method, payload = {}) {
  const response = await page.request.post(new URL(channel + '/' + method, baseUrl).href,
    { data: { type: 'client-request', rpcId: 'fusion-standalone-' + Math.random(), method, payload } })
  assert.ok(response.ok(), method + ': HTTP ' + response.status())
  const result = (await response.json()).result
  assert.ok(result?.ok, method + ': ' + JSON.stringify(result))
  return result.value
}
async function workspaceSessionId() {
  const directory = resolve(home, 'storages/session_projcache/sessions')
  const names = await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const matches = []
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const projection = JSON.parse(await readFile(resolve(directory, name), 'utf8'))
    const cwd = projection.record?.identity?.cwd
    if (typeof cwd === 'string' && resolve(cwd).toLowerCase() === resolve(workspace).toLowerCase())
      matches.push(name.slice(0, -'.json'.length))
  }
  assert.ok(matches.length <= 1, 'exact isolated workspace must resolve to one native Lead session')
  return matches[0]
}
async function status() { return rpc('/dsh-fusion', 'status', { sessionId }) }
async function leadEvents() {
  const directory = resolve(home, 'sessions')
  const files = await readdir(directory, { recursive: true })
  const relative = files.find(file => file.replaceAll('\\', '/').endsWith('/' + sessionId + '/session.v4.jsonl.zstd'))
  assert.ok(relative, 'native Lead session log must exist')
  const source = await readFile(resolve(directory, relative))
  const frames = []
  let offset = 0
  while (offset < source.length) {
    const result = zstdDecompressSync(source.subarray(offset), { info: true })
    const consumed = result.engine.bytesWritten
    assert.ok(consumed > 0 && consumed <= source.length - offset, 'native Zstd decoder must consume one bounded frame')
    frames.push(result.buffer)
    offset += consumed
  }
  return Buffer.concat(frames).toString('utf8').trim().split('\n').map(line => JSON.parse(line))
}
async function send(text) {
  const composer = page.locator('textarea:not([disabled]),[contenteditable="true"]').first()
  await composer.fill(text)
  await composer.press('Enter')
}
async function checkNativeCard(card, theme) {
  const style = await card.evaluate(element => {
    const pixels = value => Number.parseFloat(value) || 0
    const cardStyle = getComputedStyle(element)
    const headerStyle = getComputedStyle(element.querySelector('.dsh-fusion-head'))
    const button = element.querySelector('button')
    const buttonStyle = getComputedStyle(button)
    return {
      paddingTop: pixels(cardStyle.paddingTop), paddingLeft: pixels(cardStyle.paddingLeft),
      headerGap: pixels(headerStyle.columnGap), borderWidth: pixels(cardStyle.borderTopWidth),
      borderStyle: cardStyle.borderTopStyle, background: cardStyle.backgroundColor,
      buttonHeight: button.getBoundingClientRect().height, buttonPadding: pixels(buttonStyle.paddingLeft),
      buttonBorder: pixels(buttonStyle.borderTopWidth), buttonBorderStyle: buttonStyle.borderTopStyle,
      buttonBackground: buttonStyle.backgroundColor, buttonColor: buttonStyle.color,
    }
  })
  assert.ok(style.paddingTop >= 8 && style.paddingLeft >= 8, 'native task card needs real interior spacing')
  assert.ok(style.headerGap >= 4, 'native task card title/status/actions need header spacing')
  assert.ok(style.borderWidth >= 1 && style.borderStyle === 'solid', 'native task card needs a visible border')
  assert.ok(style.background !== 'rgba(0, 0, 0, 0)', 'native task card needs a visible background')
  assert.ok(style.buttonHeight >= 32 && style.buttonPadding >= 4, 'native task card buttons need visible size and spacing')
  assert.ok(style.buttonBorder >= 1 && style.buttonBorderStyle === 'solid', 'native task card buttons need visible borders')
  assert.ok(style.buttonBackground !== 'rgba(0, 0, 0, 0)' && style.buttonBackground !== style.buttonColor,
    'native task card buttons need a distinguishable painted surface')
  report.nativeCardStyles ??= {}
  report.nativeCardStyles[theme] = style
}
try {
  await mkdir(workspace, { recursive: true })
  await mkdir(output, { recursive: true })
  const provider = await fixture.start()
  for (const [name, version] of [['ai-services', '0.1.2'], ['fusion', '0.1.0']]) {
    const archive = resolve(root, '.pack', 'klarkxy-dsh-' + name + '-' + version + '.tgz')
    await readFile(archive)
    command(['plugin', '--profile', 'web', 'add', 'file:' + archive.replaceAll('\\', '/')])
    const profile = resolve(home, 'profiles/web/package.json')
    const manifest = JSON.parse(await readFile(profile, 'utf8'))
    manifest.pnpm = { ...manifest.pnpm, overrides: { ...manifest.pnpm?.overrides,
      ['@klarkxy/dsh-' + name]: 'file:' + archive.replaceAll('\\', '/') } }
    await writeFile(profile, JSON.stringify(manifest, null, 2) + '\n')
  }
  const manifest = JSON.parse(await readFile(resolve(home, 'profiles/web/package.json'), 'utf8'))
  assert.ok(!Object.keys(manifest.dependencies).some(name => name.startsWith('dsh-editor')))
  const patch = resolve(home, 'profiles/web/cordis.patch.yml')
  await writeFile(patch, (await readFile(patch, 'utf8')).replace(/^\[\]\s*$/m, ''))
  await appendFile(patch, [
    '\n- id: llm-deepseek', '  disabled: true', '- id: llm-pi-ai', '  config:', '    providers:',
    '      local-test:', '        displayName: Local acceptance', '        api: openai-completions',
    '        baseURL: ' + provider, '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:',
    '          - id: fixture-lead', '            name: Fixture Lead', '            contextWindow: 32768', '            maxTokens: 4096',
    '          - id: fixture-child', '            name: Fixture Child', '            contextWindow: 32768', '            maxTokens: 4096',
    '- id: agent-default-model', '  config:', '    provider: local-test', '    model: fixture-lead', '',
  ].join('\n'))
  browser = await chromium.launch({ headless: true })
  report.stage = 'default-off'
  await boot('00-default-off')
  assert.equal(fixture.calls.length, 0)
  await page.close(); await stop()
  await appendFile(patch, '\n- id: fusion\n  disabled: false\n')
  report.checks.push('current npm archives installed into independent native Web profile, default-off boot caused no inference')
  report.stage = 'generic-enable'
  await boot('01-enabled')
  const policy = await rpc('/dsh-ai-services', 'status')
  const { revision, ...data } = policy.policy
  await rpc('/dsh-ai-services', 'update', { expectedRevision: revision,
    policy: { ...data, purposes: { ...data.purposes,
      'fusion.sidekick': { kind: 'model', provider: 'local-test', model: 'fixture-child' } } } })
  await writeFile(resolve(workspace, 'note.txt'), 'Standalone native Web Fusion note.\n')
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
  const addEntry = page.getByText('Add workspace…', { exact: true })
  if (await addEntry.isVisible()) await addEntry.click()
  const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
  await picker.waitFor()
  await picker.getByRole('button', { name: 'Edit path', exact: true }).click()
  const pathInput = picker.getByRole('textbox', { name: 'Edit path', exact: true })
  await pathInput.fill(workspace)
  await pathInput.press('Enter')
  await pathInput.waitFor({ state: 'detached' })
  await picker.getByRole('button', { name: 'Open', exact: true }).click()
  await picker.waitFor({ state: 'detached' })
  const composer = page.locator('textarea:not([disabled]),[contenteditable="true"]').first()
  await composer.waitFor({ state: 'visible', timeout: 30_000 })
  await send('FUSION_GENERIC_SETUP')
  sessionId = await waitUntil(workspaceSessionId, Boolean, 'generic Lead session in isolated workspace')
  report.sessionIdentity = { source: 'native projection', sessionId, workspace }
  let state = await waitUntil(status, row => row.profile === 'generic' && row.configured, 'generic Fusion status')
  assert.equal(state.pair, undefined)
  report.checks.push('native Web generic Lead session has no private Editor dependency or writing adoption')

  report.stage = 'generic-delegate'
  phase = { name: 'delegate', step: 0 }
  await send('FUSION_GENERIC_DELEGATE: have Sidekick write the isolated workspace result and report evidence.')
  state = await waitUntil(status, row => row.pair?.tasks?.at(-1)?.state === 'review', 'generic Sidekick report')
  assert.equal(state.pair.route.model, 'fixture-child')
  assert.equal(state.pair.tasks.at(-1).candidates.at(-1).text, 'GENERIC_RESULT_WITH_EVIDENCE')
  assert.equal(await readFile(resolve(workspace, 'fusion-result.txt'), 'utf8'), resultText, 'generic native Writer write must finish before model review')
  currentCandidate = { task: state.pair.tasks.at(-1), candidate: state.pair.tasks.at(-1).candidates.at(-1) }
  phase = { name: 'accept', step: 0 }
  await send('FUSION_GENERIC_ACCEPT: read the exact result, then accept model review.')
  state = await waitUntil(status, row => row.pair?.tasks?.at(-1)?.state === 'accepted', 'generic accepted result')
  assert.equal(state.pair.tasks.at(-1).adoption, undefined)
  assert.equal(await readFile(resolve(workspace, 'note.txt'), 'utf8'), 'Standalone native Web Fusion note.\n')
  assert.equal(await readFile(resolve(workspace, 'fusion-result.txt'), 'utf8'), resultText, 'generic accepted result requires no author adoption')
  const card = page.locator('.dsh-fusion-card.is-native').first()
  await card.waitFor({ timeout: 30_000 })
  await page.emulateMedia({ colorScheme: 'light' })
  await waitUntil(() => page.locator('body[data-ds-dark-theme]').count(), count => count === 0, 'native light palette')
  await checkNativeCard(card, 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await waitUntil(() => page.locator('body[data-ds-dark-theme]').count(), count => count === 1, 'native dark palette')
  await checkNativeCard(card, 'dark')
  await page.screenshot({ path: resolve(output, '02a-native-task-dark.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'light' })
  await waitUntil(() => page.locator('body[data-ds-dark-theme]').count(), count => count === 0, 'native light palette restored')
  await card.getByRole('button', { name: 'Details', exact: true }).click()
  await card.getByRole('button', { name: 'Open Sidekick session', exact: true }).click()
  const childSidebar = page.locator('[data-sidebar-chat]')
  await childSidebar.waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await childSidebar.locator('.dsh-fusion-card').count(), 0, 'child sidebar must not render a Lead Fusion card')
  assert.ok(!(await childSidebar.innerText()).includes('The native session is not loaded'), 'child sidebar must not show a Fusion status error')
  await page.screenshot({ path: resolve(output, '02-native-task-and-child.png'), fullPage: true })
  assert.equal(await card.getByRole('button', { name: 'Preview adoption' }).count(), 0)
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
  for (const name of ['fusion_delegate', 'write', 'fusion_report', 'fusion_read', 'fusion_review'])
    assert.ok(fixture.toolCalls.some(row => row.name === name), name + ' must be a native model tool call')
  report.native = { leadSessionId: sessionId, childSessionId: state.pair.childSessionId, taskId: state.pair.tasks.at(-1).id,
    messageIds: state.pair.tasks.at(-1).messageIds, reportIds: state.pair.tasks.at(-1).reportIds, route: state.pair.route }
  report.checks.push('native Web card has visible computed styling; child sidebar has no recursive Fusion card or status error')
  report.checks.push('native Web task card, child-session navigation, generic native write/report/review, and no manuscript adoption')
  report.stage = 'generic-takeover'
  await waitUntil(status, row => row.activity?.lead === 'idle' && row.activity?.sidekick === 'idle', 'native pair idle before takeover')
  const nativeLeadBefore = fixture.calls.filter(call => call.model === 'fixture-lead' && call.tools.length > 0).length
  phase = { name: 'takeover', step: 0 }
  await send('FUSION_GENERIC_TAKEOVER: delegate a new task, then cancel its active Sidekick and complete takeover.txt yourself in this same turn.')
  const takeoverTask = await waitUntil(() => heldTakeoverTask, Boolean, 'generic Sidekick inference held for takeover')
  let takeoverState = await waitUntil(status, row => row.pair?.tasks?.at(-1)?.id === takeoverTask.id &&
    row.pair.tasks.at(-1).state === 'working', 'generic takeover task working')
  assert.equal(takeoverState.pair.childSessionId, state.pair.childSessionId, 'same persistent native Sidekick is reused')
  const releaseLeadCancel = await waitUntil(() => pendingTakeoverCancel, Boolean, 'Lead cancel model response gated until child working')
  releaseLeadCancel(takeoverCancel(takeoverTask))
  pendingTakeoverCancel = undefined
  await waitUntil(async () => readFile(resolve(workspace, 'takeover.txt'), 'utf8').catch(() => undefined),
    text => text === takeoverText, 'native Lead takeover write')
  takeoverState = await waitUntil(status, row => row.pair?.tasks?.at(-1)?.id === takeoverTask.id &&
    row.pair.tasks.at(-1).state === 'cancelled' && row.pair.tasks.at(-1).cleanup === 'done', 'cancelled Sidekick cleanup')
  assert.equal(takeoverState.pair.tasks.at(-1).candidates.length, 0)
  assert.equal(takeoverState.pair.tasks.at(-1).reportIds.length, 0)
  assert.ok(releaseHeldTakeover, 'child model response remains gated until after native cancellation')
  releaseHeldTakeover({ tool: 'fusion_report', arguments: {
    taskId: takeoverTask.id, taskRevision: takeoverTask.revision, reportId: takeoverTask.id + ':late',
    kind: 'candidate', text: 'STALE_GENERIC_TAKEOVER', report: 'Late child output after native Lead takeover',
  } })
  releaseHeldTakeover = undefined
  await delay(1000)
  takeoverState = await status()
  assert.equal(takeoverState.pair.tasks.at(-1).state, 'cancelled')
  assert.equal(takeoverState.pair.tasks.at(-1).candidates.length, 0)
  assert.equal(takeoverState.pair.tasks.at(-1).reportIds.length, 0)
  assert.equal(await readFile(resolve(workspace, 'takeover.txt'), 'utf8'), takeoverText)
  const nativeLeadAfter = fixture.calls.filter(call => call.model === 'fixture-lead' && call.tools.length > 0).length
  assert.ok(nativeLeadAfter >= nativeLeadBefore + 3, 'Lead must make delegate, cancel and write model steps')
  await waitUntil(status, row => row.activity?.lead === 'idle', 'Lead takeover turn settled')
  await page.screenshot({ path: resolve(output, '03-native-same-turn-takeover.png'), fullPage: true })
  await page.close()
  await stop() // Flush the native append journal into the compressed session log before turn-ID assertions.

  const events = await waitUntil(async () => leadEvents().catch(() => []), rows => {
    const calls = rows.filter(row => row.type === 'tool/call')
    return calls.some(row => row.data.name === 'fusion_cancel' && JSON.parse(row.data.arguments).taskId === takeoverTask.id) &&
      calls.some(row => row.data.name === 'write' && JSON.parse(row.data.arguments).file_path === 'takeover.txt')
  }, 'durable native cancel/write tool receipts')
  const cancelCall = events.find(row => row.type === 'tool/call' && row.data.name === 'fusion_cancel' &&
    JSON.parse(row.data.arguments).taskId === takeoverTask.id)
  const writeCall = events.find(row => row.type === 'tool/call' && row.data.name === 'write' &&
    JSON.parse(row.data.arguments).file_path === 'takeover.txt')
  assert.equal(cancelCall.data.turn, writeCall.data.turn, 'fusion_cancel and native write must share one Lead turn')
  const turnStart = events.find(row => row.type === 'turn/start' && row.data.turn === cancelCall.data.turn)
  const turnEnd = events.find(row => row.type === 'turn/end' && row.data.turn === cancelCall.data.turn)
  assert.ok(turnEnd, 'durable native takeover turn must end after Host flush')
  assert.equal(turnEnd.data.reason.kind, 'completed')
  const turnEvents = events.filter(row => row.seq > turnStart.seq && row.seq < turnEnd.seq)
  const humanMessages = turnEvents.filter(row => row.type === 'user/message' && row.data.source?.kind === 'user')
  assert.equal(humanMessages.length, 1, 'takeover must require exactly one human turn')
  assert.ok(humanMessages[0].data.content.some(block => block.text?.includes('FUSION_GENERIC_TAKEOVER')))
  report.native.takeover = { taskId: takeoverTask.id, turn: cancelCall.data.turn, cancelSeq: cancelCall.seq,
    writeSeq: writeCall.seq, completedSeq: turnEnd.seq }
  report.checks.push('active generic Sidekick cancelled; Lead native write completed in same turn, late child report ignored, no author adoption or extra human turn')
  report.ok = true
} catch (error) {
  report.failure = error?.stack ?? String(error)
  process.exitCode = 1
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(resolve(output, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {})
  }
} finally {
  releaseHeldTakeover?.({ text: 'Fixture cleanup after native cancellation.' })
  pendingTakeoverCancel?.({ text: 'Fixture cleanup.' })
  await page?.close().catch(() => {})
  await stop()
  await browser?.close().catch(() => {})
  await fixture.close().catch(() => {})
  report.calls = fixture.calls.map(call => ({ model: call.model, tools: call.tools, messages: call.messages.map(message => ({ role: message.role, text: message.text.slice(-1200) })) }))
  report.toolCalls = fixture.toolCalls
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {})
  await writeFile(resolve(output, 'host.log'), logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>')).catch(() => {})
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, output, failure: report.failure }))
}
