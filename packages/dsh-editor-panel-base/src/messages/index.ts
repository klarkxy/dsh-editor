/**
 * Generic i18n message system for panels.
 * 
 * Provides:
 * - Type-safe message keys
 * - Locale switching (zh/en)
 * - Template interpolation {param}
 * - Fallback to zh if key missing
 * 
 * @module dsh-editor-panel-base/messages
 */

import type { ShellLocale } from 'dsh-editor-seats'

/**
 * Parameters for message interpolation.
 */
export type MessageParams = Record<string, string | number>

/**
 * Create a type-safe i18n message system for a panel.
 * 
 * @example
 * ```ts
 * // In memory-panel/messages.ts
 * const zh = {
 *   'memory.title': '记忆更新',
 *   'memory.loading': '正在读取…',
 *   'error.generic': '操作未能完成。',
 * } as const
 * 
 * const en: Record<keyof typeof zh, string> = {
 *   'memory.title': 'Memory updates',
 *   'memory.loading': 'Loading…',
 *   'error.generic': 'Action failed.',
 * }
 * 
 * export const { t, message, setLocale, intlLocale } = createMessages({ zh, en })
 * export type MessageKey = keyof typeof zh
 * ```
 * 
 * @param dictionaries - zh and en message dictionaries
 * @returns Message functions (t, message, setLocale, intlLocale)
 */
export function createMessages<T extends Record<string, string>>(
  dictionaries: {
    zh: T
    en: Record<keyof T, string>
  }
) {
  type MessageKey = keyof T
  
  let currentLocale: ShellLocale = 'zh'

  /**
   * Set the current locale for the t() function.
   */
  function setLocale(locale: ShellLocale): void {
    currentLocale = locale === 'en' ? 'en' : 'zh'
  }

  /**
   * Get Intl-compatible locale string (zh-CN or en).
   */
  function intlLocale(locale: ShellLocale = currentLocale): string {
    return locale === 'en' ? 'en' : 'zh-CN'
  }

  /**
   * Interpolate template with parameters.
   * Replaces {name} with params.name.
   */
  function interpolate(template: string, params?: MessageParams): string {
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = params[name]
      return value === undefined ? `{${name}}` : String(value)
    })
  }

  /**
   * Get localized message using current locale.
   * Falls back to zh if key not found in current locale.
   */
  function t(key: MessageKey, params?: MessageParams): string {
    const dict = currentLocale === 'en' ? dictionaries.en : dictionaries.zh
    const text = dict[key] || dictionaries.zh[key] || String(key)
    return interpolate(text, params)
  }

  /**
   * Get localized message for a specific locale.
   * Falls back to zh if key not found.
   */
  function message(locale: ShellLocale, key: MessageKey, params?: MessageParams): string {
    const dict = locale === 'en' ? dictionaries.en : dictionaries.zh
    const text = dict[key] || dictionaries.zh[key] || String(key)
    return interpolate(text, params)
  }

  return {
    t,
    message,
    setLocale,
    intlLocale,
    interpolate,
  }
}
