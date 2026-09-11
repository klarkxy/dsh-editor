const READY_PREFIX = 'dsh web: '
const LOOPBACK_TOKEN = /^[A-Za-z0-9._~-]+$/

/** Parse only DSH's documented readiness line, never a URL-shaped log fragment. */
export function parseDshWebUrl(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const candidate = line.slice(READY_PREFIX.length).trim()
  const canonical = candidate.split(' ', 1)[0]
  if (!canonical) return undefined
  let url: URL
  try { url = new URL(canonical) } catch { return undefined }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return undefined
  if (url.username || url.password || !url.port || url.pathname !== '/' || url.hash) return undefined
  if (!isAllowedReadySearch(url.searchParams)) return undefined
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return url
}

function isAllowedReadySearch(params: URLSearchParams): boolean {
  const keys = [...params.keys()]
  if (keys.length === 0) return true
  if (keys.length !== 1 || keys[0] !== 'token') return false
  const token = params.get('token')
  return Boolean(token && LOOPBACK_TOKEN.test(token))
}

export function isAllowedNavigation(candidate: string, expected: URL): boolean {
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' && url.origin === expected.origin
  } catch { return false }
}
