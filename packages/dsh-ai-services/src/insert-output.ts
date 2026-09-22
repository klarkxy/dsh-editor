export type StreamChunkLike = {
  type: string
  text?: string
  reason?: { kind?: string; failure?: { message?: string } }
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
  const collector = createInsertCollector(maxChars)
  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) return ''
      if (chunk.type === 'aborted' || (chunk.type === 'finish' && chunk.reason?.kind === 'aborted')) return ''
      if (chunk.type === 'error' || (chunk.type === 'finish' && chunk.reason?.kind === 'error')) throw new Error(chunk.reason?.failure?.message || '模型请求失败，请检查模型设置后重试')
      if (chunk.type !== 'text-delta' || typeof chunk.text !== 'string') continue
      collector.append(chunk.text)
      if (collector.full) break
    }
  } catch (error) { if (options.signal?.aborted) return ''; throw error }
  return options.signal?.aborted ? '' : collector.text()
}

/** Incremental visible text; split think markers never count toward the writing limit. */
export function createInsertCollector(maxChars: number) {
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
      // Keep only a possible split marker, never buffer the reasoning body.
      let keep = Math.min(marker.length - 1, pending.length)
      while (keep > 0 && !marker.startsWith(pending.slice(-keep))) keep--
      if (!thinking) out += pending.slice(0, pending.length - keep)
      pending = keep ? pending.slice(-keep) : ''
      break
    }
  }
  return { append, get full() { return out.length >= maxChars }, text: () => sanitizeInsert((out + (!thinking ? pending : '')).slice(0, maxChars)) }
}
