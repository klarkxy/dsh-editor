import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => resolvePromise())
      killer.on('exit', () => resolvePromise())
    })
    return
  }
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited) child.kill('SIGKILL')
}

async function start(name, extraEnv) {
  const home = resolve(root, '.dev', 'shell-web-e2e-home', name)
  await rm(home, { recursive: true, force: true })
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
    try {
      await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 30_000 })
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        title: document.title,
        body: document.body.textContent,
        bootEntries: globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id),
      }))
      throw new Error(`private shell did not mount: ${JSON.stringify({ diagnostic, browserErrors })}; ${error instanceof Error ? error.message : String(error)}`)
    }
    await page.waitForTimeout(900)
    const continueNotice = page.getByRole('button', { name: '继续', exact: true })
    for (let step = 0; step < 5 && await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false); step += 1) {
      await continueNotice.click()
      await page.waitForTimeout(150)
    }
    const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
    if (await configureLater.count()) {
      await configureLater.click()
      await page.waitForTimeout(150)
    }
    try {
      await page.getByRole('button', { name: '设置' }).click({ timeout: 5_000 })
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        body: document.body.textContent,
        buttons: [...document.querySelectorAll('button')].map((button) => ({ text: button.textContent, aria: button.getAttribute('aria-label') })),
        slots: [...document.querySelectorAll('[data-slot]')].map((node) => node.getAttribute('data-slot')),
      }))
      throw new Error(`native settings trigger is missing: ${JSON.stringify({ diagnostic, browserErrors })}; ${error instanceof Error ? error.message : String(error)}`)
    }
    const settings = page.getByRole('dialog')
    await settings.waitFor({ state: 'visible' })
    const models = settings.getByRole('button', { name: '模型', exact: true })
    const writing = settings.getByRole('button', { name: '写作', exact: true })
    await models.click()
    const modelsVisible = await models.isVisible()
    await writing.click()
    const writingVisible = await page.getByRole('heading', { name: '写作', exact: true }).isVisible()
    const pageState = await page.evaluate(() => ({
      body: document.body.textContent ?? '',
      title: document.title,
      shell: Boolean(document.querySelector('.shell')),
      settings: Boolean(document.querySelector('[role="dialog"]')),
      settingsControl: [...document.querySelectorAll('.native-settings-control button')].some((button) => button.textContent?.includes('设置')),
      permanentChat: Boolean(document.querySelector('.no-session > .chat')),
      officialHome: document.body.textContent?.includes('DeepSeek Harness') ?? false,
      editorName: Boolean(document.querySelector('.brand-lockup')),
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    const state = { ...pageState, modelsVisible, writingVisible }
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
  phases.push(await inspectPhase(browser, 'first-run-home', {}, (state) => {
    const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
    if (!state.shell || !state.settings || !state.modelsVisible || !state.writingVisible || state.officialHome || !state.editorName || !onboarding || !state.settingsControl) throw new Error('first-run native settings assertion failed')
  }))
  phases.push(await inspectPhase(browser, 'configured-home', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, (state) => {
    const onboarding = state.body.includes('新建') && state.body.includes('打开作品') && !state.body.includes('导入作品')
    if (!state.shell || !state.settings || !state.modelsVisible || !state.writingVisible || !state.editorName || state.officialHome || !onboarding || !state.settingsControl || state.permanentChat) throw new Error('configured home assertion failed')
  }))
  const report = { ok: true, source: 'private-dsh-profile-web', phases }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
