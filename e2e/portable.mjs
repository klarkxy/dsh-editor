import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.pack', 'portable-e2e')
const portable = resolve(root, '.pack', 'desktop', 'DSH Editor-0.1.0-win-x64.exe')
const home = resolve(root, '.dev', 'portable-home')
const portableStat = await stat(portable)
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

async function freePort() {
  const server = createServer()
  server.unref()
  await new Promise((resolvePromise, reject) => server.listen(0, '127.0.0.1', resolvePromise).once('error', reject))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise) => server.close(resolvePromise))
  if (!port) throw new Error('could not reserve a Chromium debugging port')
  return port
}

async function connectToPortable(port, child) {
  const deadline = Date.now() + 240_000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`portable wrapper exited before its window was ready (${child.exitCode})`)
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
    }
  }
  throw new Error(`portable Chromium endpoint did not become ready within 240s: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function stopOwnedTree(child) {
  if (child.exitCode !== null) return
  const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  await Promise.race([once(killer, 'exit'), new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000))])
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return
  await new Promise((resolvePromise, reject) => {
    const done = () => {
      clearTimeout(timer)
      child.off('exit', done)
      resolvePromise()
    }
    const timer = setTimeout(() => {
      child.off('exit', done)
      reject(new Error('portable wrapper did not exit after its window closed'))
    }, timeoutMs)
    child.once('exit', done)
    if (child.exitCode !== null) done()
  })
}

const debuggingPort = await freePort()
const portableEnv = {
  ...process.env,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: '1',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete portableEnv.DSH_EDITOR_CUSTOM_API_KEY
const child = spawn(portable, [`--remote-debugging-port=${debuggingPort}`], {
  env: portableEnv,
  stdio: 'ignore',
  windowsHide: false,
})

let browser
let report
try {
  browser = await connectToPortable(debuggingPort, child)
  const context = browser.contexts()[0]
  if (!context) throw new Error('portable Electron process exposed no browser context')
  let window
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if ((await page.title().catch(() => '')) === 'DSH Editor') {
        window = page
        break
      }
    }
    if (window) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  if (!window) throw new Error('portable Electron window was not exposed through Chromium')
  try {
    await window.waitForSelector('.shell', { timeout: 180_000 })
  } catch (error) {
    const diagnostic = await window.evaluate(() => ({ title: document.title, body: document.body.textContent, url: location.href }))
    await window.screenshot({ path: resolve(output, 'failure.png') })
    throw new Error(`portable shell did not mount: ${JSON.stringify(diagnostic)}; ${error instanceof Error ? error.message : String(error)}`)
  }
  const url = new URL(window.url())
  if (url.hostname !== '127.0.0.1' || !url.port) throw new Error(`unexpected portable URL ${url.href}`)
  const continueNotice = window.getByRole('button', { name: '继续', exact: true })
  let onboardingSteps = 0
  for (; onboardingSteps < 5 && await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false); onboardingSteps += 1) {
    await continueNotice.click()
    await window.waitForTimeout(250)
  }
  const nativeOnboarding = { notice: onboardingSteps > 0, steps: onboardingSteps, setup: false }
  nativeOnboarding.setup = await window.getByRole('button', { name: '稍后配置', exact: true }).isVisible({ timeout: 2_000 }).catch(() => false)
  if (nativeOnboarding.setup) await window.getByRole('button', { name: '稍后配置', exact: true }).click()
  const state = await window.evaluate(() => ({
    onboarding: (document.body.textContent?.includes('打开作品') ?? false) && (document.body.textContent?.includes('新建') ?? false),
    title: document.title,
    shell: Boolean(document.querySelector('.shell')),
    settings: Boolean(document.querySelector('[role="dialog"]')),
    editorName: Boolean(document.querySelector('.brand-lockup')),
    officialHome: document.body.textContent?.includes('DeepSeek Harness') ?? false,
    technicalChrome: ['DSH_HOME', 'permission preset', '权限模式', '会话列表'].some((label) => document.body.textContent?.includes(label) ?? false),
    homeSidebar: Boolean(document.querySelector('.no-session > .sidebar')),
    homeStage: Boolean(document.querySelector('.no-session > .empty-paper')),
    permanentChat: Boolean(document.querySelector('.no-session > .chat')),
    bootEntries: globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id) ?? [],
  }))
  state.nativeOnboarding = nativeOnboarding
  const clientBoundaryReady = state.bootEntries.filter((entry) => entry === 'dsh-editor-shell').length === 1
    && state.bootEntries.every((entry) => entry !== 'dsh-editor-workbench' && entry !== 'dsh-editor-novel-kernel')
  if (!state.shell || !state.editorName || state.officialHome || !state.onboarding || state.technicalChrome || state.permanentChat || state.homeSidebar || !state.homeStage || !clientBoundaryReady) {
    throw new Error(`portable identity assertion failed: ${JSON.stringify(state)}`)
  }
  await window.screenshot({ path: resolve(output, 'window.png') })
  const origin = url.origin
  await window.close()
  await browser.close()
  browser = undefined
  await waitForExit(child, 30_000)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 750))
  const portReleased = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).then(() => false, () => true)
  const debuggerReleased = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`, { signal: AbortSignal.timeout(1_000) }).then(() => false, () => true)
  if (!portReleased || !debuggerReleased) throw new Error(`portable process left a listening port (DSH=${!portReleased}, debugger=${!debuggerReleased})`)
  report = {
    ok: true,
    source: 'current-portable-wrapper',
    portable: { path: portable, bytes: portableStat.size },
    origin,
    portReleased,
    debuggerReleased,
    exitCode: child.exitCode,
    state,
  }
} finally {
  if (browser) await browser.close().catch(() => undefined)
  await stopOwnedTree(child)
}

await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
