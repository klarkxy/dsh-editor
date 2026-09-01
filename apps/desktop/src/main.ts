import { app, BrowserWindow, dialog } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployProfile } from './profile.js'
import { materializePackagedRuntime } from './runtime-cache.js'
import { DshSupervisor } from './supervisor.js'
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
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>DSH Editor</title><style>body{font-family:system-ui;margin:3rem;max-width:48rem;line-height:1.5}code{display:block;white-space:pre-wrap;margin:1rem 0;padding:1rem;background:#f4f2ea}a{display:inline-block;padding:.5rem .8rem;border:1px solid #777;color:#222;text-decoration:none}</style><h1>DSH Editor 启动失败</h1><p>本地 DSH 服务未能就绪，请根据下面的诊断信息排查后重试。</p><code>${escaped}</code><a href="dsh-editor://retry">重试</a>`)}`
}

function loadingHtml(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>DSH Editor</title><style>body{font-family:system-ui;display:grid;place-content:center;height:100vh;margin:0;background:#faf9f5;color:#393832}main{text-align:center}p{color:#77746c}</style><main><h1>DSH Editor</h1><p>正在启动本地写作环境…</p></main>')}`
}

const lifecycle = createDesktopLifecycle({
  createBrowserWindow: () => new BrowserWindow({
    title: 'DSH Editor', width: 1440, height: 900, minWidth: 1280, minHeight: 720,
    show: false, autoHideMenuBar: true, backgroundColor: '#faf9f5',
    icon: join(desktopRoot, 'build', 'icon.png'),
    webPreferences: {
      preload: join(desktopRoot, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  }) as unknown as EditorWindow,
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

claimPrimaryInstance(app as unknown as PrimaryApp, lifecycle)
