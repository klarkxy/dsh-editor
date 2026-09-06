import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployProfile } from './profile.js'
import { materializePackagedRuntime } from './runtime-cache.js'
import { DshSupervisor } from './supervisor.js'
import { checkLatest, type UpdateCheckResult } from './update-checker.js'
import { claimPrimaryInstance, createDesktopLifecycle, type EditorWindow, type PrimaryApp } from './window-lifecycle.js'

const desktopRoot = fileURLToPath(new URL('../', import.meta.url))

const isolatedUserData = process.env.DSH_DESKTOP_USER_DATA_DIR
if (isolatedUserData) {
  app.setPath('userData', isolatedUserData)
}

async function resolveRuntime(home: string): Promise<{ nodePath: string; cliPath: string; template: string }> {
  const cached = app.isPackaged ? await materializePackagedRuntime(home, process.resourcesPath) : undefined
  const nodePath = cached?.nodePath ?? process.env.DSH_DESKTOP_NODE_PATH
  const cliPath = cached?.cliPath ?? process.env.DSH_DESKTOP_CLI_PATH
  const template = cached?.template ?? (process.env.DSH_DESKTOP_PROFILE_TEMPLATE || join(desktopRoot, 'resources', 'profile'))
  if (!nodePath || !cliPath) throw new Error('Development requires DSH_DESKTOP_NODE_PATH and DSH_DESKTOP_CLI_PATH.')
  for (const path of [nodePath, cliPath, template]) if (!existsSync(path)) throw new Error(`Required desktop resource is missing: ${path}`)
  const nodeVersion = execFileSync(nodePath, ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
  if (nodeVersion !== 'v24.16.0') throw new Error(`Node runtime mismatch: expected v24.16.0, found ${nodeVersion || 'unknown'}`)
  const manifest = JSON.parse(readFileSync(join(dirname(dirname(cliPath)), 'package.json'), 'utf8')) as { name?: string; version?: string }
  if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== '0.1.1-rc.2') {
    throw new Error(`DSH runtime mismatch: expected @deepseek-ai/dsh@0.1.1-rc.2, found ${manifest.name ?? 'unknown'}@${manifest.version ?? 'unknown'}`)
  }
  return { nodePath, cliPath, template }
}

function errorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const escaped = message.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>DSH Editor</title><style>body{font-family:system-ui;margin:3rem;max-width:48rem;line-height:1.5;-webkit-app-region:drag}code{display:block;white-space:pre-wrap;margin:1rem 0;padding:1rem;background:#f4f2ea}a{display:inline-block;padding:.5rem .8rem;border:1px solid #777;color:#222;text-decoration:none;-webkit-app-region:no-drag}</style><h1>DSH Editor 启动失败</h1><p>本地 DSH 服务未能就绪，请根据下面的诊断信息排查后重试。</p><code>${escaped}</code><a href="dsh-editor://retry">重试</a>`)}`
}

function loadingHtml(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>DSH Editor</title><style>body{font-family:system-ui;display:grid;place-content:center;height:100vh;margin:0;background:#faf9f5;color:#393832;-webkit-app-region:drag}main{text-align:center}p{color:#77746c}</style><main><h1>DSH Editor</h1><p>正在启动本地写作环境…</p></main>')}`
}

const lifecycle = createDesktopLifecycle({
  createBrowserWindow: () => {
    const window = new BrowserWindow({
      title: 'DSH Editor', width: 1440, height: 900, minWidth: 1280, minHeight: 720,
      show: false, frame: false, backgroundColor: '#faf9f5',
      icon: join(desktopRoot, 'build', 'icon.png'),
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
  loadingHtml,
  getHomePath: () => app.getPath('home'),
  env: process.env,
  timeoutMs: app.isPackaged ? 120_000 : 20_000,
})

const isPrimary = claimPrimaryInstance(app as unknown as PrimaryApp, lifecycle)

/* 启动时后台检查更新:与窗口创建并行,慢网络不阻塞启动。渲染端挂载后通过
 * dsh-window:startup-update 拉取缓存的 Promise——拉取模型没有推送竞态,
 * 晚挂载的窗口也能拿到同一份结果。 */
let startupUpdate: Promise<UpdateCheckResult> | undefined
if (isPrimary) {
  void app.whenReady().then(() => {
    startupUpdate ??= checkLatest(app.getVersion())
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

// "About / update" page: the renderer is locked behind a strict CSP that
// blocks api.github.com, so these calls run through the main process instead.
ipcMain.handle('dsh-window:get-app-info', () => ({ name: app.getName(), version: app.getVersion() }))
ipcMain.handle('dsh-window:check-update', () => checkLatest(app.getVersion()))
// 启动检查走同一轮询;渲染端拉缓存结果,仅 update-available 时提示,其余静默。
ipcMain.handle('dsh-window:startup-update', () => startupUpdate ?? checkLatest(app.getVersion()))

// External links: the navigation policy denies in-app navigation and window.open,
// so whitelisted https links go through the OS browser instead. GitHub links are
// further constrained to this repository to keep the allowlist meaningful.
const OPEN_EXTERNAL_HOSTS = new Set(['developer.zhihu.com', 'zhida.zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com', 'github.com'])
const GITHUB_REPO_PATHNAME = '/klarkxy/dsh-editor/'
ipcMain.on('dsh-window:open-external', (_event, url) => {
  if (typeof url !== 'string') return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'https:' || !OPEN_EXTERNAL_HOSTS.has(parsed.hostname)) return
  if (parsed.hostname === 'github.com' && !parsed.pathname.startsWith(GITHUB_REPO_PATHNAME)) return
  void shell.openExternal(parsed.toString())
})
