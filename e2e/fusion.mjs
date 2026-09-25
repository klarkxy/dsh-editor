/** Real native Fusion acceptance: isolated DSH home, local model, browser and HTTP RPC. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { FusionModelFixture } from './fusion-fixture.mjs'

const root = resolve(import.meta.dirname, '..')
const stamp = String(Date.now())
const runtime = resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2')
const home = resolve(root, '.dev', `fusion-${stamp}`)
const output = resolve(root, 'e2e/out/fusion', stamp)
const projectName = `Fusion 验收 ${stamp}`
const project = resolve(home, 'projects', projectName)
const chapter = resolve(project, '正文', '001.md')
const original = '夜雨落在窗沿。她把旧信放回抽屉。'
const draft = '夜雨落在窗沿。她将旧信藏进抽屉，指尖还留着纸的凉意。'
const finalText = '夜雨落在窗沿。她将旧信藏进抽屉，听见走廊里有人停下脚步。'
const secondText = '她抬眼望向走廊，旧信仍在抽屉里。'
const thirdText = '门外脚步远去，她才松开握紧的手。'
const taskOrder = new Map()
const report = { ok: false, stage: 'setup', home, output, checks: [], calls: [], errors: [], screenshots: [] }
const logs = []
const fixture = new FusionModelFixture()
let child, browser, page, baseUrl
let phase = { name: 'idle', step: 0 }
let expectedChildModel = 'fixture-child'
let writingTarget
let sessionId
let heldTaskId, releaseHeld
const requests = []
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'), SSH_CONNECTION: 'fusion-native-acceptance' }
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
env.DSH_AI_TEST_KEY = 'local-fixture'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const allText = call => call.messages.map(message => message.text).join('\n')
const latestToolResult = call => call.messages.findLast(message => message.role === 'tool')?.text ?? ''
const hasTool = (call, name) => call.tools.includes(name)
// Main native Lead requests advertise a nonempty tool registry. Auxiliary title,
// mood, recap and memory model requests in this local fixture advertise no tools.
// Count every child-route request: after disable its Fusion tool may be unregistered.
const nativeLeadCalls = () => fixture.calls.filter(call => call.model === 'fixture-lead' && call.tools.length > 0).length
const nativeChildCalls = () => fixture.calls.filter(call => call.model === expectedChildModel).length
const taskMarker = text => {
  const match = [...text.matchAll(/Fusion task ([^;\s]+); revision (\d+); dispatch ([^\s.]+)/g)].at(-1)
  return match && { taskId: match[1], taskRevision: Number(match[2]), dispatchId: match[3] }
}
const candidateFromStatus = () => {
  const task = report.latestStatus?.pair?.tasks?.at(-1)
  const candidate = task?.candidates?.at(-1)
  assert.ok(task && candidate, 'a stored Writer candidate is required')
  return { task, candidate }
}

fixture.responder = call => {
  const text = allText(call)
  if (text.includes('Name the current task')) return { text: JSON.stringify({ type: 'discuss', summary: 'Fusion 验收' }) }
  if (call.model === expectedChildModel || (hasTool(call, 'fusion_report') && !hasTool(call, 'fusion_delegate'))) {
    assert.ok(hasTool(call, 'fusion_report'), 'native child must receive fusion_report')
    assert.ok(!hasTool(call, 'fusion_delegate') && !hasTool(call, 'fusion_review'), 'child must not receive Lead controls')
    const marker = call.messages.filter(message => message.role === 'user' && (message.text.startsWith('Fusion task ') || /^Agent .* sent a message: Fusion task /.test(message.text))).map(message => taskMarker(message.text)).filter(Boolean).at(-1)
    if (!marker) return { text: 'Waiting for a Fusion task.' }
    const reportKey = `${marker.taskId}:${marker.taskRevision}`
    if (!taskOrder.has(marker.taskId)) taskOrder.set(marker.taskId, taskOrder.size + 1)
    if (fixture.toolCalls.some(item => item.name === 'fusion_report' && item.arguments?.reportId === reportKey)) return { text: 'Reported exact candidate to Lead.' }
    const order = taskOrder.get(marker.taskId)
    if (['interrupt', 'active-stop', 'active-disable'].includes(phase.name) && marker.taskRevision === 1) {
      heldTaskId = marker.taskId
      return new Promise(resolve => { releaseHeld = resolve })
    }
    const prose = order === 1 ? (marker.taskRevision === 1 ? draft : finalText) : order === 2 ? secondText : thirdText
    return { tool: 'fusion_report', arguments: { taskId: marker.taskId, taskRevision: marker.taskRevision,
      reportId: reportKey, kind: 'candidate', text: prose, report: `Writer revision ${marker.taskRevision}` } }
  }
  if (!hasTool(call, 'fusion_delegate')) return { text: 'Fusion fixture ready.' }
  if (['delegate', 'next', 'cold-resume', 'interrupt', 'active-stop', 'active-disable'].includes(phase.name) && phase.step++ === 0) return { tool: 'fusion_delegate', arguments: {
    title: '修订一段正文', goal: '为已有正文写一个待作者确认的精确候选', context: '原文：' + original,
    constraints: ['保留人物动作与事实'], acceptance: ['只提交候选，不写入正文'],
    target: writingTarget,
  } }
  if (['revise', 'accept'].includes(phase.name)) {
    const { task, candidate } = candidateFromStatus()
    if (phase.step++ === 0) return { tool: 'fusion_read', arguments: { taskId: task.id, candidateId: candidate.id } }
    if (phase.step === 2) {
      assert.ok(latestToolResult(call).includes(candidate.text), 'Lead must receive exact Writer text from fusion_read')
      return { tool: 'fusion_review', arguments: { taskId: task.id, taskRevision: task.revision,
        candidateId: candidate.id, hash: candidate.hash, verdict: phase.name === 'revise' ? 'revise' : 'accept',
        feedback: phase.name === 'revise' ? '保留场景，加入走廊里的脚步声。' : '审阅通过，交由作者决定是否采用。' } }
    }
  }
  return { text: `Fusion ${phase.name} phase complete.` }
}

async function waitUntil(read, predicate, label, timeout = 45_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await delay(150)
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)?.slice(0, 1000)}`)
}
async function screenshot(name) {
  if (!page) return
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
  report.screenshots.push(name)
}
async function stopHost() {
  if (child?.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
    if (child.exitCode === null && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  child?.stdout?.destroy(); child?.stderr?.destroy()
}
async function boot(profile = 'dsh-editor', cwd = root) {
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', profile, '--host', '127.0.0.1', '--port', '0', '--no-open'],
    { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  baseUrl = await new Promise((resolveUrl, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`Host startup timeout: ${buffer.slice(-1000)}`)), 60_000)
    const inspect = chunk => {
      buffer += String(chunk); logs.push(String(chunk))
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) { clearTimeout(timer); resolveUrl(match[0]) }
    }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}: ${buffer.slice(-1000)}`)) })
  })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20_000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST') { try { requests.push({ ...request.postDataJSON(), __path: new URL(request.url()).pathname }) } catch {} } })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator(profile === 'dsh-editor' ? '.shell' : 'body').waitFor({ timeout: 60_000 })
  for (let n = 0; n < 5; n++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible()) break
    await next.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
}
async function rpcOn(channel, method, payload = {}, { allowError = false } = {}) {
  const response = await page.request.post(new URL(channel + '/' + method, baseUrl).href,
    { data: { type: 'client-request', rpcId: `fusion-e2e-${Date.now()}-${Math.random()}`, method, payload } })
  if (!response.ok() && allowError && [404, 405].includes(response.status())) return { ok: false, httpStatus: response.status() }
  assert.ok(response.ok(), `${method}: HTTP ${response.status()}`)
  const result = (await response.json()).result
  assert.ok(result && (allowError || result.ok), `${method}: ${JSON.stringify(result)}`)
  return allowError ? result : result.value
}
const rpc = (method, payload, options) => rpcOn('/dsh-fusion', method, payload, options)
async function status(sessionId) {
  const value = await rpc('status', { sessionId })
  report.latestStatus = value
  return value
}
async function waitTask(sessionId, predicate, label) {
  return waitUntil(() => status(sessionId), value => predicate(value.pair?.tasks?.at(-1), value), label)
}
async function sendEditor(text) {
  const composer = page.getByRole('textbox', { name: '输入消息', exact: true })
  await composer.fill(text)
  await composer.press('Enter')
}
async function storedTask(taskId) {
  const record = JSON.parse(await readFile(resolve(home, 'storages/dsh_fusion.json'), 'utf8'))
  return record.tables?.state?.state?.pairs?.find(pair => pair.leadSessionId === sessionId)?.tasks?.find(task => task.id === taskId)
}

try {
  await mkdir(output, { recursive: true })
  const provider = await fixture.start()
  await deployProfile(home, resolve(root, '.dev/desktop-profile-template'), resolve(runtime, 'node_modules'))
  const patch = resolve(home, 'profiles/dsh-editor/cordis.patch.yml')
  if ((await readFile(patch, 'utf8')).trim() === '[]') await writeFile(patch, '')
  await appendFile(patch, [
    '\n- id: llm-deepseek', '  disabled: true', '- id: llm-pi-ai', '  config:', '    providers:',
    '      local-test:', '        displayName: Local Fusion acceptance', '        api: openai-completions',
    `        baseURL: ${provider}`, '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:',
    '          - id: fixture-lead', '            name: Fixture Lead', '            contextWindow: 32768', '            maxTokens: 4096',
    '          - id: fixture-child', '            name: Fixture Child', '            contextWindow: 32768', '            maxTokens: 4096',
    '- id: agent-default-model', '  config:', '    provider: local-test', '    model: fixture-lead', '',
  ].join('\n'))
  browser = await chromium.launch({ headless: true })
  await boot()
  report.stage = 'default-off'
  assert.equal(fixture.calls.length, 0, 'opening the Editor must not infer before author action')
  report.checks.push('isolated Editor boot with local-only provider and no background inference')

  const policy = await rpcOn('/dsh-ai-services', 'status')
  const { revision, ...data } = policy.policy
  await rpcOn('/dsh-ai-services', 'update', { expectedRevision: revision,
    policy: { ...data, purposes: { ...data.purposes,
      'fusion.sidekick': { kind: 'model', provider: 'local-test', model: expectedChildModel },
    } },
  })
  const routed = await rpcOn('/dsh-ai-services', 'resolve', { purpose: 'fusion.sidekick' })
  assert.equal(routed.model, expectedChildModel)
  report.checks.push('Fusion Sidekick route configured to distinct local fixture model')

  report.stage = 'editor-project'
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const newProject = page.getByRole('dialog', { name: '新建作品' })
  await newProject.waitFor()
  await newProject.getByLabel('作品名称').fill(projectName)
  await newProject.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator('.tree').waitFor({ timeout: 30_000 })
  const launcher = page.getByRole('button', { name: '打开写作搭档', exact: true })
  if (await launcher.isVisible()) await launcher.click()
  await page.locator('aside.chat').waitFor()
  await sendEditor('Fusion native acceptance session setup.')
  sessionId = await waitUntil(async () => requests.map(row => row?.payload?.sessionId).filter(Boolean).at(-1), Boolean, 'native Lead session id')
  const tree = page.locator('.tree')
  const treeBox = await tree.boundingBox()
  assert.ok(treeBox, 'project tree must be visible')
  await tree.click({ button: 'right', position: { x: 16, y: Math.max(12, treeBox.height - 18) } })
  await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '新建文件夹' }).click()
  const newFolder = page.getByRole('dialog', { name: '新建文件夹', exact: true })
  await newFolder.getByLabel('文件夹名称').fill('正文')
  await newFolder.getByRole('button', { name: '创建', exact: true }).click()
  const folderRow = page.locator('.tree-row').filter({ hasText: '正文' }).first()
  await folderRow.waitFor()
  await folderRow.hover()
  await page.getByRole('button', { name: '在 正文 中新建文件', exact: true }).click()
  const newFile = page.getByRole('dialog', { name: '新建文件', exact: true })
  await newFile.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001')
  await newFile.getByRole('button', { name: '创建', exact: true }).click()
  const manuscript = page.getByTestId('paper-editor').locator('.cm-content')
  await manuscript.waitFor()
  await manuscript.click()
  await page.keyboard.insertText(original)
  await page.keyboard.press('Control+s')
  await waitUntil(() => readFile(chapter, 'utf8'), text => text === original, 'author baseline saved to disk')
  await page.getByTestId('paper-save-state').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await readFile(chapter, 'utf8'), original)
  const receipt = await rpcOn('/manuscript', 'file.read', { sessionId, path: '正文/001.md' })
  assert.equal(receipt.text, original)
  writingTarget = { kind: 'edit', path: '正文/001.md', oldText: original, targetVersion: receipt.version }
  assert.equal(await page.locator('.dsh-fusion-card').count(), 0, 'disabled Fusion must not show an error or task card')
  const statusBeforeEnable = requests.filter(row => row?.__path === '/dsh-fusion/status' && row?.payload?.sessionId === sessionId).length
  await delay(3000)
  assert.equal(fixture.calls.filter(call => call.model === expectedChildModel).length, 0, 'disabled Fusion must not create Sidekick inference')
  assert.equal(requests.filter(row => row?.__path === '/dsh-fusion/status' && row?.payload?.sessionId === sessionId).length, statusBeforeEnable,
    'disabled Fusion must not poll status continuously')
  report.stage = 'editor-enable'
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  await dialog.waitFor()
  await dialog.getByRole('tab', { name: '插件', exact: true }).click()
  const inferenceBeforeEnable = fixture.calls.length
  const toggle = dialog.locator('[role="switch"][data-testid$="-fusion"]')
  await toggle.waitFor()
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'Fusion must be default-off')
  await toggle.click()
  await waitUntil(() => toggle.getAttribute('aria-checked'), value => value === 'true', 'Fusion enabled switch')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(fixture.calls.length, inferenceBeforeEnable, 'enabling Fusion must not itself start inference')
  report.checks.push('Fusion defaults off and enables without inference in the normal Editor plugin composition')

  await waitUntil(async () => {
    const result = await rpc('status', { sessionId }, { allowError: true })
    if (!result.ok) {
      assert.ok([404, 405].includes(result.httpStatus), 'Fusion enable readiness returned unexpected error: ' + JSON.stringify(result))
      return undefined
    }
    report.latestStatus = result.value
    return result.value
  }, value => value?.available && value.profile === 'writing' && value.configured, 'Fusion writing status')
  report.checks.push('real writing Lead session and versioned original manuscript receipt established')

  report.stage = 'delegate'
  phase = { name: 'delegate', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_DELEGATE: delegate the versioned paragraph to Writer. Do not write the file.')
  let state = await waitTask(sessionId, task => task?.state === 'review' && task.candidates.length === 1, 'Writer first candidate')
  let pair = state.pair, task = pair.tasks.at(-1)
  const firstChildId = pair.childSessionId
  assert.equal(pair.route.model, expectedChildModel)
  assert.equal(task.candidates[0].text, draft)
  assert.equal(await readFile(chapter, 'utf8'), original)
  assert.ok((await page.getByTestId('paper-editor').locator('.cm-content').innerText()).includes(original), 'visible paper must still show original before adoption')
  await screenshot('01-writer-candidate')
  report.checks.push('Lead used fusion_delegate; native persistent Writer used fusion_report; exact candidate stored without file mutation')

  report.stage = 'revise'
  phase = { name: 'revise', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_REVISE: read and review the exact Writer candidate; request one concrete revision.')
  state = await waitTask(sessionId, row => row?.state === 'review' && row.revision === 2 && row.candidates.length === 2, 'Writer revised candidate')
  pair = state.pair; task = pair.tasks.at(-1)
  assert.equal(task.candidates[1].text, finalText)
  assert.equal(pair.childSessionId, firstChildId)
  assert.equal(await readFile(chapter, 'utf8'), original)
  report.checks.push('Lead used fusion_read and fusion_review revise; same native child reported a second exact candidate')

  report.stage = 'accept'
  phase = { name: 'accept', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_ACCEPT: read the revised exact candidate, then accept model review. Leave author adoption pending.')
  state = await waitTask(sessionId, row => row?.state === 'accepted' && row.adoption === 'pending', 'Lead accepted candidate')
  pair = state.pair; task = pair.tasks.at(-1)
  assert.equal(task.candidates.at(-1).text, finalText)
  assert.equal(await readFile(chapter, 'utf8'), original)
  await screenshot('02-author-adoption-pending')
  await page.locator('.chrome .theme-toggle').click()
  await page.locator('html[data-theme="dark"]').waitFor()
  await screenshot('02a-author-adoption-dark')
  await page.locator('.chrome .theme-toggle').click()
  await page.locator('html[data-theme="light"]').waitFor()
  report.checks.push('model acceptance leaves original manuscript unchanged and author adoption pending')

  report.stage = 'author-adopt'
  const card = page.locator('.dsh-fusion-card').filter({ hasText: '修订一段正文' }).first()
  await card.waitFor({ timeout: 30_000 })
  const previewButton = card.getByRole('button', { name: '预览采用', exact: true })
  await previewButton.click()
  const previewDialog = page.getByRole('dialog', { name: '审阅写入内容', exact: true })
  await previewDialog.waitFor()
  assert.ok((await previewDialog.innerText()).includes(original))
  assert.ok((await previewDialog.innerText()).includes(finalText))
  await screenshot('03-exact-preview')
  await page.keyboard.press('Escape')
  await previewDialog.waitFor({ state: 'detached' })
  assert.equal(await previewButton.evaluate(element => document.activeElement === element), true, 'preview Escape returns focus to trigger')
  await previewButton.click()
  await previewDialog.waitFor()
  await page.setViewportSize({ width: 760, height: 900 })
  await screenshot('03a-narrow-preview')
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('03b-mobile-preview')
  const previewBox = await previewDialog.boundingBox()
  assert.ok(previewBox && previewBox.x >= -1 && previewBox.x + previewBox.width <= 391, 'preview stays within narrow viewport')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await previewDialog.getByRole('button', { name: '确认采用', exact: true }).click()
  await previewDialog.waitFor({ state: 'detached' })
  state = await waitTask(sessionId, row => row?.adoption === 'applied', 'author applied exact candidate')
  assert.equal(await readFile(chapter, 'utf8'), finalText)
  await waitUntil(() => page.getByTestId('paper-editor').locator('.cm-content').innerText(), value => value.includes(finalText), 'visible manuscript updated after author adoption')
  assert.equal(state.pair.tasks.at(-1).application?.candidateHash, task.candidates.at(-1).hash)
  await screenshot('04-applied')
  report.checks.push('author previewed original and exact Writer text, clicked apply, and Host wrote only that candidate')

  const names = fixture.toolCalls.map(call => call.name)
  for (const name of ['fusion_delegate', 'fusion_report', 'fusion_read', 'fusion_review']) assert.ok(names.includes(name), name + ' must be a real model tool call')
  assert.equal(fixture.toolCalls.filter(call => call.name === 'fusion_report').length, 2)
  assert.ok(fixture.calls.filter(call => call.tools.includes('fusion_report')).every(call => call.model === expectedChildModel))
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
  report.checks.push('native model requests advertised role-scoped tools and used the pinned child model')
  report.stage = 'next-task'
  const updated = await rpcOn('/manuscript', 'file.read', { sessionId, path: '正文/001.md' })
  assert.equal(updated.text, finalText)
  writingTarget = { kind: 'edit', path: '正文/001.md', oldText: finalText, targetVersion: updated.version }
  phase = { name: 'next', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_NEXT: delegate a new task to the existing Writer in this same Lead conversation.')
  state = await waitTask(sessionId, row => row?.state === 'review' && row.candidates.at(-1)?.text === secondText, 'second task candidate')
  pair = state.pair; task = pair.tasks.at(-1)
  assert.equal(pair.childSessionId, firstChildId)
  assert.equal(pair.tasks.length, 2)
  phase = { name: 'accept', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_ACCEPT: read the current Writer candidate, then accept model review.')
  state = await waitTask(sessionId, row => row?.state === 'accepted' && row.adoption === 'pending', 'second task accepted')
  task = state.pair.tasks.at(-1)
  await rpc('dismiss', { sessionId, taskId: task.id, taskRevision: task.revision,
    candidateId: task.candidates.at(-1).id, hash: task.candidates.at(-1).hash })
  assert.equal(await readFile(chapter, 'utf8'), finalText)
  report.checks.push('next delegated task reused the same native child and dismissed candidate left manuscript unchanged')

  report.stage = 'cold-restart'
  const childCallsBeforeRestart = fixture.calls.filter(call => call.model === expectedChildModel).length
  await page.close()
  await stopHost()
  await boot()
  const recent = page.locator('.home-recent').getByRole('button', { name: projectName, exact: true }).first()
  if (await recent.isVisible()) await recent.click()
  await page.locator('.tree').waitFor({ timeout: 30_000 })
  const reopenedLauncher = page.getByRole('button', { name: '打开写作搭档', exact: true })
  if (await reopenedLauncher.isVisible()) await reopenedLauncher.click()
  await page.locator('aside.chat').waitFor()
  await page.locator('.conversation-select .select-trigger').click()
  await page.locator('.select-option[data-value="v:' + sessionId + '"]').click()
  await waitUntil(() => status(sessionId), value => value.pair?.childSessionId === firstChildId, 'restored native Lead and pair')
  assert.equal(fixture.calls.filter(call => call.model === expectedChildModel).length, childCallsBeforeRestart,
    'cold status read must not resume child inference')
  await screenshot('05-restored-pair')
  report.checks.push('process restart restored exact Lead/child identity without status-triggered inference')

  report.stage = 'cold-resume'
  const resumed = await rpcOn('/manuscript', 'file.read', { sessionId, path: '正文/001.md' })
  writingTarget = { kind: 'edit', path: '正文/001.md', oldText: finalText, targetVersion: resumed.version }
  phase = { name: 'cold-resume', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_COLD_RESUME: delegate another task to the same persistent Writer after process restart.')
  state = await waitTask(sessionId, row => row?.state === 'review' && row.candidates.at(-1)?.text === thirdText, 'cold-resumed Writer candidate')
  pair = state.pair; task = pair.tasks.at(-1)
  assert.equal(pair.childSessionId, firstChildId)
  assert.equal(pair.tasks.length, 3)
  assert.equal(await readFile(chapter, 'utf8'), finalText)
  await screenshot('06-cold-resumed-candidate')
  report.checks.push('native sendMessage cold-resumed the same child session and produced a new task candidate')

  report.stage = 'interrupt-cold-restore'
  await waitUntil(() => status(sessionId), value => value.activity?.lead === 'idle' && value.activity?.sidekick === 'idle', 'native idle before third task Stop')
  const beforeFirstStop = { lead: nativeLeadCalls(), child: nativeChildCalls() }
  await page.locator('.dsh-fusion-card').filter({ hasText: '修订一段正文' }).first().getByRole('button', { name: '停止协作任务', exact: true }).click()
  await waitTask(sessionId, row => row?.state === 'cancelled' && row.cleanup === 'done', 'third task stopped')
  await delay(1500)
  assert.deepEqual({ lead: nativeLeadCalls(), child: nativeChildCalls() }, beforeFirstStop, 'idle Stop must not wake native Lead or Writer')
  phase = { name: 'interrupt', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_INTERRUPT: delegate another bounded writing task.')
  await waitUntil(() => heldTaskId, Boolean, 'fourth child request held before its response')
  state = await waitTask(sessionId, row => row?.id === heldTaskId && row.state === 'working', 'durable interrupted task')
  assert.equal(state.pair.childSessionId, firstChildId)
  await waitUntil(() => status(sessionId), value => value.activity?.lead === 'idle', 'Lead idle before simulated process loss')
  const beforeInterruptedRestart = fixture.calls.filter(call => call.model === expectedChildModel).length
  await page.close(); await stopHost()
  phase = { name: 'resumed-interrupted', step: 0 }
  releaseHeld({ text: 'Process was stopped before this response.' }); releaseHeld = undefined
  await boot()
  const reopenedProject = page.locator('.home-recent').getByRole('button', { name: projectName, exact: true }).first()
  if (await reopenedProject.isVisible()) await reopenedProject.click()
  await page.locator('.tree').waitFor({ timeout: 30_000 })
  const restoredLauncher = page.getByRole('button', { name: '打开写作搭档', exact: true })
  if (await restoredLauncher.isVisible()) await restoredLauncher.click()
  await page.locator('aside.chat').waitFor()
  await page.locator('.conversation-select .select-trigger').click()
  await page.locator('.select-option[data-value="v:' + sessionId + '"]').click()
  state = await waitTask(sessionId, row => row?.id === heldTaskId && row.state === 'interrupted', 'passively restored interrupted task')
  assert.equal(fixture.calls.filter(call => call.model === expectedChildModel).length, beforeInterruptedRestart,
    'opening interrupted task must not auto-resume Writer')
  const interruptedCard = page.locator('.dsh-fusion-card').filter({ hasText: '修订一段正文' }).first()
  await interruptedCard.locator('.dsh-fusion-resume textarea').fill('已核对执行记录。继续原任务，只提交候选，不写入正文。')
  await interruptedCard.getByRole('button', { name: '继续协作', exact: true }).click()
  state = await waitTask(sessionId, row => row?.id === heldTaskId && row.revision === 2 && row.state === 'review', 'explicit card resume after process loss')
  assert.equal(state.pair.childSessionId, firstChildId)
  assert.equal(await readFile(chapter, 'utf8'), finalText)
  await screenshot('07-interrupted-task-resumed')
  report.checks.push('interrupted task restored without inference and card feedback resumed the same task and native child without a user chat turn')

  report.stage = 'stop-resumed-task'
  const taskCard = page.locator('.dsh-fusion-card').filter({ hasText: '修订一段正文' }).first()
  await waitUntil(() => status(sessionId), value => value.activity?.lead === 'idle' && value.activity?.sidekick === 'idle', 'native idle before resumed-task Stop')
  const beforeFinalStop = { lead: nativeLeadCalls(), child: nativeChildCalls() }
  await taskCard.getByRole('button', { name: '停止协作任务', exact: true }).click()
  state = await waitTask(sessionId, row => row?.state === 'cancelled' && row.cleanup === 'done', 'resumed task cancellation cleanup')
  await waitUntil(() => status(sessionId), value => value.activity?.lead === 'idle' && value.activity?.sidekick === 'idle', 'native idle after resumed-task Stop')
  await delay(1500)
  assert.deepEqual({ lead: nativeLeadCalls(), child: nativeChildCalls() }, beforeFinalStop, 'idle Stop must not start native Lead or Writer inference')

  report.stage = 'active-stop'
  heldTaskId = undefined
  phase = { name: 'active-stop', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_ACTIVE_STOP: delegate a bounded task; I will stop it while Writer inference is active.')
  const activeStopId = await waitUntil(() => heldTaskId, Boolean, 'active Stop child provider request held')
  state = await waitTask(sessionId, row => row?.id === activeStopId && row.state === 'working', 'active Stop task working')
  assert.equal(state.pair.childSessionId, firstChildId)
  assert.equal(state.pair.tasks.length, 5)
  assert.equal(state.pair.tasks.at(-1).candidates.length, 0)
  await waitUntil(() => status(sessionId), value => value.activity?.lead === 'idle', 'Lead idle while Stop child inference held')
  const activeStopRevision = state.pair.tasks.at(-1).revision
  const leadBeforeActiveStop = nativeLeadCalls()
  const childBeforeActiveStop = nativeChildCalls()
  const stopButton = page.locator('.dsh-fusion-card').filter({ hasText: '修订一段正文' }).first().getByRole('button', { name: '停止协作任务', exact: true })
  await stopButton.click()
  state = await waitTask(sessionId, row => row?.id === activeStopId && row.state === 'cancelled' && row.cleanup === 'done', 'active task Stop cleanup')
  await page.locator('.dsh-fusion-card').filter({ hasText: '修订一段正文' }).first().locator('.dsh-fusion-state').filter({ hasText: '已停止' }).waitFor()
  assert.ok(releaseHeld, 'held provider response must remain available after Stop')
  releaseHeld({ tool: 'fusion_report', arguments: {
    taskId: activeStopId, taskRevision: activeStopRevision, reportId: activeStopId + ':late-stop',
    kind: 'candidate', text: 'STALE_AFTER_STOP', report: 'Late provider result after Stop',
  } })
  releaseHeld = undefined
  await delay(1500)
  state = await status(sessionId)
  task = state.pair.tasks.at(-1)
  assert.equal(task.id, activeStopId)
  assert.equal(task.state, 'cancelled')
  assert.equal(task.candidates.length, 0)
  assert.equal(task.reportIds.length, 0)
  assert.equal(nativeLeadCalls(), leadBeforeActiveStop, 'late Stop result must not wake native Lead')
  assert.equal(nativeChildCalls(), childBeforeActiveStop, 'late Stop result must not restart native Writer')
  assert.equal(await readFile(chapter, 'utf8'), finalText)
  report.checks.push('Stop during held native Writer inference cancelled visible task; released stale report caused no candidate, Lead wake or file mutation')

  report.stage = 'active-disable'
  heldTaskId = undefined
  phase = { name: 'active-disable', step: 0 }
  await sendEditor('FUSION_ACCEPTANCE_ACTIVE_DISABLE: delegate another bounded task; I will disable Fusion during Writer inference.')
  const activeDisableId = await waitUntil(() => heldTaskId, Boolean, 'active disable child provider request held')
  state = await waitTask(sessionId, row => row?.id === activeDisableId && row.state === 'working', 'active disable task working')
  assert.equal(state.pair.childSessionId, firstChildId)
  assert.equal(state.pair.tasks.length, 6)
  assert.equal(state.pair.tasks.at(-1).candidates.length, 0)
  await waitUntil(() => status(sessionId), value => value.activity?.lead === 'idle', 'Lead idle while disabled child inference held')
  const activeDisableRevision = state.pair.tasks.at(-1).revision
  const leadBeforeDisable = nativeLeadCalls()
  const childBeforeDisable = nativeChildCalls()
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('tab', { name: '插件', exact: true }).click()
  const enabled = settings.locator('[role="switch"][data-testid$="-fusion"]')
  assert.equal(await enabled.getAttribute('aria-checked'), 'true')
  await enabled.click()
  await waitUntil(() => enabled.getAttribute('aria-checked'), value => value === 'false', 'Fusion disabled during active inference')
  assert.ok(releaseHeld, 'held provider response must remain available after disable')
  releaseHeld({ tool: 'fusion_report', arguments: {
    taskId: activeDisableId, taskRevision: activeDisableRevision, reportId: activeDisableId + ':late-disable',
    kind: 'candidate', text: 'STALE_AFTER_DISABLE', report: 'Late provider result after disable',
  } })
  releaseHeld = undefined
  const persistedDisabled = await waitUntil(() => storedTask(activeDisableId),
    row => row?.state === 'cancelled' && row.cleanup === 'done', 'durable disabled task cleanup')
  assert.equal(persistedDisabled.candidates.length, 0)
  assert.equal(persistedDisabled.reportIds.length, 0)
  const disabled = await rpc('status', { sessionId }, { allowError: true })
  assert.equal(disabled.ok, false)
  assert.ok(disabled.error?.code === 'DISABLED' || [404, 405].includes(disabled.httpStatus), 'disabled plugin must reject or unregister its RPC')
  await waitUntil(() => page.locator('.dsh-fusion-card').count(), count => count === 0, 'disabled Fusion card unmounted')
  const statusBeforeDisabledIdle = requests.filter(row => row?.__path === '/dsh-fusion/status' && row?.payload?.sessionId === sessionId).length
  await delay(3000)
  assert.equal(nativeLeadCalls(), leadBeforeDisable, 'late disabled result must not wake native Lead')
  assert.equal(nativeChildCalls(), childBeforeDisable, 'late disabled result must not restart native Writer')
  assert.equal(requests.filter(row => row?.__path === '/dsh-fusion/status' && row?.payload?.sessionId === sessionId).length, statusBeforeDisabledIdle,
    'disabled Fusion must not keep polling status')
  assert.equal(await readFile(chapter, 'utf8'), finalText)
  report.checks.push('disabling during held native Writer inference cleaned durable task, unmounted UI and rejected stale result without Lead wake or file mutation')
  report.ok = true
} catch (error) {
  report.failure = error?.stack ?? String(error)
  process.exitCode = 1
  await screenshot('failure').catch(() => {})
  if (page) await writeFile(resolve(output, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {})
} finally {
  releaseHeld?.({ text: 'Test cleanup.' })
  report.calls = fixture.calls.map(call => ({ model: call.model, tools: call.tools, messages: call.messages.map(message => ({ role: message.role, text: message.text.slice(-1200), name: message.name })) }))
  report.toolCalls = fixture.toolCalls
  report.modelSummary = { nativeLeadCalls: nativeLeadCalls(), nativeChildCalls: nativeChildCalls(),
    auxiliaryCalls: fixture.calls.length - nativeLeadCalls() - nativeChildCalls() }
  await page?.close().catch(() => {})
  await stopHost()
  await browser?.close().catch(() => {})
  await fixture.close().catch(() => {})
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {})
  await writeFile(resolve(output, 'host.log'), logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>')).catch(() => {})
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, output, failure: report.failure }))
}
