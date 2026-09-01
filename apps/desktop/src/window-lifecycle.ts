import { dirname, join } from 'node:path'
import { installNavigationPolicy } from './navigation.js'
import { deployProfile, resolveDshHome } from './profile.js'
import type { DshLaunch, DshSupervisorOptions } from './supervisor.js'

const RETRY_HREFS = new Set(['dsh-editor://retry', 'dsh-editor://retry/'])

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
  resolveRuntime(home: string): Promise<{ nodePath: string; cliPath: string; template: string }>
  deployProfile: typeof deployProfile
  createSupervisor(options: DshSupervisorOptions): DesktopSupervisor
  errorHtml(error: unknown): string
  loadingHtml(): string
  getHomePath(): string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export interface DesktopLifecycle {
  createWindow(): Promise<void>
  handleSecondInstance(): void
  shutdown(): Promise<void>
  needsGracefulShutdown(): boolean
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

export function createDesktopLifecycle(deps: DesktopLifecycleDeps): DesktopLifecycle {
  const windows = new Set<EditorWindow>()
  const navigationPolicies = new Map<EditorWindow, ReturnType<typeof installNavigationPolicy>>()
  let supervisor: DesktopSupervisor | undefined
  let currentUrl: URL | undefined
  let inflight: Promise<URL> | undefined
  let closing = false
  let downloadInstalled = false

  function installDownloadHandler(window: EditorWindow): void {
    if (downloadInstalled) return
    downloadInstalled = true
    window.webContents.session.on('will-download', (event, item, contents) => {
      const suggested = item.getFilename()
      if (!/\.(?:md|txt)$/i.test(suggested)) {
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
    await window.loadURL(url.href)
  }

  async function runStart(restart: boolean): Promise<URL> {
    if (restart) {
      currentUrl = undefined
      await supervisor?.stop()
    }
    const home = resolveDshHome(deps.env, deps.getHomePath())
    const runtime = await deps.resolveRuntime(home)
    await deps.deployProfile(home, runtime.template, join(dirname(dirname(runtime.cliPath)), 'node_modules'))
    supervisor ??= deps.createSupervisor({
      onUnexpectedExit: (reason) => {
        if (closing) return
        currentUrl = undefined
        void loadAll(deps.errorHtml(reason))
      },
    })
    const url = await supervisor.start({ ...runtime, home, env: deps.env, timeoutMs: deps.timeoutMs })
    currentUrl = url
    return url
  }

  function ensureBackend(restart: boolean): Promise<URL> {
    if (inflight) return inflight
    if (!restart && currentUrl) return Promise.resolve(currentUrl)
    inflight = runStart(restart).finally(() => { inflight = undefined })
    return inflight
  }

  async function retryAll(): Promise<void> {
    if (closing) return
    try {
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
  }

  async function createWindow(): Promise<void> {
    if (closing) return
    const window = deps.createBrowserWindow()
    windows.add(window)
    installDownloadHandler(window)
    window.webContents.on('will-navigate', (event, url) => {
      if (!RETRY_HREFS.has(url)) return
      event.preventDefault()
      void retryAll()
    })
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
    async shutdown() {
      if (closing) return
      closing = true
      const pending = inflight
      if (pending) await pending.catch(() => undefined)
      currentUrl = undefined
      await supervisor?.stop()
    },
    needsGracefulShutdown() {
      return !closing && Boolean(supervisor || inflight)
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
    shutdown ??= lifecycle.shutdown().finally(() => {
      allowQuit = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => app.quit())
  return true
}
