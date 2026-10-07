import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, realpath, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { localArtifactName } from '../scripts/release-artifacts.mjs'
import { assertDefaultPluginPage, closePluginsPage, openPluginsPage, openWebSearchSettings } from './helpers/plugin-page.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.pack', 'portable-e2e')
const desktopVersion = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8')).version
const portable = resolve(root, '.pack', 'desktop', localArtifactName('win32-portable', desktopVersion))
// A sandbox-writable checkout can label all descendants Low integrity. Running
// its EXE in place would test that label instead of the distributed application.
// Fresh copies inherit the ordinary test directory's label; keep workspace ACLs.
const stagePrefix = 'dsh-editor-portable-e2e-'
let tempRoot, stage, executable, home, child, sourceHash, portableStat
let launched = false
async function fileHash(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
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
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  let timer
  try {
    await Promise.race([once(killer, 'exit'), new Promise((resolvePromise) => { timer = setTimeout(resolvePromise, 10_000) })])
  } finally { clearTimeout(timer) }
  await waitForExit(child, 10_000)
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
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
    if (child.exitCode !== null || child.signalCode !== null) done()
  })
}

async function removeOwnedStage() {
  if (!stage) return
  const actual = await realpath(stage)
  const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path
  if (normalize(actual) !== normalize(stage) || normalize(dirname(actual)) !== normalize(tempRoot) || !basename(actual).startsWith(stagePrefix)) {
    throw new Error(`refusing to remove portable test stage outside its owned TEMP directory: ${actual}`)
  }
  await rm(actual, { recursive: true, force: true, maxRetries: 3 })
}

async function assertNewProjectHasNoManuscriptFolder(page, workspace) {
  await page.locator('.tree-empty').waitFor({ state: 'visible', timeout: 20_000 })
  for (const extra of ['正文', '大纲', '人物卡', '世界书']) {
    if (existsSync(resolve(workspace, extra))) throw new Error(`new project should not pre-create ${extra}`)
    if (await page.locator('.tree').getByText(extra, { exact: true }).count()) {
      throw new Error(`new project should not pre-seed ${extra}`)
    }
  }
}

async function createRootFolderFromTree(page, name) {
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
  await page.locator('.tree-row').filter({ hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function revealPaperEditor(page) {
  const hideAssistant = page.getByRole('button', { name: '隐藏写作搭档' })
  try {
    await hideAssistant.click({ timeout: 3_000 })
    await hideAssistant.waitFor({ state: 'hidden', timeout: 10_000 })
  } catch {
    // Wide layouts keep the partner in the grid; the paper still needs a click.
  }
  await page.locator('.rt-DialogOverlay').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined)
  const editor = page.locator('[data-testid="paper-editor"] .cm-content')
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="paper-editor"] .cm-content')?.getAttribute('contenteditable') === 'true',
    undefined,
    { timeout: 20_000 },
  )
  await editor.click({ force: true })
}

async function openAndCloseProofreadPanel(page) {
  await page.getByRole('button', { name: '搜索与命令' }).click()
  await page.locator('.palette-overlay').waitFor({ state: 'visible', timeout: 10_000 })
  const input = page.locator('.palette-input')
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill('校对当前文档')
  await page.getByRole('option', { name: /校对当前文档/ }).first().click()
  await page.locator('.palette-overlay').waitFor({ state: 'detached', timeout: 8_000 }).catch(() => undefined)
  const panel = page.getByRole('region', { name: '文稿校对' })
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  if (await page.getByTestId('editor-proofread-panel').count() === 0) {
    throw new Error('shared proofread panel did not mount')
  }
  const kinds = panel.getByRole('group', { name: '问题类型' })
  await kinds.waitFor({ state: 'visible', timeout: 10_000 })
  const kindText = (await kinds.innerText()).replace(/\s+/g, ' ')
  if (/人物卡|\bcard\b/i.test(kindText)) throw new Error(`proofread still exposes card kind: ${kindText}`)
  await panel.getByRole('button', { name: '关闭文稿校对' }).click()
  await panel.waitFor({ state: 'hidden', timeout: 10_000 })
}

let debuggingPort
let browser
let report = { ok: false }
try {
  portableStat = await stat(portable)
  tempRoot = await realpath(tmpdir())
  stage = await mkdtemp(resolve(tempRoot, stagePrefix))
  executable = resolve(stage, localArtifactName('win32-portable', desktopVersion))
  home = resolve(stage, 'home')
  await copyFile(portable, executable)
  sourceHash = await fileHash(portable)
  if (await fileHash(executable) !== sourceHash) throw new Error('portable test copy differs from the final artifact')
  debuggingPort = await freePort()
  const portableEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
    DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
  }
  delete portableEnv.DSH_EDITOR_CUSTOM_API_KEY
  child = spawn(executable, [`--remote-debugging-port=${debuggingPort}`], {
    env: portableEnv,
    stdio: 'ignore',
    windowsHide: false,
  })
  await new Promise((resolvePromise, reject) => { child.once('spawn', resolvePromise); child.once('error', reject) })
  launched = true
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
    await window.waitForSelector('main.shell', { timeout: 180_000 })
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
    onboarding: (document.querySelector('main.shell')?.textContent?.includes('打开作品') ?? false) && (document.querySelector('main.shell')?.textContent?.includes('新建') ?? false),
    title: document.title,
    shell: Boolean(document.querySelector('main.shell')),
    settings: Boolean(document.querySelector('[role="dialog"]')),
    editorName: Boolean(document.querySelector('.brand-lockup')),
    officialHome: document.querySelector('main.shell')?.textContent?.includes('DeepSeek Harness') ?? false,
    technicalChrome: ['DSH_HOME', 'permission preset', '权限模式', '会话列表'].some((label) => document.querySelector('main.shell')?.textContent?.includes(label) ?? false),
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
  if (await window.getByTestId('proofread-open').count() || await window.getByTestId('zhihu-open').count()) throw new Error('retired desktop launchers appeared in portable artifact')
  const smoke = process.env.DSH_PORTABLE_SMOKE === '1'
  if (smoke) {
    state.operations = ['smoke: packed wrapper started and home identity passed']
  } else {
  const pluginsPage = await openPluginsPage(window)
  await assertDefaultPluginPage(window, pluginsPage)
  await openWebSearchSettings(pluginsPage)
  await closePluginsPage(window)
  await window.getByRole('button',{name:'新建',exact:true}).first().click()
  const project = window.getByRole('dialog',{name:'新建作品'})
  await project.getByLabel('作品名称').fill('便携组合验证')
  await project.getByRole('button',{name:'创建',exact:true}).click()
  await window.locator('.tree').waitFor({timeout:30000})
  const portableWorkspace = resolve(home, 'projects', '便携组合验证')
  await assertNewProjectHasNoManuscriptFolder(window, portableWorkspace)
  await createRootFolderFromTree(window, '正文')
  await window.locator('.tree-row').filter({hasText:'正文'}).first().hover()
  await window.getByRole('button',{name:'在 正文 中新建文件',exact:true}).click()
  const file=window.getByRole('dialog',{name:'新建文件'})
  await file.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001')
  await file.getByRole('button',{name:'创建',exact:true}).click()
  await file.waitFor({ state: 'detached', timeout: 15_000 })
  await revealPaperEditor(window)
  await window.keyboard.insertText('最终便携产物保存验证。')
  await window.keyboard.press('Control+s')
  await window.locator('[data-testid="paper-save-state"]',{hasText:'已保存'}).waitFor()
  if(!(await readFile(resolve(portableWorkspace,'正文','001.md'),'utf8')).includes('最终便携产物保存验证'))throw new Error('portable save missing on disk')
  await openAndCloseProofreadPanel(window)
  state.operations=['proofreading and Zhihu desktop launchers absent','native plugin manager lists the default web-search bundle and opens its configuration','create ordinary 正文 from tree, then document, and save to disk','open and close 文稿校对 from command palette without card UI']
  }
  await window.screenshot({ path: resolve(output, 'window.png') })
  const origin = url.origin
  const closeStarted = Date.now()
  await window.close()
  await browser.close()
  browser = undefined
  await waitForExit(child, 90_000)
  state.closeExitMs = Date.now() - closeStarted
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 750))
  const portReleased = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).then(() => false, () => true)
  const debuggerReleased = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`, { signal: AbortSignal.timeout(1_000) }).then(() => false, () => true)
  if (!portReleased || !debuggerReleased) throw new Error(`portable process left a listening port (DSH=${!portReleased}, debugger=${!debuggerReleased})`)
  report = {
    ok: true,
    source: 'current-portable-wrapper',
    portable: { path: portable, bytes: portableStat.size, sha256: sourceHash, testedPath: executable },
    origin,
    portReleased,
    debuggerReleased,
    exitCode: child.exitCode,
    state,
  }
} catch (error) {
  report = { ok: false, failure: error instanceof Error ? error.stack : String(error) }
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => undefined)
  let shutdownFailed = false
  try { await stopOwnedTree(child) } catch (error) {
    shutdownFailed = true
    report.ok = false
    report.shutdownFailure = String(error)
    process.exitCode = 1
  }
  const stageState = { path: stage, retained: Boolean(stage), reason: shutdownFailed ? 'owned process shutdown failed' : launched && !report.ok ? 'portable launch or workflow failure; retained for diagnostics' : undefined }
  if (stage && !stageState.reason) {
    try {
      await removeOwnedStage()
      stageState.retained = false
    } catch (error) {
      report.ok = false
      report.cleanupFailure = String(error)
      stageState.reason = 'owned TEMP stage cleanup failed'
      process.exitCode = 1
    }
  }
  report.portable = { path: portable, bytes: portableStat?.size, sha256: sourceHash, testedPath: executable }
  report.stage = stageState
  await writeFile(resolve(output, 'launch.json'), `${JSON.stringify({ ...report.portable, home, debuggingPort, pid: child?.pid, exitCode: child?.exitCode, signalCode: child?.signalCode, stage: stageState }, null, 2)}\n`)
}

await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
