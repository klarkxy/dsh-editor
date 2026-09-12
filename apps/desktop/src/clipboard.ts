import { isAllowedNavigation } from './dsh-url.js'

export type ClipboardTrustInput = {
  owned: boolean
  destroyed: boolean
  isMainFrame: boolean
  url: string
  expected: URL | undefined
}

export function isTrustedClipboardSender(input: ClipboardTrustInput): boolean {
  if (!input.owned || input.destroyed || !input.isMainFrame || !input.expected) return false
  if (!input.url) return false
  return isAllowedNavigation(input.url, input.expected)
}

export function clipboardWritePayload(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export type ClipboardApi = {
  readText(): string
  writeText(text: string): void
}

export function readTrustedClipboardText(clipboard: ClipboardApi, trust: ClipboardTrustInput): string {
  if (!isTrustedClipboardSender(trust)) throw new Error('clipboard access denied')
  return clipboard.readText()
}

export function writeTrustedClipboardText(clipboard: ClipboardApi, trust: ClipboardTrustInput, value: unknown): void {
  if (!isTrustedClipboardSender(trust)) throw new Error('clipboard access denied')
  const text = clipboardWritePayload(value)
  if (text === undefined) throw new Error('clipboard write requires a string')
  clipboard.writeText(text)
  // Electron can silently fail when the OS denies clipboard access. Never
  // report a successful cut until the exact text can be read back.
  if (clipboard.readText() !== text) throw new Error('clipboard write failed')
}
