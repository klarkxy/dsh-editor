export type StreamChunkLike = {
  type: string
  text?: string
  reason?: { kind?: string }
}

const DEFAULT_MAX_CHARS = 240

/** Keep only visible continuation text. Drop fences, reasoning, and tool payloads. */
export function sanitizeInsert(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  text = text.replace(/^```[^\n]*\n?/, '').replace(/\n```\s*$/, '')
  text = text.replace(/^(?:插入内容|Insert(?:ion)?|Continuation)\s*[:：]\s*/i, '')
  return text
}

export async function collectInsertText(
  stream: AsyncIterable<StreamChunkLike>,
  options: { maxChars?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  if (options.signal?.aborted) return ''
  let out = ''
  let pending = ''
  let thinking = false
  const appendVisible = (fragment: string) => {
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
      // Keep only a possible split marker, never buffer the reasoning body.
      let keep = Math.min(marker.length - 1, pending.length)
      while (keep > 0 && !marker.startsWith(pending.slice(-keep))) keep--
      if (!thinking) out += pending.slice(0, pending.length - keep)
      pending = keep ? pending.slice(-keep) : ''
      break
    }
  }
  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) return ''
      if (chunk.type === 'error' || chunk.type === 'aborted') return ''
      if (chunk.type !== 'text-delta' || typeof chunk.text !== 'string') continue
      appendVisible(chunk.text)
      if (out.length >= maxChars) {
        out = out.slice(0, maxChars)
        break
      }
    }
  } catch {
    return ''
  }
  if (options.signal?.aborted) return ''
  if (!thinking) out += pending
  return sanitizeInsert(out.slice(0, maxChars))
}
