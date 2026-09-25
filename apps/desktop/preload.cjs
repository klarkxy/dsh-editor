'use strict'

// The frameless window's only bridge: the renderer's own title bar drives
// minimize/maximize/close through these channels. Everything else stays a
// regular remote page with no Node/Electron surface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshWindow', {
  minimize: () => ipcRenderer.send('dsh-window:minimize'),
  toggleMaximize: () => ipcRenderer.send('dsh-window:toggle-maximize'),
  close: () => ipcRenderer.send('dsh-window:close'),
  retry: () => ipcRenderer.send('dsh-window:retry'),
  // Whitelisted https links only; the main process validates before opening.
  openExternal: (url) => ipcRenderer.send('dsh-window:open-external', url),
  // About / update page: renderer is locked behind a strict CSP that blocks
  // api.github.com, so the main process owns the network round-trip.
  getAppInfo: () => ipcRenderer.invoke('dsh-window:get-app-info'),
  checkForUpdate: () => ipcRenderer.invoke('dsh-window:check-update'),
  // 启动时的后台更新检查:主进程缓存结果,渲染端挂载后拉取,仅在发现新版本时提示。
  getStartupUpdate: () => ipcRenderer.invoke('dsh-window:startup-update'),
  // 一键更新:渲染端只传主进程签发的 updateId,不能指定 URL、文件名或安装路径。
  downloadUpdate: (updateId) => ipcRenderer.invoke('dsh-window:download-update', { updateId }),
  getDownloadedUpdate: (updateId) => ipcRenderer.invoke('dsh-window:get-downloaded-update', { updateId }),
  revealDownloadedUpdate: (updateId) => ipcRenderer.invoke('dsh-window:reveal-downloaded-update', { updateId }),
  openUpdateFolder: () => ipcRenderer.invoke('dsh-window:open-update-folder'),
  cancelUpdateDownload: () => ipcRenderer.invoke('dsh-window:cancel-update-download'),
  installUpdate: (updateId) => ipcRenderer.invoke('dsh-window:install-update', { updateId }),
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
  clipboard: {
    readText: () => ipcRenderer.invoke('dsh-window:clipboard-read-text'),
    writeText: (text) => ipcRenderer.invoke('dsh-window:clipboard-write-text', text),
  },
})
