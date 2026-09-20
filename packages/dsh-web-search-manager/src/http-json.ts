import type { WebSearchSource } from '@deepseek-ai/dsh-web'

export const MAX_RESPONSE_BYTES = 2_000_000

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export async function readJSON(response: Response, signal?: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response')
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export function httpsEndpoint(base: string, path = ''): string {
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid endpoint')
  return `${url.href.replace(/\/+$/, '')}${path}`
}

export function sourceFrom(raw: unknown, urlKey: string, titleKey?: string, snippetKey?: string): WebSearchSource | undefined {
  const row = record(raw)
  if (typeof row?.[urlKey] !== 'string') return
  let url: URL
  try { url = new URL(row[urlKey] as string) } catch { return }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
  const title = titleKey && typeof row[titleKey] === 'string' ? (row[titleKey] as string).slice(0, 1000) : undefined
  const snippet = snippetKey && typeof row[snippetKey] === 'string' ? (row[snippetKey] as string).slice(0, 8000) : undefined
  return { url: url.href, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) }
}
