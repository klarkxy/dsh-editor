import { DEFAULT_SHELL_ACCENT, SHELL_ACCENTS, type ShellAccent } from '../design-system/tokens.ts'

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

export function persistTheme(storage: Pick<Storage, 'setItem'> | undefined, theme: ThemeValue): void {
  try { storage?.setItem(THEME_STORAGE_KEY, theme) } catch { /* Persistence is best-effort. */ }
}

/*
 * Accent is orthogonal to light/dark. Radix Themes owns the colour scales and
 * the shell Theme's `accentColor`; this store only persists the curated accent
 * name, and the design system maps that name onto the primary fill, selection,
 * bubble, links and focus. Selection lives in localStorage — the host ui-theme
 * namespace does not know accents, and host chrome does not need them.
 */
export const ACCENT_STORAGE_KEY = 'dsh-editor.accent'
export const ACCENT_VALUES = SHELL_ACCENTS
export type AccentValue = ShellAccent

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
