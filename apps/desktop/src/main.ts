import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readTrustedClipboardText, writeTrustedClipboardText } from './clipboard.js'
import { assertTrustedIpcSender } from './ipc-trust.js'
import { isAllowedExternalUrl } from './navigation.js'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployProfile, resolveDshHome } from './profile.js'
import { hasPackagedRuntimeCache, materializePackagedRuntime, runtimeFromResources, shouldMaterializePackagedRuntime } from './runtime-cache.js'
import { DshSupervisor } from './supervisor.js'
import { checkLatest } from './update-checker.js'
import { cancelUpdateDownload, downloadUpdate, installUpdate } from './update-download.js'
import { presentUpdateCheck, UpdateOfferStore, type PublicUpdateCheckResult } from './update-session.js'
import { claimPrimaryInstance, createDesktopLifecycle, type EditorWindow, type PrimaryApp } from './window-lifecycle.js'
import { DESKTOP_APP_ID, DESKTOP_PRODUCT_NAME, readDesktopVersion } from './app-identity.js'

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
const desktopVersion = readDesktopVersion(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))

const isolatedUserData = process.env.DSH_DESKTOP_USER_DATA_DIR?.trim()
  || (!app.isPackaged && process.env.DSH_HOME?.trim()
    ? join(process.env.DSH_HOME.trim(), 'electron-user-data')
    : '')
if (isolatedUserData) app.setPath('userData', isolatedUserData)
if (!app.isPackaged) app.setName('dsh-editor-dev')
app.setAppUserModelId(app.isPackaged ? DESKTOP_APP_ID : `${DESKTOP_APP_ID}.dev`)

async function resolveRuntime(home: string): Promise<{ nodePath: string; cliPath: string; template: string }> {
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
  if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== '0.1.5-rc.2') {
    throw new Error(`DSH runtime mismatch: expected @deepseek-ai/dsh@0.1.5-rc.2, found ${manifest.name ?? 'unknown'}@${manifest.version ?? 'unknown'}`)
  }
  return { nodePath, cliPath, template }
}

function errorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const escaped = message.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>DSH Editor</title><style>body{font-family:system-ui;margin:3rem;max-width:48rem;line-height:1.5;-webkit-app-region:drag}main{-webkit-app-region:no-drag}code{display:block;white-space:pre-wrap;margin:1rem 0;padding:1rem;background:#f4f2ea}.actions{display:flex;gap:.6rem}button{padding:.5rem .8rem;border:1px solid #777;color:#222;background:transparent;font:inherit;cursor:pointer}</style><main><h1>DSH Editor 启动失败</h1><p>本地 DSH 服务未能就绪，请根据下面的诊断信息排查后重试。</p><code>${escaped}</code><p class="actions"><button type="button" data-dsh-startup-retry onclick="window.dshWindow.retry()">重试</button><button type="button" onclick="window.dshWindow.close()">关闭</button></p></main>`)}`
}

/* 启动加载页:React 挂载前的纯内联 CSS。品牌标与界面 AppBrandMark 同形；
   微光行改写自 Amicro (MIT License, Copyright (c) 2026 Syed Subhan Uddin)
   的 shimmer-line。CSP 保持 default-src 'none'; style-src 'unsafe-inline',
   reduced-motion 停掉循环，保留静态微光段。 */
const BRAND_MARK_SVG = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#1a7ff0"/><path fill="#0a4ea8" fill-opacity="0.38" d="M0 17.6c3-1.1 5.6 0 8.1.55 2.5.55 5 .15 7.3-.6 2.5-.85 5.2-.7 8.6.25V24H0Z"/><ellipse cx="9" cy="12.35" rx="5.55" ry="3.55" fill="#fff"/><path d="M14.05 10.2C15.5 7.1 16.7 4.9 17.6 3.45" fill="none" stroke="#fff" stroke-width="0.9" stroke-linecap="round"/><ellipse cx="17.15" cy="3.2" rx="0.95" ry="0.42" transform="rotate(-50 17.15 3.2)" fill="#fff"/><ellipse cx="18.15" cy="3.05" rx="0.95" ry="0.42" transform="rotate(40 18.15 3.05)" fill="#fff"/><circle cx="6.35" cy="11.55" r=".4" fill="#163a66"/><rect x="14.35" y="10.7" width="6.15" height="7.15" rx="1" fill="#fff"/><path fill="#1a5aaa" d="M15.3 10.25h.75v.95h-.75zm1.75 0h.75v.95h-.75zm1.75 0h.75v.95h-.75z"/><path fill="none" stroke="#b7c7d6" stroke-width=".45" stroke-linecap="round" d="M15.55 13h3.55M15.55 14.55h3.55M15.55 16.1h2.35"/></svg>'

function loadingHtml(firstLaunch: boolean): string {
  const message = firstLaunch
    ? '首次启动正在复制本地写作环境，可能需要一分钟…'
    : '正在启动本地写作环境…'
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>DSH Editor</title><style>body{font-family:system-ui;display:grid;place-content:center;height:100vh;margin:0;background:#faf9f5;color:#393832;-webkit-app-region:drag}main{display:grid;justify-items:center;gap:14px;text-align:center}h1{margin:0;font-size:22px}p{margin:0;color:#77746c;max-width:22rem}.mark{width:56px;height:56px;display:block}.shimmer{position:relative;width:96px;height:3px;border-radius:999px;background:rgba(20,20,19,.12);overflow:hidden}.shimmer i{position:absolute;top:0;bottom:0;left:0;width:33%;border-radius:inherit;background:#1b365d;opacity:.5;animation:shimmer-sweep 1.5s ease-in-out infinite}@keyframes shimmer-sweep{from{transform:translateX(-100%)}to{transform:translateX(300%)}}@media (prefers-reduced-motion:reduce){.shimmer i{animation:none}}</style><main>${BRAND_MARK_SVG}<h1>DSH Editor</h1><p>${message}</p><span class="shimmer" aria-hidden="true"><i></i></span></main>`)}`
}

function firstLaunchLoading(): boolean {
  return app.isPackaged
    && shouldMaterializePackagedRuntime(process.env)
    && !hasPackagedRuntimeCache(resolveDshHome(process.env, app.getPath('home')))
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
    return window as unknown as EditorWindow
  },
  fromWebContents: (contents) => {
    const ctor = BrowserWindow as unknown as { fromWebContents(contents: unknown): EditorWindow | null }
    return ctor.fromWebContents(contents) ?? undefined
  },
  showSaveDialog: (window, suggested) => {
    const options = {
      title: '导出作品',
      defaultPath: suggested,
      filters: [{ name: suggested.toLowerCase().endsWith('.md') ? 'Markdown' : '纯文本', extensions: [suggested.toLowerCase().endsWith('.md') ? 'md' : 'txt'] }],
    }
    return window
      ? dialog.showSaveDialogSync(window as unknown as BrowserWindow, options)
      : dialog.showSaveDialogSync(options)
  },
  resolveRuntime,
  deployProfile,
  createSupervisor: (options) => new DshSupervisor(options),
  errorHtml,
  loadingHtml: () => loadingHtml(firstLaunchLoading()),
  getHomePath: () => app.getPath('home'),
  env: process.env,
  timeoutMs: 120_000,
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
