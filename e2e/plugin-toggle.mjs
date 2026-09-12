import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'

const root = resolve(import.meta.dirname, '..')
const nonce = new Date().toISOString().replace(/[:.]/g, '-')
const home = resolve(root, '.dev', `plugin-toggle-${nonce}`)
const output = resolve(root, 'e2e/out/plugin-toggle', nonce)
const runtime = resolve(root, '.dev/desktop-dsh-runtime')
await mkdir(output, {recursive: true})
await deployProfile(home, resolve(root, '.dev/desktop-profile-template'), resolve(runtime, 'node_modules'))
const report = {checks: [], home, ok: false}
let child, browser, page
const env = {...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1'}
for (const key of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY']) delete env[key]
async function start() {
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
  return new Promise((done, reject) => {
    let log = ''
    const timer = setTimeout(() => reject(new Error('host startup timeout')), 60000)
    const inspect = chunk => {
      log += String(chunk)
      const url = log.match(/https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/)
      if (url) {clearTimeout(timer); done(new URL(url[0]))}
    }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', error => {clearTimeout(timer); reject(error)})
    child.once('exit', code => {clearTimeout(timer); reject(new Error(`host exited ${code}`))})
  })
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(done => child.once('exit', done))
  child.kill('SIGTERM')
  await exited
}
async function rpc(url, method, payload = {}) {
  if (!browser) {browser = await chromium.launch({headless: true}); page = await browser.newPage()}
  if (new URL(page.url()).origin !== url.origin) {
    await page.goto(url.href)
    await page.locator('.shell').waitFor({timeout: 45000})
  }
  const result = await page.evaluate(async ({method, payload}) => {
    const res = await fetch(`/dsh-editor-plugins/${method}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({type: 'client-request', rpcId: crypto.randomUUID(), method, payload})})
    return (await res.json()).result
  }, {method, payload})
  assert.equal(result?.ok, true, JSON.stringify(result))
  return result.value
}

try {
  let url = await start()
  let inventory = await rpc(url, 'inventory.list')
  const targets = inventory.optional.filter(card => card.packageName === 'dsh-zhihu')
  assert(targets.length >= 2, 'real runtime includes Zhihu UI and tools')
  for (const card of targets) {
    assert(card.entryId.startsWith('include:'))
    const receipt = await rpc(url, 'entry.setEnabled', {entryId: card.entryId, enabled: false})
    assert.equal(receipt.restartRequired, false)
  }
  inventory = await rpc(url, 'inventory.list')
  assert(inventory.optional.filter(card => card.packageName === 'dsh-zhihu').every(card => !card.enabled))
  report.checks.push('real include IDs disable all Zhihu entries immediately')
  const patch = await readFile(resolve(home, 'cordis.patch.yml'), 'utf8')
  assert(!patch.includes('include:'))
  await stop()
  url = await start()
  inventory = await rpc(url, 'inventory.list')
  const restarted = inventory.optional.filter(card => card.packageName === 'dsh-zhihu')
  assert.equal(restarted.length, targets.length)
  assert(restarted.every(card => !card.enabled))
  report.checks.push('disabled state persists across host restart')
  for (const card of restarted) await rpc(url, 'entry.setEnabled', {entryId: card.entryId, enabled: true})
  inventory = await rpc(url, 'inventory.list')
  assert(inventory.optional.filter(card => card.packageName === 'dsh-zhihu').every(card => card.enabled))
  report.checks.push('all feature entries can be enabled again')
  report.ok = true
} catch (error) {report.error = String(error); process.exitCode = 1}
finally {await browser?.close(); await stop(); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))}
