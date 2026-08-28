const READY_PREFIX = 'dsh web: '

/** Parse only DSH's documented readiness line, never a URL-shaped log fragment. */
export function parseDshWebUrl(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const candidate = line.slice(READY_PREFIX.length).trim()
  const canonical = candidate.split(' ', 1)[0]
  if (!canonical) return undefined
  let url: URL
  try { url = new URL(canonical) } catch { return undefined }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return undefined
  if (url.username || url.password || !url.port || url.pathname !== '/' || url.search || url.hash) return undefined
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return url
}

export function isAllowedNavigation(candidate: string, expected: URL): boolean {
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' && url.origin === expected.origin
  } catch { return false }
}
