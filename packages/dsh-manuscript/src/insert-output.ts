/**
 * Local copy of the retired `@klarkxy/dsh-ai-services` insert-output helper.
 * Same author and SATA 2.1 license as this package.
 * Copyright © 2026 Klarkxy(278370456@qq.com)
 * Project Url: https://github.com/klarkxy/dsh-editor
 *              https://github.com/klarkxy/sata-license
 */

/** Keep only visible continuation text. Drop fences, reasoning, and tool payloads. */
export function sanitizeInsert(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  text = text.replace(/^```[^\n]*\n?/, '').replace(/\n```\s*$/, '')
  text = text.replace(/^(?:插入内容|Insert(?:ion)?|Continuation)\s*[:：]\s*/i, '')
  return text
}

/** Incremental visible text; split think markers never count toward the writing limit. */
export function createInsertCollector(maxChars: number): {
  append: (fragment: string) => void
  readonly full: boolean
  text: () => string
} {
  let out = ''
  let pending = ''
  let thinking = false
  const append = (fragment: string) => {
    pending += fragment
    while (pending) {
      const marker = thinking ? '</think>' : '<think>'
      const index = pending.indexOf(marker)
      if (index >= 0) {
        if (!thinking) out += pending.slice(0, index)
        pending = pending.slice(index + marker.length)
        thinking = !thinking
        continue
      }
      let keep = Math.min(marker.length - 1, pending.length)
      while (keep > 0 && !marker.startsWith(pending.slice(-keep))) keep--
      if (!thinking) out += pending.slice(0, pending.length - keep)
      pending = keep ? pending.slice(-keep) : ''
      break
    }
  }
  return {
    append,
    get full() {
      return out.length >= maxChars
    },
    text: () => sanitizeInsert((out + (!thinking ? pending : '')).slice(0, maxChars)),
  }
}
