import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t, useLocale } from '../i18n/index.ts'
import { ThemeInkIcon, ThemePaperIcon } from './icons.tsx'
import { Tooltip } from './ui/index.ts'


export const THEME_STORAGE_KEY = 'dsh-editor.theme'
export const THEME_VALUES = ['paper', 'ink'] as const
export type ThemeValue = (typeof THEME_VALUES)[number]

const DEFAULT_THEME: ThemeValue = 'paper'

/*
 * Host appearance sync: the DSH host owns a `ui-theme` settings namespace with
 * `preference: 'light' | 'dark' | 'system'`; the settings dialog and all host
 * chrome follow it. The editor's paper/ink toggle is the primary control, so
 * we write it through (paper→light, ink→dark) and mirror host-side edits back.
 * `system` has no editor equivalent — it resolves through prefers-color-scheme
 * at the moment we read it, then lands as a concrete paper/ink value.
 */
export const HOST_THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export type HostThemePreference = (typeof HOST_THEME_PREFERENCES)[number]

export type HostThemeSync = {
  read(): HostThemePreference | undefined
  write(preference: HostThemePreference): void
  subscribe(listener: () => void): () => void
}

export function decodeHostThemePreference(value: unknown): { preference: HostThemePreference } | undefined {
  const preference = (value as { preference?: unknown } | null | undefined)?.preference
  if (typeof preference === 'string' && (HOST_THEME_PREFERENCES as readonly string[]).includes(preference)) {
    return { preference: preference as HostThemePreference }
  }
  return undefined
}

export function themeToHostPreference(theme: ThemeValue): HostThemePreference {
  return theme === 'ink' ? 'dark' : 'light'
}

export type HostThemeScope = {
  getSnapshot(): { writable?: boolean; value?: { preference: HostThemePreference } | undefined }
  set(field: 'preference', value: HostThemePreference): Promise<unknown>
  subscribe(listener: () => void): () => void
}

/*
 * Write-through with one retry subscription: at shell mount the settings
 * document is often still loading (`writable: false`, no value), and a
 * fire-and-forget write is silently dropped, leaving the host chrome on the
 * default theme while the editor renders ink. Subscribe BEFORE the first
 * attempt so a load completing between check and subscribe cannot strand
 * the write; once the scope is readable the write lands (or is skipped
 * because the host already agrees) and the subscription disposes.
 */
export function writeHostThemePreference(scope: HostThemeScope, preference: HostThemePreference): void {
  const attempt = (): boolean => {
    const snapshot = scope.getSnapshot()
    if (snapshot.writable === false || snapshot.value === undefined) return false
    if (snapshot.value.preference === preference) return true
    void scope.set('preference', preference).catch(() => { /* localStorage already holds the truth */ })
    return true
  }
  // The listener may fire synchronously from inside subscribe() (scopes that
  // replay their current value), before dispose is assigned — gate on done
  // and dispose defensively.
  let done = false
  let dispose: (() => void) | undefined
  const listener = () => {
    if (done || !attempt()) return
    done = true
    dispose?.()
  }
  dispose = scope.subscribe(listener)
  if (!done && attempt()) done = true
  if (done) dispose()
}

export function hostPreferenceToTheme(preference: HostThemePreference): ThemeValue {
  if (preference === 'system') {
    return prefersDark() ? 'ink' : 'paper'
  }
  return preference === 'dark' ? 'ink' : 'paper'
}

function prefersDark(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches
}

function readInitialTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemeValue {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    if (value && (THEME_VALUES as readonly string[]).includes(value)) return value as ThemeValue
  } catch {
    /* Storage is best-effort; fall through to the system preference. */
  }
  if (typeof globalThis.matchMedia === 'function') {
    return prefersDark() ? 'ink' : 'paper'
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

export function useTheme(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage,
  hostSync?: HostThemeSync,
): [ThemeValue, (value: ThemeValue) => void] {
  const [theme, setThemeState] = useState<ThemeValue>(() => readInitialTheme(storage))
  const themeRef = useRef(theme)
  themeRef.current = theme
  // The local paper/ink choice is the source of truth at mount: the host may
  // still hold its default `system` preference, and its scope replays that
  // value to subscribers before our write lands. Ignore host events until the
  // first write is issued, then only mirror genuine host-side edits (values
  // that differ from what we wrote ourselves).
  const wroteHostRef = useRef(false)

  useEffect(() => {
    applyTheme(theme)
    if (!hostSync) return
    // Skip the write when the host already agrees, so the subscribe echo cannot loop.
    const current = hostSync.read()
    if (current && hostPreferenceToTheme(current) === theme) {
      wroteHostRef.current = true
      return
    }
    wroteHostRef.current = true
    hostSync.write(themeToHostPreference(theme))
  }, [theme, hostSync])

  useEffect(() => {
    if (!hostSync) return
    // Snapshot the host value after the write effect above has run: replays of
    // that same stale value are echoes, not user edits. Only values that differ
    // from both the baseline and the current theme are genuine host-side edits.
    const baseline = hostSync.read()
    let baselineValue = baseline
    return hostSync.subscribe(() => {
      if (!wroteHostRef.current) return
      const preference = hostSync.read()
      if (!preference) return
      // The scope may still be loading at subscribe time (baseline undefined);
      // the first concrete value is the persisted state, not a user edit —
      // adopt it as the baseline instead of mirroring it over the local theme.
      if (baselineValue === undefined) { baselineValue = preference; return }
      if (preference === baselineValue) return
      baselineValue = preference
      const mapped = hostPreferenceToTheme(preference)
      if (mapped === themeRef.current) return
      persistTheme(storage, mapped)
      setThemeState(mapped)
    })
  }, [hostSync, storage])

  const setTheme = (value: ThemeValue) => {
    persistTheme(storage, value)
    setThemeState(value)
  }
  return [theme, setTheme]
}

/*
 * 色彩风格(accent):与纸/墨明暗正交,只覆盖 --accent 系四个变量,token 定义在
 * styles.ts 的 :root[data-accent] 块。选择只落 localStorage —— 宿主 ui-theme
 * 命名空间不认识色彩风格,host chrome 也不需要它。
 * 状态放在模块级 store:设置弹窗与 shell root 各挂一个 hook 实例,
 * 两边通过 subscribe 保持同步。
 */
export const ACCENT_STORAGE_KEY = 'dsh-editor.accent'
export const ACCENT_VALUES = ['indigo', 'pine', 'ochre', 'violet'] as const
export type AccentValue = (typeof ACCENT_VALUES)[number]

const DEFAULT_ACCENT: AccentValue = 'indigo'

function readStoredAccent(storage: Pick<Storage, 'getItem'> | undefined): AccentValue {
  try {
    const value = storage?.getItem(ACCENT_STORAGE_KEY)
    if (value && (ACCENT_VALUES as readonly string[]).includes(value)) return value as AccentValue
  } catch {
    /* Storage is best-effort; fall back to the default. */
  }
  return DEFAULT_ACCENT
}

function applyAccent(accent: AccentValue): void {
  if (typeof document === 'undefined') return
  if (accent === DEFAULT_ACCENT) document.documentElement.removeAttribute('data-accent')
  else document.documentElement.setAttribute('data-accent', accent)
}

const accentListeners = new Set<() => void>()
let currentAccent: AccentValue | undefined

function accentSnapshot(): AccentValue {
  if (currentAccent === undefined) currentAccent = readStoredAccent(globalThis.localStorage)
  return currentAccent
}

// Apply at import time so the first paint already carries the stored accent.
if (typeof document !== 'undefined') applyAccent(accentSnapshot())

export function useAccent(): [AccentValue, (value: AccentValue) => void] {
  const accent = useSyncExternalStore(
    (listener) => { accentListeners.add(listener); return () => { accentListeners.delete(listener) } },
    accentSnapshot,
  )
  const setAccent = (value: AccentValue) => {
    currentAccent = value
    try { globalThis.localStorage?.setItem(ACCENT_STORAGE_KEY, value) } catch { /* best-effort */ }
    applyAccent(value)
    for (const listener of [...accentListeners]) listener()
  }
  return [accent, setAccent]
}

export function ThemeToggle({ theme, onChange, label }: { theme: ThemeValue; onChange(next: ThemeValue): void; label?: string }) {  useLocale()
  const resolvedLabel = label ?? t('theme.label')
  const value = theme === 'paper' ? t('theme.paper') : t('theme.ink')
  const hint = theme === 'paper' ? t('theme.toInk') : t('theme.toPaper')
  return (
    <Tooltip
      content={hint}
      children={<button
        type="button"
        className="theme-toggle"
        title={hint}
        aria-label={t('theme.aria', { label: resolvedLabel, value })}
        onClick={() => onChange(theme === 'paper' ? 'ink' : 'paper')}>
        {theme === 'paper' ? <ThemePaperIcon size={16} /> : <ThemeInkIcon size={16} />}
      </button>} />
  );
}
