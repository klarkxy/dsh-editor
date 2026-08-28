import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '.pack', 'shell-web-e2e')
const template = resolve(root, '.dev', 'desktop-profile-template')
const runtime = resolve(root, '.dev', 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')
const dshBaseEnv = { ...process.env }
delete dshBaseEnv.DEEPSEEK_API_KEY
delete dshBaseEnv.DSH_EDITOR_CUSTOM_API_KEY

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => resolvePromise())
      killer.on('exit', () => resolvePromise())
    })
  }
}

async function start(name, extraEnv) {
  const home = resolve(root, '.dev', 'shell-web-e2e-home', name)
  await deployProfile(home, template, resolve(runtime, 'node_modules'))
  const logs = []
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env: { ...dshBaseEnv, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolvePromise, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer)
      if (match) resolvePromise(new URL(match[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`DSH exited before readiness (${code}): ${logs.join('')}`)))
  })
  const url = await Promise.race([
    ready,
    delay(30_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('')}`) }),
  ])
  return { child, url }
}

async function inspectPhase(browser, name, extraEnv, assertion) {
  const { child, url } = await start(name, extraEnv)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserErrors.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  try {
    await page.goto(url.href)
    await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell, .settings-shell')), undefined, { timeout: 30_000 })
    await page.waitForTimeout(900)
    if (name === 'first-run-settings') {
      await page.getByLabel('自定义接口').check()
      await page.waitForTimeout(150)
    }
    const state = await page.evaluate(() => ({
      body: document.body.textContent ?? '',
      title: document.title,
      shell: Boolean(document.querySelector('.shell')),
      settings: Boolean(document.querySelector('.settings-shell .settings-view')),
      settingsBack: Boolean(document.querySelector('[aria-label="返回写作区"]')),
      settingsControl: Boolean(document.querySelector('[aria-label="设置"]')),
      permanentChat: Boolean(document.querySelector('.no-session > .chat')),
      officialHome: document.body.textContent?.includes('DeepSeek Harness') ?? false,
      editorName: Boolean(document.querySelector('.brand-lockup, .settings-brand')),
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    await page.screenshot({ path: resolve(output, `${name}.png`) })
    assertion(state)
    if (browserErrors.length) throw new Error(`browser errors: ${JSON.stringify(browserErrors)}`)
    return { name, url: url.origin, state: { ...state, body: undefined } }
  } finally {
    await page.close().catch(() => undefined)
    await stop(child)
  }
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const phases = []
  phases.push(await inspectPhase(browser, 'first-run-settings', {}, (state) => {
    const interfaces = state.body.includes('DeepSeek') && state.body.includes('自定义接口') && !state.body.includes('OpenAI')
    const forced = state.settings && !state.settingsBack && state.body.includes('接口地址') && state.body.includes('API Key') && state.body.includes('连接') && !state.body.includes('模型名称')
    if (!forced || !interfaces || state.shell || state.officialHome || !state.editorName) throw new Error('first-run settings assertion failed')
  }))
  phases.push(await inspectPhase(browser, 'configured-home', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, (state) => {
    const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
    if (!state.shell || state.settings || !state.editorName || state.officialHome || !onboarding || !state.settingsControl || state.permanentChat) throw new Error('configured home assertion failed')
  }))
  const report = { ok: true, source: 'private-dsh-profile-web', phases }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
