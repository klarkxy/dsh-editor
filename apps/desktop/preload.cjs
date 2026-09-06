'use strict'

// The frameless window's only bridge: the renderer's own title bar drives
// minimize/maximize/close through these channels. Everything else stays a
// regular remote page with no Node/Electron surface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshWindow', {
  minimize: () => ipcRenderer.send('dsh-window:minimize'),
  toggleMaximize: () => ipcRenderer.send('dsh-window:toggle-maximize'),
  close: () => ipcRenderer.send('dsh-window:close'),
  // Whitelisted https links only; the main process validates before opening.
  openExternal: (url) => ipcRenderer.send('dsh-window:open-external', url),
  // About / update page: renderer is locked behind a strict CSP that blocks
  // api.github.com, so the main process owns the network round-trip.
  getAppInfo: () => ipcRenderer.invoke('dsh-window:get-app-info'),
  checkForUpdate: () => ipcRenderer.invoke('dsh-window:check-update'),
  // 启动时的后台更新检查:主进程缓存结果,渲染端挂载后拉取,仅在发现新版本时提示。
  getStartupUpdate: () => ipcRenderer.invoke('dsh-window:startup-update'),
  // 一键更新:主进程下载(镜像优先)并负责安装/重启;进度经事件回推。
  downloadUpdate: (asset) => ipcRenderer.invoke('dsh-window:download-update', asset),
  cancelUpdateDownload: () => ipcRenderer.invoke('dsh-window:cancel-update-download'),
  installUpdate: (path) => ipcRenderer.invoke('dsh-window:install-update', { path }),
  onUpdateProgress: (listener) => {
    const handler = (_event, progress) => listener(progress)
    ipcRenderer.on('dsh-window:update-progress', handler)
    return () => ipcRenderer.removeListener('dsh-window:update-progress', handler)
  },
  onMaximizedChange: (listener) => {
    const handler = (_event, maximized) => listener(Boolean(maximized))
    ipcRenderer.on('dsh-window:maximized', handler)
    return () => ipcRenderer.removeListener('dsh-window:maximized', handler)
  },
})
