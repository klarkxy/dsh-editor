declare module 'electron' {
  export interface BrowserWindowOptions {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    show?: boolean
    webPreferences?: {
      preload?: string
      nodeIntegration?: boolean
      contextIsolation?: boolean
      sandbox?: boolean
      backgroundThrottling?: boolean
    }
  }

  export interface WebContents {
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): this
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
    session: {
      setPermissionRequestHandler(handler: (webContents: WebContents, permission: string, callback: (allowed: boolean) => void) => void): void
    }
  }

  export class BrowserWindow {
    constructor(options: BrowserWindowOptions)
    readonly webContents: WebContents
    loadURL(url: string): Promise<void>
    show(): void
    on(event: 'closed', listener: () => void): this
  }

  export interface IpcMainInvokeEvent {
    sender: WebContents
  }

  export const app: {
    whenReady(): Promise<void>
    on(event: 'window-all-closed', listener: () => void): void
    on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): void
    quit(): void
    getPath(name: 'home'): string
    getAppPath(): string
    getName(): string
    getVersion(): string
    isPackaged: boolean
  }

  export const ipcMain: {
    on(channel: string, listener: (event: { sender: WebContents }, ...args: unknown[]) => void): void
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void
  }
}

declare namespace NodeJS {
  interface Process {
    resourcesPath: string
  }
}
