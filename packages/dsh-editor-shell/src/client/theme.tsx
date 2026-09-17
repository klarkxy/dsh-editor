import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t, useLocale } from '../i18n/index.ts'
import { IconButton } from '@radix-ui/themes'
import { ThemeInkIcon, ThemePaperIcon } from './icons.tsx'
import { Tooltip } from './ui/index.ts'


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
  // The local light/dark choice is the source of truth at mount: the host may
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

const DEFAULT_ACCENT: AccentValue = 'indigo'

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
