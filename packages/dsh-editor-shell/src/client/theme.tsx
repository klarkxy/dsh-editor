import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '../i18n/index.ts'
import { IconButton } from '@radix-ui/themes'
import { ThemeInkIcon, ThemePaperIcon } from './icons.tsx'
import { Tooltip } from './ui/index.ts'
import {
  hostPreferenceToTheme,
  persistTheme,
  readInitialTheme,
  themeToHostPreference,
  type HostThemeSync,
  type ThemeValue,
} from '../model/theme.ts'

function applyTheme(theme: ThemeValue): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
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
