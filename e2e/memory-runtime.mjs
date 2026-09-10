/** Real DSH process + filesystem + tools + replay; the model is a deterministic test adapter. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { desktopComposition, configureProfile } from '../scripts/desktop-compositions.mjs'

const root = resolve(import.meta.dirname, '..')
const runRoot = resolve(root, '.dev', `memory-runtime-${Date.now()}`)
const home = join(runRoot, 'home')
const workspace = join(runRoot, 'book')
const template = join(runRoot, 'template')
const runtime = resolve(root, '.dev/desktop-dsh-runtime')
const output = resolve(root, 'e2e/out/memory-runtime')
const id = randomUUID()
const report = { ok: false, mode: 'real DSH runtime with scripted model; no external inference', workspace, checks: [] }
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
let child, base
const log = []
async function boot() {
  const env = { ...process.env, DSH_HOME: home, DSH_EDITOR_PROJECTS_ROOT: runRoot, NO_PROXY: 'localhost,127.0.0.1,::1' }
  delete env.DSH_PROFILES
  child = spawn(process.execPath, [join(runtime, 'lib/bin.js'), '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  const ready = new Promise((resolvePromise, reject) => {
    const inspect = chunk => { const text = String(chunk); log.push(text); buffer += text; const found = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer); if (found) resolvePromise(found[0].replace(/\/$/, '')) }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', reject); child.once('exit', code => reject(new Error(`Host exit ${code}: ${buffer.slice(-3000)}`)))
  })
  let timer
  try { base = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Host readiness timed out: ${buffer.slice(-3000)}`)), 45000) })]) } finally { clearTimeout(timer) }
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const target = child
  target.kill('SIGTERM')
  await Promise.race([new Promise(r => target.once('exit', r)), delay(4000)])
  if (target.exitCode === null && target.pid) await new Promise(r => { const killer = spawn('taskkill', ['/pid', String(target.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.once('exit', r); killer.once('error', r) })
  child = undefined
}
async function rpc(channel, method, payload) {
  const response = await fetch(`${base}${channel}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(45000) })
  const body = await response.json()
  assert.equal(body.result?.ok, true, JSON.stringify(body))
  return body.result.value
}
const workbench = (method, payload = {}) => rpc('/dsh-editor-workbench', method, { sessionId: id, ...payload })
function check(name) { report.checks.push(name); console.log(`[memory-runtime] ${name}`) }

await mkdir(output, { recursive: true })
await mkdir(join(workspace, '正文'), { recursive: true })
await mkdir(join(workspace, '世界书'), { recursive: true })
await writeFile(join(workspace, 'AGENTS.md'), '# 项目规则\nRULES_LITERAL {{model}}\n')
await Promise.all(Array.from({ length: 999 }, (_, i) => writeFile(join(workspace, '正文', `${String(i + 1).padStart(4, '0')}.md`), '# 普通章节\n这里没有目标事实。')))
await writeFile(join(workspace, '正文/1000.md'), `${'这是测试用的较长前文，用来验证范围读取不受旧版六千字符的限制。\n'.repeat(350)}远章证据：林舟出生于雾港。\n`)
await Promise.all(Array.from({ length: 300 }, (_, i) => writeFile(join(workspace, '世界书', `资料${i}.md`), `# 无关资料\nNEVER_AUTOINJECT_${i}\n`)))
await cp(resolve(root, 'apps/desktop/resources/profile'), template, { recursive: true })
const composition = await desktopComposition()
await configureProfile(template, composition)
for (const name of composition.packages) await cp(resolve(root, 'packages', name), join(template, 'node_modules', name), { recursive: true, filter: source => !source.replaceAll('\\', '/').includes('/node_modules/') && !source.replaceAll('\\', '/').includes('/src/') && !source.replaceAll('\\', '/').includes('/test/') })
await deployProfile(home, template, join(runtime, 'node_modules'))
const patchPath = join(home, 'profiles/dsh-editor/cordis.patch.yml')
await writeFile(patchPath, `${await readFile(patchPath, 'utf8')}\n- insert:\n    - id: memory-runtime-probe\n      name: ${JSON.stringify(pathToFileURL(resolve(root, 'e2e/memory-runtime-probe.mjs')).href)}\n`)
try {
  await boot()
  await rpc('/memory-probe', 'start', { workspace, sessionId: id })
  check('real session created in isolated workspace')
  const task = await workbench('context.compile', { userRequest: '只改一句话', activePath: '正文/1000.md' })
  assert.equal(JSON.parse(task.serialized).version, 3)
  assert.ok(!task.serialized.includes('NEVER_AUTOINJECT'))
  check('task packet contains no fixed files or worldbook material')
  const fact = await rpc('/memory-probe', 'run', { mode: 'fact' })
  assert.equal(fact.errors.length, 0, JSON.stringify(fact.errors))
  assert.equal(fact.receipts.at(-1)?.status, 'applied', JSON.stringify(fact))
  const factId = fact.receipts.at(-1).id
  assert.ok((await readFile(join(workspace, '世界书/林舟.md'), 'utf8')).includes('正文/1000.md'))
  check('native grep finds chapter 1000, range read passes 6000 chars, maintenance writes sourced fact')
  const rule = await rpc('/memory-probe', 'run', { mode: 'rule' })
  assert.equal(rule.receipts.at(-1)?.status, 'applied', JSON.stringify(rule))
  check('explicit long-term rule is appended through actual model tool loop')
  const edit = await rpc('/memory-probe', 'run', { mode: 'edit' })
  assert.equal(edit.receipts.at(-1)?.status, 'pending', JSON.stringify(edit))
  const pendingId = edit.receipts.at(-1).id
  assert.ok(!(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).includes('使用第一人称'))
  assert.equal((await workbench('memory.apply', { id: pendingId })).status, 'applied')
  check('revision waits for confirmation and applies via the persistent receipt')
  await rpc('/manuscript', 'fim.complete', { sessionId: id, path: '正文/1000.md', prefix: '林舟走进', suffix: '', authorPreferences: '保持简练。', projectRules: 'FORGED_CLIENT_RULES' })
  await rpc('/manuscript', 'patch.complete', { sessionId: id, path: '正文/1000.md', selectedText: '林舟出生于雾港。', before: '', after: '', instruction: '改得简练', authorPreferences: '保持简练。', projectRules: 'FORGED_CLIENT_RULES' })
  check('real FIM and rewrite calls load project rules on the server')
  const before = await rpc('/memory-probe', 'inspect', {})
  await writeFile(join(output, 'requests-before-restart.json'), JSON.stringify(before, null, 2))
  await rpc('/memory-probe', 'stop', {})
  await stop()
  await boot()
  await rpc('/memory-probe', 'start', { workspace, sessionId: id, resume: true })
  const history = await workbench('memory.list')
  assert.ok(history.items.some(item => item.id === factId && item.status === 'applied'))
  const undone = await workbench('memory.undo', { id: factId })
  assert.equal(undone.status, 'undone')
  check('real process restart preserves history and can archive-undo a created fact')
  await rpc('/memory-probe', 'run', { mode: 'inspect' })
  const after = await rpc('/memory-probe', 'inspect', {})
  assert.ok(after.requests.at(-1).system.includes('使用第一人称'))
  assert.equal(after.requests.at(-1).system.split('RULES_LITERAL {{model}}').length - 1, 1)
  check('resumed model request uses current literal project rules exactly once')
  await writeFile(join(output, 'requests-after-restart.json'), JSON.stringify(after, null, 2))
  report.sessionId = id
  report.ok = true
} catch (error) {
  report.error = error.stack ?? String(error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  await stop()
  await writeFile(join(output, 'host.log'), log.join(''))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
}
