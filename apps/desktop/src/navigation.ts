import { isAllowedNavigation } from './dsh-url.js'

export interface RestrictedWebContents {
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown
  setWindowOpenHandler(handler: () => { action: 'deny' }): unknown
  session: {
    setPermissionRequestHandler(handler: (_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void): unknown
    webRequest?: {
      onHeadersReceived(handler: (details: { responseHeaders?: Record<string, string[]> }, callback: (response: { responseHeaders: Record<string, string[]> }) => void) => void): unknown
    }
  }
}

export interface NavigationPolicy {
  setExpected(expected: URL): void
}

export function installNavigationPolicy(contents: RestrictedWebContents, expected: URL): NavigationPolicy {
  let allowed = expected
  contents.on('will-navigate', (event, candidate) => {
    if (!isAllowedNavigation(candidate, allowed)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  contents.session.webRequest?.onHeadersReceived((details, callback) => callback({
    responseHeaders: {
      ...(details.responseHeaders ?? {}),
      'Content-Security-Policy': [
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; worker-src 'self' blob:",
      ],
    },
  }))
  return { setExpected(expectedUrl) { allowed = expectedUrl } }
}
