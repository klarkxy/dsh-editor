/** Independent npm-tarball acceptance on the native web profile, without Editor packages. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { S } from './helpers/selectors.mjs'

const root = resolve(import.meta.dirname, '..')
const stamp = String(Date.now())
const recordTitle = '独立安装记忆 ' + stamp
const home = process.env.AI_STANDALONE_HOME ? resolve(process.env.AI_STANDALONE_HOME) : resolve(root, '.dev', 'ai-standalone-' + stamp)
assert.ok(relative(resolve(root, '.dev'), home) && !relative(resolve(root, '.dev'), home).startsWith('..'), 'isolated home must be under .dev')
const output = resolve(root, 'e2e/out/ai-standalone', stamp)
const workspace = resolve(home, 'workspace')
await mkdir(workspace, { recursive: true })
const cli = process.env.DSH_CLI_PATH ? resolve(process.env.DSH_CLI_PATH) : resolve(root, '.dev/desktop-dsh-runtime-0.2.1-rc.5/lib/bin.js')
const staging = await mkdtemp(resolve(tmpdir(), 'dsh-ai-pack-'))
const ids = ['web-search-manager']
const fixtureVersions = { 'web-search-manager': '0.1.11' }
const fixtureManifests = new Map()
const report = { ok: false, home, output, checks: [], errors: [], calls: 0, observerCalls: 0, methodCalls: 0 }
const meaning = '我说的蓝图指事件结构，不是正文。'
const activity = '我最近正在修改第三章。'
const method = '以后修改正文前先读取最新版本，再核对修改范围。'
const method2 = '以后整理资料时先核对原始来源，再检查引用。'
function textOf(value) { return typeof value === 'string' ? value : Array.isArray(value) ? value.map(block => block.text ?? '').join('\n') : '' }
await mkdir(output, { recursive: true })
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_AI_TEST_KEY: 'local-fixture', SSH_CONNECTION: 'ai-standalone-acceptance' }
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
let browser, page, child, logs = []
const delay = ms => new Promise(done => setTimeout(done, ms))
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw || '{}')
  report.calls++
  const messages = body.messages ?? []
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join(' ')
  const input = messages.filter(m => m.role === 'user').map(m => textOf(m.content)).join('\n')
  let answer = '独立宿主测试回复。'
  if (system.includes('Name the current task')) answer = JSON.stringify({ type: 'discuss', summary: '独立插件' })
  else if (system.includes('Extract descriptive context')) {
    report.observerCalls++
    const data = JSON.parse(input)
    const original = (data.messages ?? []).find(row => row.text.includes(meaning))
    answer = JSON.stringify({ items: original ? [
      { kind: 'vocabulary', title: '蓝图的用法', content: '蓝图指事件结构，不是正文。', subject: 'user', domain: 'general', key: '蓝图', aliases: [], evidence: [{ seq: original.seq, quote: meaning }] },
      { kind: 'activity', title: '第三章当前工作', content: '用户正在修改第三章。', subject: 'user', domain: 'general', key: '第三章', aliases: [], activityStatus: 'in-progress', evidence: [{ seq: original.seq, quote: activity }] },
    ] : [] })
  }
  else if (system.includes('Extract at most one reusable PROCEDURAL')) {
    report.methodCalls++
    const data = JSON.parse(input)
    const quote = data.hint?.includes(method2) ? method2 : method
    answer = JSON.stringify({ kind: 'procedure', title: quote === method2 ? '核对资料来源' : '局部修改先读后核对', content: '', exceptions: [],
      procedure: { origin: 'instruction', goal: '保持修改与依据一致', when: ['修改正文或整理资料时'], steps: [quote], avoid: ['依靠过期信息覆盖当前资料'], verify: ['检查目标范围和来源是否正确'] }, evidenceQuotes: [quote] })
  }
  else if (system.includes('Consolidate descriptive context')) answer = '{"proposals":[]}'
  const common = { id: 'local-' + report.calls, created: 1, model: 'fixture' }
  const usage = { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 }
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage }))
  } else {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const delta of [{ role: 'assistant', content: answer }, {}]) res.write('data: ' + JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: delta.content ? null : 'stop' }], ...(!delta.content ? { usage } : {}) }) + '\n\n')
    res.end('data: [DONE]\n\n')
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
async function stopHost() {
  await page?.close().catch(() => {})
  if (child?.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(done => child.once('exit', done)), delay(2000)])
    if (child.exitCode === null && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  child?.stdout?.destroy(); child?.stderr?.destroy()
}
function command(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('DSH command failed: ' + args.join(' ') + '\n' + result.stderr + '\n' + result.stdout)
  return result.stdout
}
async function boot(label) {
  logs = []
  child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = new Promise((done, reject) => {
    const inspect = chunk => { logs.push(String(chunk)); const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(logs.join('')); if (match) done(match[0]) }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', reject); child.once('exit', code => reject(new Error('Host exited ' + code)))
  })
  let timer
  const url = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Host startup timeout')), 60000) })]).finally(() => clearTimeout(timer))
  page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '设置', exact: true }).waitFor()
  await page.getByRole('button', { name: '继续', exact: true }).waitFor({ timeout: 5000 }).catch(() => {})
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible() || !await next.isEnabled()) break
    await next.click(); await delay(500)
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.screenshot({ path: resolve(output, label + '.png'), fullPage: true })
}
async function settings() {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.locator(S.settingsDialog)
  await dialog.waitFor({ state: 'visible' }); return dialog
}
try {
  if (!process.env.AI_STANDALONE_HOME) {
    for (const id of ids) {
      console.log('install:' + id)
      // On-demand public plugin: acceptance installs its published npm artifact,
      // not a distribution pin, mirroring the plugin-matrix optional fixtures.
      const spec = '@klarkxy/dsh-' + id + '@' + fixtureVersions[id]
      const npm = process.env.npm_execpath
      assert.ok(npm, 'run the standalone acceptance through pnpm')
      const packed = spawnSync(process.execPath, [npm, 'exec', 'npm', 'pack', spec, '--ignore-scripts', '--json', '--pack-destination', staging], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 })
      assert.equal(packed.status, 0, 'optional fixture download failed: ' + packed.stderr)
      const archiveName = JSON.parse(packed.stdout)[0].filename
      const staged = resolve(staging, archiveName)
      const contents = spawnSync('tar', ['--force-local', '-xOf', staged.replaceAll('\\', '/'), 'package/package.json'], { encoding: 'utf8', windowsHide: true })
      assert.equal(contents.status, 0, 'cannot read optional fixture manifest')
      fixtureManifests.set('@klarkxy/dsh-' + id, JSON.parse(contents.stdout))
      command(['plugin', '--profile', 'web', 'add', 'file:' + staged.replaceAll('\\', '/')])
      {
        // Resolve this acceptance candidate from its exact archive.
        const localManifest = resolve(home, 'profiles/web/package.json')
        const value = JSON.parse(await readFile(localManifest, 'utf8'))
        value.pnpm = { ...value.pnpm, overrides: { ...value.pnpm?.overrides, ['@klarkxy/dsh-' + id]: 'file:' + staged.replaceAll('\\', '/') } }
        await writeFile(localManifest, JSON.stringify(value, null, 2) + '\n')
      }
    }
    report.checks.push('current web-search tarball installed through native plugin CLI in a fresh home')
  }
  const profileFile = resolve(home, 'profiles/web/package.json')
  const manifest = JSON.parse(await readFile(profileFile, 'utf8'))
  assert.ok(!Object.keys(manifest.dependencies).some(name => /(?:^|\/)dsh-editor/.test(name)))
  report.checks.push('native web profile has no private Editor dependency')
  const patch = resolve(home, 'profiles/web/cordis.patch.yml')
  const model = [
    '- id: llm-deepseek', '  disabled: true', '- id: llm-pi-ai', '  config:', '    providers:', '      local-test:',
    '        displayName: Local acceptance', '        api: openai-completions', '        baseURL: http://127.0.0.1:' + server.address().port + '/v1',
    '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:', '          - id: fixture', '            name: Fixture',
    '            contextWindow: 32768', '            maxTokens: 4096', '- id: agent-default-model', '  config:', '    provider: local-test', '    model: fixture',
  ].join('\n')
  await writeFile(patch, model + '\n')
  browser = await chromium.launch({ headless: true, ...(process.env.DSH_BROWSER_EXECUTABLE ? { executablePath: process.env.DSH_BROWSER_EXECUTABLE } : {}) })
  await boot('00-default-on')
  let entries = await page.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map(row => row.id) ?? [])
  const clientIds=[];for(const id of ids){const pkg=fixtureManifests.get('@klarkxy/dsh-'+id);if(pkg?.dsh?.client)clientIds.push(id);}
  const verifyLoaded=async()=>{
    for(const id of clientIds)assert.ok(entries.includes('@klarkxy/dsh-'+id),id+' client');
    for(const [channel,method] of [['/web-search-manager','status']]){
      const response=await page.request.post(new URL(channel+'/'+method,page.url()).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload:{sessionId:'session-standalone-probe'}}});assert.ok(response.ok(),channel);const value=(await response.json()).result;if(channel==='/dsh-mood'){assert.ok(value?.ok===true||value?.error?.code==='MOOD_SESSION_NOT_FOUND',JSON.stringify(value));}else assert.equal(value?.ok,true,channel+': '+JSON.stringify(value));
    }
  };await verifyLoaded();
  assert.equal(report.calls, 0)
  report.checks.push('independently installed web search start enabled without inference before a task')

  for(const id of ['ai-services','model-center','memory','self-improvement','fusion'])assert.equal(entries.includes('@klarkxy/dsh-'+id),false,id);
  await stopHost();await boot('01-restart');
  entries=await page.evaluate(()=>globalThis.__DSH_BOOT__?.entries?.map(row=>row.id)??[]);
  await verifyLoaded();
  assert.equal(report.calls,0);
  report.checks.push('restart keeps current public bundles loaded in native web without retired plugins, inference or private Editor packages');
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.ok=true;
} catch (error) {
  report.failure = String(error)
  if (page) {
    await writeFile(resolve(output, 'failure-dom.txt'), await page.locator(S.body).innerText()).catch(() => {})
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(resolve(output, 'host.log'), logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>'))
  await stopHost(); await browser?.close().catch(() => {})
  server.closeAllConnections()
  await new Promise(done => server.close(done))
  console.log(JSON.stringify(report))
}
