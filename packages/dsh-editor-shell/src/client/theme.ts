import { createElement as e, useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'dsh-editor.theme'
export const THEME_VALUES = ['paper', 'ink'] as const
export type ThemeValue = (typeof THEME_VALUES)[number]

const DEFAULT_THEME: ThemeValue = 'paper'

function readInitialTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemeValue {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    if (value && (THEME_VALUES as readonly string[]).includes(value)) return value as ThemeValue
  } catch {
    /* Storage is best-effort; fall through to the system preference. */
  }
  if (typeof globalThis.matchMedia === 'function') {
    const prefersDark = globalThis.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? 'ink' : 'paper'
  }
  return DEFAULT_THEME
}

function applyTheme(theme: ThemeValue): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

function persistTheme(storage: Pick<Storage, 'setItem'> | undefined, theme: ThemeValue): void {
  try { storage?.setItem(THEME_STORAGE_KEY, theme) } catch { /* Persistence is best-effort. */ }
}

export function useTheme(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): [ThemeValue, (value: ThemeValue) => void] {
  const [theme, setThemeState] = useState<ThemeValue>(() => readInitialTheme(storage))
  useEffect(() => { applyTheme(theme) }, [theme])
  const setTheme = (value: ThemeValue) => {
    persistTheme(storage, value)
    setThemeState(value)
  }
  return [theme, setTheme]
}

export function ThemeToggle({ theme, onChange, label = '主题' }: { theme: ThemeValue; onChange(next: ThemeValue): void; label?: string }) {
  return e('button', {
    type: 'button',
    className: 'theme-toggle',
    title: theme === 'paper' ? '当前：纸；点击切到墨' : '当前：墨；点击切到纸',
    'aria-label': `${label}（当前${theme === 'paper' ? '纸' : '墨'}）`,
    onClick: () => onChange(theme === 'paper' ? 'ink' : 'paper'),
  }, theme === 'paper' ? '纸' : '墨')
}
