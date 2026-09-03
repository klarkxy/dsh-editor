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
  onMaximizedChange: (listener) => {
    const handler = (_event, maximized) => listener(Boolean(maximized))
    ipcRenderer.on('dsh-window:maximized', handler)
    return () => ipcRenderer.removeListener('dsh-window:maximized', handler)
  },
})
