import { useSyncExternalStore } from 'react'
import { zh } from './messages.zh.ts'
import { en } from './messages.en.ts'

export type Locale = 'zh' | 'en'
export type MessageKey = keyof typeof zh
export type MessageParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: MessageParams) => string

export { zh, en }

const dictionaries: Record<Locale, Record<MessageKey, string>> = { zh, en }

let currentLocale: Locale = 'zh'
const listeners = new Set<() => void>()
let persistLocale: ((locale: Locale) => void) | undefined

function emit(): void {
  for (const listener of listeners) listener()
}

export function documentLang(locale: Locale = currentLocale): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}

export function intlLocale(locale: Locale = currentLocale): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}

function applyDocumentLang(locale: Locale): void {
  const root = globalThis.document?.documentElement
  if (root) root.lang = documentLang(locale)
}

function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh'
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  const next = normalizeLocale(locale)
  if (next === currentLocale) {
    applyDocumentLang(next)
    return
  }
  currentLocale = next
  applyDocumentLang(next)
  persistLocale?.(next)
  emit()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export function t(key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[currentLocale][key] || zh[key] || String(key)
  return interpolate(text, params)
}

export function formatNumber(value: number, locale: Locale = currentLocale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}

export function formatBytes(value: number, locale: Locale = currentLocale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}

type LocalePreferenceScope = {
  getSnapshot(): { writable?: boolean; value?: { preference?: unknown } }
  set(field: 'preference', value: Locale): Promise<unknown>
  subscribe(listener: () => void): () => void
}

export function bindLocalePreference(scope: LocalePreferenceScope): () => void {
  persistLocale = (locale) => {
    const snap = scope.getSnapshot()
    if (snap.writable === false) return
    if (snap.value?.preference === locale) return
    void scope.set('preference', locale).catch(() => { /* host rejected the write */ })
  }
  const sync = () => {
    const pref = scope.getSnapshot().value?.preference
    if (pref !== 'zh' && pref !== 'en') return
    if (pref === currentLocale) return
    currentLocale = pref
    applyDocumentLang(pref)
    emit()
  }
  sync()
  applyDocumentLang(currentLocale)
  return scope.subscribe(sync)
}

/** Test helper: restore the default locale and drop any preference binding. */
export function resetLocaleForTests(): void {
  persistLocale = undefined
  if (currentLocale === 'zh') {
    applyDocumentLang('zh')
    return
  }
  currentLocale = 'zh'
  applyDocumentLang('zh')
  emit()
}

applyDocumentLang(currentLocale)
