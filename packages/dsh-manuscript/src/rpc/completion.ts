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
  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) return ''
      if (chunk.type === 'error' || chunk.type === 'aborted') return ''
      if (chunk.type !== 'text-delta' || typeof chunk.text !== 'string') continue
      out += chunk.text
      if (out.length >= maxChars) {
        out = out.slice(0, maxChars)
        break
      }
    }
  } catch {
    return ''
  }
  if (options.signal?.aborted) return ''
  return sanitizeInsert(out)
}
