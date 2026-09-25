import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readTrustedClipboardText, writeTrustedClipboardText } from './clipboard.js'
import { RendererConsoleTail, pruneCrashReports, writeCrashReport, writeStartupDiagnostic, type CrashReportFacts, type CrashReportSource } from './crash-report.js'
import { DesktopFatalRecovery } from './fatal-recovery.js'
import { assertTrustedIpcSender, isTrustedIpcSender } from './ipc-trust.js'
import { isAllowedExternalUrl } from './navigation.js'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployOwnedProfile, resolveDshHome } from './profile.js'
import { hasPackagedRuntimeCache, materializePackagedRuntime, readProfileDeployIdentity, runtimeFromResources, shouldMaterializePackagedRuntime } from './runtime-cache.js'
import { DshSupervisor } from './supervisor.js'
import { checkLatest } from './update-checker.js'
import { disableMarketplacePlugins } from './user-plugins.js'
import { cancelUpdateDownload, downloadUpdate, installUpdate } from './update-download.js'
import { presentUpdateCheck, UpdateOfferStore, type PublicUpdateCheckResult } from './update-session.js'
import { claimPrimaryInstance, createDesktopLifecycle, exportFileFilter, type EditorWindow, type PrimaryApp } from './window-lifecycle.js'
import { DESKTOP_APP_ID, DESKTOP_PRODUCT_NAME, readDesktopVersion } from './app-identity.js'
import { loadingPageDataUrl } from './loading-page.js'

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
const desktopVersion = readDesktopVersion(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))

const isolatedUserData = process.env.DSH_DESKTOP_USER_DATA_DIR?.trim()
  || (!app.isPackaged && process.env.DSH_HOME?.trim()
    ? join(process.env.DSH_HOME.trim(), 'electron-user-data')
    : '')
if (isolatedUserData) app.setPath('userData', isolatedUserData)
if (!app.isPackaged) app.setName('dsh-editor-dev')
app.setAppUserModelId(app.isPackaged ? DESKTOP_APP_ID : `${DESKTOP_APP_ID}.dev`)
/* 崩溃报告落在应用 logs 目录;尽早固定路径,使进程级致命错误也有处可写。 */
app.setAppLogsPath()

async function resolveRuntime(home: string): Promise<{
  nodePath: string
  cliPath: string
  template: string
  deploy?: ReturnType<typeof readProfileDeployIdentity>
}> {
  const cached = !app.isPackaged
    ? undefined
    : shouldMaterializePackagedRuntime(process.env)
      ? await materializePackagedRuntime(home, process.resourcesPath)
      : runtimeFromResources(process.resourcesPath)
  const nodePath = cached?.nodePath ?? process.env.DSH_DESKTOP_NODE_PATH
  const cliPath = cached?.cliPath ?? process.env.DSH_DESKTOP_CLI_PATH
  const template = cached?.template ?? (process.env.DSH_DESKTOP_PROFILE_TEMPLATE || join(desktopRoot, 'resources', 'profile'))
  if (!nodePath || !cliPath) throw new Error('Development requires DSH_DESKTOP_NODE_PATH and DSH_DESKTOP_CLI_PATH.')
  for (const path of [nodePath, cliPath, template]) if (!existsSync(path)) throw new Error(`Required desktop resource is missing: ${path}`)
  const nodeVersion = execFileSync(nodePath, ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
  if (nodeVersion !== 'v24.16.0') throw new Error(`Node runtime mismatch: expected v24.16.0, found ${nodeVersion || 'unknown'}`)
  const manifest = JSON.parse(readFileSync(join(dirname(dirname(cliPath)), 'package.json'), 'utf8')) as { name?: string; version?: string }
  if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== '0.1.7-rc.2') {
    throw new Error(`DSH runtime mismatch: expected @deepseek-ai/dsh@0.1.7-rc.2, found ${manifest.name ?? 'unknown'}@${manifest.version ?? 'unknown'}`)
  }
  let deploy: ReturnType<typeof readProfileDeployIdentity> | undefined
  if (app.isPackaged) {
    try { deploy = readProfileDeployIdentity(process.resourcesPath, { nodePath, cliPath }) } catch { /* unpackaged-shaped resources keep the full deploy path */ }
  }
  return { nodePath, cliPath, template, deploy }
}

function errorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const escaped = message.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>DSH Editor</title><style>body{font-family:system-ui;margin:3rem;max-width:48rem;line-height:1.5;-webkit-app-region:drag}main{-webkit-app-region:no-drag}code{display:block;white-space:pre-wrap;margin:1rem 0;padding:1rem;background:#f4f2ea}.actions{display:flex;gap:.6rem}button{padding:.5rem .8rem;border:1px solid #777;color:#222;background:transparent;font:inherit;cursor:pointer}</style><main><h1>DSH Editor 启动失败</h1><p>本地 DSH 服务未能就绪，请根据下面的诊断信息排查后重试。</p><code>${escaped}</code><p class="actions"><button type="button" data-dsh-startup-retry onclick="window.dshWindow.retry()">重试</button><button type="button" onclick="window.dshWindow.close()">关闭</button></p></main>`)}`
}

function loadingHtml(firstLaunch: boolean): string {
  return loadingPageDataUrl({
    firstLaunch,
    mascotBytes: readFileSync(join(desktopRoot, 'build', 'mascot.webp')),
  })
}

function firstLaunchLoading(): boolean {
  return app.isPackaged
    && shouldMaterializePackagedRuntime(process.env)
    && !hasPackagedRuntimeCache(resolveDshHome(process.env, app.getPath('home')))
}

const rendererConsoleTail = new RendererConsoleTail()
/* 各窗口上报的"编辑器仍有 AI 任务"集合,按 webContents id 记账;窗口关闭或渲染进程退出时清除。 */
const busyContents = new Set<number>()

function crashReportFacts(): CrashReportFacts {
  return {
    name: DESKTOP_PRODUCT_NAME,
    version: desktopVersion,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? 'unknown',
    node: process.version,
    locale: app.getLocale(),
  }
}

function persistCrashReport(error: unknown, source: CrashReportSource): Promise<string | undefined> {
  return writeCrashReport(app.getPath('logs'), { source, error, rendererConsole: rendererConsoleTail.snapshot() }, crashReportFacts())
}

/* 致命错误入口:关机途中只落崩溃报告,否则走恢复对话框(首错胜出,只弹一次)。 */
function reportFatal(error: unknown, source: CrashReportSource): void {
  void recovery.reportFatal(error, source)
}

const lifecycle = createDesktopLifecycle({
  createBrowserWindow: () => {
    const window = new BrowserWindow({
      title: 'DSH Editor', width: 1440, height: 900, minWidth: 1280, minHeight: 720,
      show: false, frame: false, backgroundColor: '#faf9f5',
      icon: join(desktopRoot, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      webPreferences: {
        preload: join(desktopRoot, 'preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false,
        /* 流式回复靠 requestAnimationFrame 合帧推送；默认的节流会在窗口被遮挡时
         * 停掉 rAF，表现为"回复卡住、聚焦后才刷新"。写作场景常切换窗口，关掉它。 */
        backgroundThrottling: false,
      },
    })
    // Frameless window: forward maximize state to the renderer's own title bar.
    window.on('maximize', () => window.webContents.send('dsh-window:maximized', true))
    window.on('unmaximize', () => window.webContents.send('dsh-window:maximized', false))
    /* 渲染进程崩溃三件套:非干净退出、非主动打断的加载失败、预加载脚本失败都进恢复流程;
     * error 级控制台消息留尾,随崩溃报告落盘。 */
    const contentsId = window.webContents.id
    window.webContents.on('render-process-gone', (_event, details) => {
      busyContents.delete(contentsId)
      if (details.reason === 'clean-exit') return
      reportFatal(new Error(`渲染进程意外退出（${details.reason}，退出码 ${details.exitCode}）`), 'renderer')
    })
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      reportFatal(new Error(`预加载脚本执行失败（${preloadPath}）：${error.message}`), 'renderer')
    })
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return // ERR_ABORTED:同窗口连续加载的正常打断
      if (validatedURL.startsWith('data:')) return // 加载页/错误页自身的失败不进恢复流程
      reportFatal(new Error(`页面加载失败（${errorCode} ${errorDescription}）：${validatedURL}`), 'renderer')
    })
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') rendererConsoleTail.append(event.message)
    })
    window.on('closed', () => busyContents.delete(contentsId))
    return window as unknown as EditorWindow
  },
  fromWebContents: (contents) => {
    const ctor = BrowserWindow as unknown as { fromWebContents(contents: unknown): EditorWindow | null }
    return ctor.fromWebContents(contents) ?? undefined
  },
  showSaveDialog: (window, suggested) => {
    const filter = exportFileFilter(suggested)
    if (!filter) return undefined
    const options = {
      title: '导出作品',
      defaultPath: suggested,
      filters: [filter],
    }
    return window
      ? dialog.showSaveDialogSync(window as unknown as BrowserWindow, options)
      : dialog.showSaveDialogSync(options)
  },
  resolveRuntime,
  deployProfile: deployOwnedProfile,
  createSupervisor: (options) => new DshSupervisor(options),
  errorHtml,
  loadingHtml: () => loadingHtml(firstLaunchLoading()),
  getHomePath: () => app.getPath('home'),
  env: process.env,
  timeoutMs: 120_000,
  reportFatal: (error, source) => reportFatal(error, source),
  /* 有窗口报告 AI 任务在跑时,退出前原生确认;取消则中止退出。 */
  confirmBusyQuit: async () => {
    if (busyContents.size === 0) return true
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: DESKTOP_PRODUCT_NAME,
      message: '有 AI 任务正在进行，确定退出？',
      detail: '退出会中断正在进行的生成任务。',
      buttons: ['退出', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return response === 0
  },
})

const recovery = new DesktopFatalRecovery({
  writeReport: persistCrashReport,
  showDialog: (options) => dialog.showMessageBox(options).then(({ response }) => response),
  stopBackend: () => lifecycle.shutdown(),
  disablePlugins: async () => {
    await disableMarketplacePlugins(resolveDshHome(process.env, app.getPath('home')))
  },
  relaunch: () => { app.relaunch(); app.exit(0) },
  exit: () => { app.exit(1) },
  isShuttingDown: () => lifecycle.isShuttingDown(),
})

const isPrimary = claimPrimaryInstance(app as unknown as PrimaryApp, lifecycle)

const updateStore = new UpdateOfferStore()

/* 检查结果只把主进程已验证的附件公开给渲染端。便携单文件由
 * PORTABLE_EXECUTABLE_FILE 标识(进程本体跑在临时解压目录)。缺 digest 时
 * 不提供一键下载,避免静默降级成只比大小。 */
function presentCheckedUpdate(result: Awaited<ReturnType<typeof checkLatest>>): Promise<PublicUpdateCheckResult> {
  return presentUpdateCheck(result, {
    platform: process.platform,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    store: updateStore,
    fetchImpl: (input, init) => globalThis.fetch(input, init),
  })
}

/* 启动时后台检查更新:与窗口创建并行,慢网络不阻塞启动。渲染端挂载后通过
 * dsh-window:startup-update 拉取缓存的 Promise——拉取模型没有推送竞态,
 * 晚挂载的窗口也能拿到同一份结果。 */
let startupUpdate: Promise<PublicUpdateCheckResult> | undefined
if (isPrimary) {
  void app.whenReady().then(() => {
    startupUpdate ??= checkLatest(desktopVersion).then(presentCheckedUpdate)
    void pruneCrashReports(app.getPath('logs'))
  })
}

// Frameless window controls: the renderer's own title bar drives these through
// the preload bridge (preload.cjs exposes window.dshWindow). Route by sender so
// multi-window stays correct.
ipcMain.on('dsh-window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.on('dsh-window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
})
ipcMain.on('dsh-window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

function senderTrust(event: {
  sender: { isDestroyed?: () => boolean; getURL?: () => string }
  senderFrame?: { url?: string; parent?: unknown } | null
}) {
  const window = BrowserWindow.fromWebContents(event.sender as never)
  const frame = event.senderFrame
  const isMainFrame = frame != null && frame.parent == null
  return {
    owned: lifecycle.isOwnedWindow(window as unknown as EditorWindow | undefined),
    destroyed: Boolean(window == null || event.sender.isDestroyed?.()),
    isMainFrame,
    url: typeof frame?.url === 'string' ? frame.url : '',
    expected: lifecycle.expectedUrl(),
  }
}

// Startup error pages are sandboxed data: documents. A custom-scheme <a>
// never reaches will-navigate, so retry goes through the preload bridge.
ipcMain.on('dsh-window:retry', (event) => {
  const trust = senderTrust(event)
  if (!trust.owned || trust.destroyed || !trust.isMainFrame) return
  if (!trust.url.includes('data-dsh-startup-retry')) return
  void lifecycle.retry()
})

ipcMain.handle('dsh-window:clipboard-read-text', (event) => {
  return readTrustedClipboardText(clipboard, senderTrust(event))
})
ipcMain.handle('dsh-window:clipboard-write-text', (event, text) => {
  writeTrustedClipboardText(clipboard, senderTrust(event), text)
})

function updateIdFrom(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const id = (payload as { updateId?: unknown }).updateId
  return typeof id === 'string' ? id : ''
}

// "About / update" page: the renderer is locked behind a strict CSP that
// blocks api.github.com, so these calls run through the main process instead.
// Sender 校验不能代替资产白名单:被注入的主页面也拥有合法 sender。
ipcMain.handle('dsh-window:get-app-info', (event) => {
  assertTrustedIpcSender(senderTrust(event), 'app info')
  return {
    name: DESKTOP_PRODUCT_NAME,
    version: desktopVersion,
    platform: process.platform,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  }
})
ipcMain.handle('dsh-window:check-update', (event) => {
  assertTrustedIpcSender(senderTrust(event), 'update')
  return checkLatest(desktopVersion).then(presentCheckedUpdate)
})
// 启动检查走同一轮询;渲染端拉缓存结果,仅 update-available 时提示,其余静默。
ipcMain.handle('dsh-window:startup-update', (event) => {
  assertTrustedIpcSender(senderTrust(event), 'update')
  return startupUpdate ?? checkLatest(desktopVersion).then(presentCheckedUpdate)
})
// 一键下载/安装:主进程按已验证的 updateId 下载并安装,渲染端不能指定 URL 或路径。
ipcMain.handle('dsh-window:download-update', (event, payload) => {
  assertTrustedIpcSender(senderTrust(event), 'update')
  return downloadUpdate(updateIdFrom(payload), event.sender, updateStore)
})
ipcMain.handle('dsh-window:cancel-update-download', (event) => {
  assertTrustedIpcSender(senderTrust(event), 'update')
  cancelUpdateDownload()
})
ipcMain.handle('dsh-window:install-update', (event, payload) => {
  assertTrustedIpcSender(senderTrust(event), 'update')
  return installUpdate(updateIdFrom(payload), updateStore)
})

// Open marketplace and help links in the OS browser; in-app popups stay blocked.
ipcMain.on('dsh-window:open-external', (_event, url) => {
  if (!isAllowedExternalUrl(url)) return
  void shell.openExternal(new URL(url).toString())
})

/* 渲染端推送编辑器 busy(AI 生成中);before-quit 据此确认,不需要反向查询 renderer。 */
ipcMain.on('dsh-window:report-activity', (event, payload) => {
  const trust = senderTrust(event)
  if (!isTrustedIpcSender(trust)) return
  const busy = Boolean(payload && typeof payload === 'object' && (payload as { busy?: unknown }).busy)
  if (busy) busyContents.add(event.sender.id)
  else busyContents.delete(event.sender.id)
})

/* 最外层兜底:未捕获的致命错误先写诊断文件(供打包环境排查),再走恢复流程。 */
const diagnosticFile = process.env.DSH_EDITOR_DESKTOP_DIAGNOSTIC_FILE?.trim()
process.on('uncaughtException', (error) => {
  console.error(error)
  if (diagnosticFile) writeStartupDiagnostic(diagnosticFile, error)
  if (isPrimary) reportFatal(error, 'main')
})
process.on('unhandledRejection', (reason) => {
  console.error(reason)
  if (diagnosticFile) writeStartupDiagnostic(diagnosticFile, reason)
  if (isPrimary) reportFatal(reason, 'main')
})
