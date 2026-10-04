import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t, useLocale } from '../i18n/index.ts'
import { IconButton } from '@radix-ui/themes'
import { ThemeInkIcon, ThemePaperIcon } from './icons.tsx'
import { Tooltip } from './ui/index.ts'
import { DEFAULT_SHELL_ACCENT } from '../design-system/tokens.ts'


export const THEME_STORAGE_KEY = 'dsh-editor.theme'
export const THEME_VALUES = ['light', 'dark'] as const
export type ThemeValue = (typeof THEME_VALUES)[number]

export const DEFAULT_THEME: ThemeValue = 'light'

const LEGACY_THEME_VALUES: Record<string, ThemeValue> = {
  paper: 'light',
  ink: 'dark',
}

/*
 * Host appearance sync: the DSH host owns a `ui-theme` settings namespace with
 * `preference: 'light' | 'dark' | 'system'`; the settings dialog and all host
 * chrome follow it. The editor's light/dark toggle is the primary control, so
 * we write it through (light→light, dark→dark) and mirror host-side edits back.
 * `system` has no editor equivalent — it resolves through prefers-color-scheme
 * at the moment we read it, then lands as a concrete light/dark value.
 */
export const HOST_THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export type HostThemePreference = (typeof HOST_THEME_PREFERENCES)[number]

export type HostThemeSync = {
  read(): HostThemePreference | undefined
  write(preference: HostThemePreference, signal?: AbortSignal): Promise<unknown> | void
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
  return theme === 'dark' ? 'dark' : 'light'
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
 * default theme while the editor renders dark. Subscribe BEFORE the first
 * attempt so a load completing between check and subscribe cannot strand the
 * write; once the scope is readable the write lands (or is skipped
 * because the host already agrees) and the subscription disposes.
 */
export function writeHostThemePreference(
  scope: HostThemeScope,
  preference: HostThemePreference,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let issued = false
    let settled = false
    let dispose: (() => void) | undefined
    const cleanup = () => { dispose?.(); signal?.removeEventListener('abort', abort) }
    const finish = (success: boolean, result?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (success) resolve(result)
      else reject(result)
    }
    const abort = () => finish(false, new DOMException('Theme sync cancelled', 'AbortError'))
    const attempt = () => {
      if (issued || settled) return
      const snapshot = scope.getSnapshot()
      if (snapshot.writable === false || snapshot.value === undefined) return
      issued = true // set() may synchronously notify the scope's subscribers.
      dispose?.()
      if (snapshot.value.preference === preference) { finish(true); return }
      try { Promise.resolve(scope.set('preference', preference)).then(result => finish(true, result), error => finish(false, error)) }
      catch (error) { finish(false, error) }
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    // Subscribe before checking: a load may replay synchronously from subscribe.
    dispose = scope.subscribe(attempt)
    if (issued || settled) dispose()
    attempt()
  })
}

export function hostPreferenceToTheme(preference: HostThemePreference): ThemeValue {
  if (preference === 'system') {
    return prefersDark() ? 'dark' : 'light'
  }
  return preference === 'dark' ? 'dark' : 'light'
}

function prefersDark(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches
}

export function readInitialTheme(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): ThemeValue {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    if (value && (THEME_VALUES as readonly string[]).includes(value)) return value as ThemeValue
    const migrated = value ? LEGACY_THEME_VALUES[value] : undefined
    if (migrated) {
      persistTheme(storage, migrated)
      return migrated
    }
  } catch {
    /* Storage is best-effort; fall through to the system preference. */
  }
  if (typeof globalThis.matchMedia === 'function') {
    return prefersDark() ? 'dark' : 'light'
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
  const syncRef = useRef<{ request(): void }>()

  useEffect(() => {
    applyTheme(theme)
    syncRef.current?.request()
  }, [theme])

  useEffect(() => {
    if (!hostSync) return
    const controller = new AbortController()
    let active = true
    let ready = false
    let pending = false
    let notifiedWhilePending = false
    const request = () => {
      if (!active || pending) return
      ready = true
      const desired = themeRef.current
      const current = hostSync.read()
      if (current && hostPreferenceToTheme(current) === desired) return
      pending = true
      notifiedWhilePending = false
      // One write at a time. Its echo cannot override a newer local choice;
      // after its receipt settles, converge to that choice instead.
      try {
        Promise.resolve(hostSync.write(themeToHostPreference(desired), controller.signal)).then(() => {
          if (!active) return
          pending = false
          // A Host edit may arrive between the write echo and its receipt.
          // Reconcile that snapshot too; otherwise Host and paper can diverge.
          if (notifiedWhilePending || themeRef.current !== desired) request()
        }, () => {
          if (active) pending = false // A failed save must not retry forever.
        })
      } catch { pending = false }
    }
    const dispose = hostSync.subscribe(() => {
      if (!active || !ready) return
      if (pending) { notifiedWhilePending = true; return }
      const preference = hostSync.read()
      if (!preference) return
      const mapped = hostPreferenceToTheme(preference)
      if (mapped === themeRef.current) return
      themeRef.current = mapped
      persistTheme(storage, mapped)
      setThemeState(mapped)
    })
    const sync = { request }
    syncRef.current = sync
    request() // The local preference remains authoritative at startup/loading.
    return () => {
      active = false
      controller.abort()
      dispose()
      if (syncRef.current === sync) syncRef.current = undefined
    }
  }, [hostSync, storage])

  const setTheme = (value: ThemeValue) => {
    themeRef.current = value
    persistTheme(storage, value)
    setThemeState(value)
    syncRef.current?.request()
  }
  return [theme, setTheme]
}

/*
 * Accent is orthogonal to light/dark. Radix Themes owns the colour scales;
 * this store only persists the curated accent name. Selection lives in
 * localStorage — the host ui-theme namespace does not know accents, and
 * host chrome does not need them.
 * State is a module-level store: the settings dialog and shell root each
 * mount a hook instance and stay in sync through subscribe.
 */
export const ACCENT_STORAGE_KEY = 'dsh-editor.accent'
export const ACCENT_VALUES = ['indigo', 'blue', 'teal', 'green', 'amber', 'crimson', 'violet'] as const
export type AccentValue = (typeof ACCENT_VALUES)[number]

const DEFAULT_ACCENT: AccentValue = DEFAULT_SHELL_ACCENT

const LEGACY_ACCENT_VALUES: Record<string, AccentValue> = {
  pine: 'green',
  ochre: 'amber',
}

export function readStoredAccent(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): AccentValue {
  try {
    const value = storage?.getItem(ACCENT_STORAGE_KEY)
    if (value && (ACCENT_VALUES as readonly string[]).includes(value)) return value as AccentValue
    const migrated = value ? LEGACY_ACCENT_VALUES[value] : undefined
    if (migrated) {
      try { storage?.setItem(ACCENT_STORAGE_KEY, migrated) } catch { /* Persistence is best-effort. */ }
      return migrated
    }
  } catch {
    /* Storage is best-effort; fall back to the default. */
  }
  return DEFAULT_ACCENT
}

function applyAccent(_accent: AccentValue): void {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute('data-accent')
}

const accentListeners = new Set<() => void>()
let currentAccent: AccentValue | undefined

function accentSnapshot(): AccentValue {
  if (currentAccent === undefined) currentAccent = readStoredAccent(globalThis.localStorage)
  return currentAccent
}

// Apply at import time so a leftover data-accent from a previous build is cleared.
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

export function ThemeToggle({ theme, onChange, label }: { theme: ThemeValue; onChange(next: ThemeValue): void; label?: string }) {
  useLocale()
  const resolvedLabel = label ?? t('theme.label')
  const value = theme === 'light' ? t('theme.light') : t('theme.dark')
  const hint = theme === 'light' ? t('theme.toDark') : t('theme.toLight')
  return (
    <Tooltip
      content={hint}
      children={<IconButton
        type="button"
        className="theme-toggle"
        variant="ghost"
        color="gray"
        size="2"
        title={hint}
        aria-label={t('theme.aria', { label: resolvedLabel, value })}
        onClick={() => onChange(theme === 'light' ? 'dark' : 'light')}>
        {theme === 'light' ? <ThemePaperIcon size={16} /> : <ThemeInkIcon size={16} />}
      </IconButton>} />
  );
}
