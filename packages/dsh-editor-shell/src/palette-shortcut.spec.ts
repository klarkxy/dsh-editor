import { describe, expect, it } from 'vitest'
import { detectShortcutPlatform, paletteShortcutHint } from './palette-shortcut.ts'

describe('paletteShortcutHint', () => {
  it('uses Ctrl+K as the visible label on Windows and Linux, never ⌘', () => {
    expect(paletteShortcutHint('win32')).toBe('Ctrl+K')
    expect(paletteShortcutHint('linux')).toBe('Ctrl+K')
    expect(paletteShortcutHint('win32')).not.toMatch(/⌘/)
    expect(paletteShortcutHint('linux')).not.toMatch(/⌘/)
  })

  it('keeps ⌘K as the visible label on macOS', () => {
    expect(paletteShortcutHint('darwin')).toBe('⌘K')
  })
})

describe('detectShortcutPlatform', () => {
  it('trusts an explicit Node platform when it is win32, linux, or darwin', () => {
    expect(detectShortcutPlatform({ processPlatform: 'win32' })).toBe('win32')
    expect(detectShortcutPlatform({ processPlatform: 'linux' })).toBe('linux')
    expect(detectShortcutPlatform({ processPlatform: 'darwin' })).toBe('darwin')
  })

  it('falls back to navigator platform / userAgent when process.platform is the client shim', () => {
    expect(detectShortcutPlatform({ processPlatform: 'browser', navigatorPlatform: 'Win32' })).toBe('win32')
    expect(detectShortcutPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' })).toBe('darwin')
  })
})
