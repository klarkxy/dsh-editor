import { dirname, join } from 'node:path'
import type { CrashReportSource } from './crash-report.js'
import { installNavigationPolicy } from './navigation.js'
import { resolveDshHome, type ProfileDeployIdentity, type ProfileDeployResult } from './profile.js'
import { StartupTiming } from './startup-timing.js'
import type { DshLaunch, DshSupervisorOptions } from './supervisor.js'

export interface EditorInput {
  type: string
  key: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export interface DownloadItem {
  getFilename(): string
  setSavePath(path: string): void
}

export interface EditorWindow {
  loadURL(url: string): Promise<void>
  show(): void
  on(event: 'closed', listener: () => void): unknown
  webContents: {
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown
    on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: EditorInput) => void): unknown
    setWindowOpenHandler(handler: () => { action: 'deny' }): unknown
    session: {
      on(event: 'will-download', listener: (event: { preventDefault(): void }, item: DownloadItem, contents?: unknown) => void): unknown
      setPermissionRequestHandler(handler: (_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void): unknown
    }
  }
}

export interface DesktopSupervisor {
  start(launch: DshLaunch): Promise<URL>
  stop(): Promise<void>
}

export interface DesktopLifecycleDeps {
  createBrowserWindow(): EditorWindow
  fromWebContents(contents: unknown): EditorWindow | undefined
  showSaveDialog(window: EditorWindow | undefined, suggested: string): string | undefined
  resolveRuntime(home: string): Promise<{ nodePath: string; cliPath: string; template: string; deploy?: ProfileDeployIdentity }>
  deployProfile: (home: string, template: string, runtimeNodeModules?: string, deploy?: ProfileDeployIdentity) => Promise<ProfileDeployResult | string>
  createSupervisor(options: DshSupervisorOptions): DesktopSupervisor
  errorHtml(error: unknown): string
  loadingHtml(): string
  getHomePath(): string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  /** 后端短时间第二次意外退出等致命错误的上报入口;缺省时只落错误页。 */
  reportFatal?(error: unknown, source: CrashReportSource): void
  /** 退出前确认(如仍有 AI 任务在跑);缺省直接放行。返回 false 中止本次退出。 */
  confirmBusyQuit?(): Promise<boolean>
  /** 意外退出后的自动重启间隔与稳定运行复位窗口;测试注入小值。 */
  autoRestartDelayMs?: number
  autoRestartResetMs?: number
}

export interface DesktopLifecycle {
  createWindow(): Promise<void>
  handleSecondInstance(): void
  retry(): Promise<void>
  shutdown(): Promise<void>
  needsGracefulShutdown(): boolean
  isShuttingDown(): boolean
  confirmBeforeQuit(): Promise<boolean>
  isOwnedWindow(window: EditorWindow | undefined): boolean
  expectedUrl(): URL | undefined
}

export interface PrimaryApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  whenReady(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

function isNewWindowShortcut(input: EditorInput): boolean {
  return input.type === 'keyDown' && input.control && input.shift && !input.alt && !input.meta && input.key.toLowerCase() === 'n'
}

/* 后端意外退出:第一次自动重启一次;复位窗口内第二次才走错误页 + 致命恢复。 */
const AUTO_RESTART_DELAY_MS = 1_000
const AUTO_RESTART_RESET_MS = 30_000

export function createDesktopLifecycle(deps: DesktopLifecycleDeps): DesktopLifecycle {
  const windows = new Set<EditorWindow>()
  const navigationPolicies = new Map<EditorWindow, ReturnType<typeof installNavigationPolicy>>()
  let supervisor: DesktopSupervisor | undefined
  let currentUrl: URL | undefined
  let inflight: Promise<URL> | undefined
  let retrying: Promise<void> | undefined
  let closing = false
  let downloadInstalled = false
  let bootTiming: StartupTiming | undefined
  let autoRestartUsed = false
  let stabilityTimer: ReturnType<typeof setTimeout> | undefined

  /* 连续运行满复位窗口才允许下一次自动重启,避免崩溃循环里无限重启。 */
  function noteBackendStable(): void {
    if (stabilityTimer) clearTimeout(stabilityTimer)
    stabilityTimer = setTimeout(() => { autoRestartUsed = false }, deps.autoRestartResetMs ?? AUTO_RESTART_RESET_MS)
    ;(stabilityTimer as { unref?: () => void }).unref?.()
  }

  function installDownloadHandler(window: EditorWindow): void {
    if (downloadInstalled) return
    downloadInstalled = true
    window.webContents.session.on('will-download', (event, item, contents) => {
      const suggested = item.getFilename()
      if (!exportFileFilter(suggested)) {
        event.preventDefault()
        return
      }
      const owner = contents === undefined ? window : deps.fromWebContents(contents)
      const target = deps.showSaveDialog(owner, suggested)
      if (!target) event.preventDefault()
      else item.setSavePath(target)
    })
  }

  async function loadAll(url: string): Promise<void> {
    for (const window of [...windows]) {
      if (!windows.has(window)) continue
      await window.loadURL(url)
    }
  }

  async function attach(window: EditorWindow, url: URL): Promise<void> {
    if (!windows.has(window)) return
    const policy = navigationPolicies.get(window)
    if (policy) policy.setExpected(url)
    else navigationPolicies.set(window, installNavigationPolicy(window.webContents, url))
    const timing = bootTiming
    bootTiming = undefined
    if (!timing) {
      await window.loadURL(url.href)
      return
    }
    try {
      await timing.measure('page', () => window.loadURL(url.href))
    } finally {
      timing.flush()
    }
  }

  async function runStart(restart: boolean): Promise<URL> {
    if (restart) {
      currentUrl = undefined
      await supervisor?.stop()
    }
    const timing = new StartupTiming()
    bootTiming = timing
    try {
      const home = resolveDshHome(deps.env, deps.getHomePath())
      const runtime = await timing.measure('runtime', () => deps.resolveRuntime(home))
      await timing.measure('profile', async () => {
        const result = await deps.deployProfile(home, runtime.template, join(dirname(dirname(runtime.cliPath)), 'node_modules'), runtime.deploy)
        return typeof result === 'string' ? { path: result, reused: false } : result
      }, (result) => result.reused ? 'hit' : 'deploy')
      supervisor ??= deps.createSupervisor({
        onUnexpectedExit: (reason) => {
          if (closing) return
          currentUrl = undefined
          if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = undefined }
          if (!autoRestartUsed) {
            /* 第一次意外退出:自动重启一次,窗口回到加载页;重启失败仍落错误页,可手动重试。 */
            autoRestartUsed = true
            const timer = setTimeout(() => { void retryAll() }, deps.autoRestartDelayMs ?? AUTO_RESTART_DELAY_MS)
            ;(timer as { unref?: () => void }).unref?.()
            return
          }
          /* 复位窗口内第二次意外退出:错误页 + 致命恢复(对话框去重由 recovery 保证)。 */
          void loadAll(deps.errorHtml(reason))
          deps.reportFatal?.(reason, 'supervisor')
        },
      })
      const url = await timing.measure('spawn-ready', () => supervisor!.start({ ...runtime, home, env: deps.env, timeoutMs: deps.timeoutMs }))
      currentUrl = url
      noteBackendStable()
      return url
    } catch (error) {
      timing.flush()
      if (bootTiming === timing) bootTiming = undefined
      throw error
    }
  }

  function ensureBackend(restart: boolean): Promise<URL> {
    if (inflight) return inflight
    if (!restart && currentUrl) return Promise.resolve(currentUrl)
    inflight = runStart(restart).finally(() => { inflight = undefined })
    return inflight
  }

  async function retryAll(): Promise<void> {
    if (closing) return
    if (retrying) return retrying
    retrying = (async () => {
      try {
        await loadAll(deps.loadingHtml())
        const url = await ensureBackend(true)
        for (const window of [...windows]) {
          try {
            await attach(window, url)
          } catch (error) {
            if (windows.has(window)) throw error
          }
        }
      } catch (error) {
        await loadAll(deps.errorHtml(error))
      }
    })().finally(() => { retrying = undefined })
    return retrying
  }

  async function createWindow(): Promise<void> {
    if (closing) return
    const window = deps.createBrowserWindow()
    windows.add(window)
    installDownloadHandler(window)
    window.webContents.on('before-input-event', (event, input) => {
      if (!isNewWindowShortcut(input)) return
      event.preventDefault()
      void createWindow()
    })
    window.on('closed', () => {
      windows.delete(window)
      navigationPolicies.delete(window)
    })
    window.show()
    await window.loadURL(deps.loadingHtml())
    try {
      const url = await ensureBackend(false)
      await attach(window, url)
    } catch (error) {
      if (windows.has(window)) await window.loadURL(deps.errorHtml(error))
    }
  }

  return {
    createWindow,
    handleSecondInstance() { void createWindow() },
    retry: retryAll,
    async shutdown() {
      if (closing) return
      closing = true
      if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = undefined }
      const pending = inflight
      if (pending) await pending.catch(() => undefined)
      currentUrl = undefined
      await supervisor?.stop()
    },
    needsGracefulShutdown() {
      return !closing && Boolean(supervisor || inflight)
    },
    isShuttingDown() {
      return closing
    },
    confirmBeforeQuit() {
      return deps.confirmBusyQuit?.() ?? Promise.resolve(true)
    },
    isOwnedWindow(window) {
      return Boolean(window && windows.has(window))
    },
    expectedUrl() {
      return currentUrl
    },
  }
}

export function claimPrimaryInstance(app: PrimaryApp, lifecycle: DesktopLifecycle): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    void app.whenReady().then(() => lifecycle.handleSecondInstance())
  })
  void app.whenReady().then(() => lifecycle.createWindow())
  let allowQuit = false
  let shutdown: Promise<void> | undefined
  app.on('before-quit', (...args: unknown[]) => {
    const event = args[0] as { preventDefault(): void }
    if (allowQuit || !lifecycle.needsGracefulShutdown()) return
    event.preventDefault()
    /* 仍有窗口报告 AI 任务在跑时先弹确认;取消则中止本次退出,下次 quit 重新询问。 */
    shutdown ??= (async () => {
      let proceed = true
      try {
        proceed = await lifecycle.confirmBeforeQuit()
      } catch { /* 确认失败不阻塞退出 */ }
      if (!proceed) { shutdown = undefined; return }
      await lifecycle.shutdown()
      allowQuit = true
      app.quit()
    })()
  })
  app.on('window-all-closed', () => app.quit())
  return true
}

/** Keep the desktop download gate and native save dialog aligned with manuscript exports. */
export function exportFileFilter(filename: string): { name: string; extensions: string[] } | undefined {
  const extension = /\.(md|txt|docx|epub)$/i.exec(filename)?.[1]?.toLowerCase()
  if (!extension) return undefined
  const names: Record<string, string> = { md: 'Markdown', txt: '纯文本', docx: 'Word 文档', epub: 'EPUB 电子书' }
  return { name: names[extension]!, extensions: [extension] }
}
