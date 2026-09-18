import { isAllowedNavigation } from './dsh-url.js'

export type IpcTrustInput = {
  owned: boolean
  destroyed: boolean
  isMainFrame: boolean
  url: string
  expected: URL | undefined
}

/** 剪贴板和更新 IPC 共用:本机窗口、主 frame、来源与当前 DSH URL 一致。 */
export function isTrustedIpcSender(input: IpcTrustInput): boolean {
  if (!input.owned || input.destroyed || !input.isMainFrame || !input.expected) return false
  if (!input.url) return false
  return isAllowedNavigation(input.url, input.expected)
}

export function assertTrustedIpcSender(input: IpcTrustInput, action: string): void {
  if (!isTrustedIpcSender(input)) throw new Error(`${action} denied`)
}
