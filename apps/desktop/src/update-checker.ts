// Lightweight GitHub release lookup for the in-app "About / update" page.
//
// The renderer is locked down by a strict Content-Security-Policy that only
// permits `connect-src 'self' ws://127.0.0.1:*`, so any network call to
// api.github.com has to go through the main process. This module stays free of
// Electron imports on purpose so it can be unit-tested with a stubbed fetch.

export interface UpdateCheckLatest {
  version: string
  tag: string
  name: string
  publishedAt: string
  url: string
  body: string
}

export interface UpdateCheckResult {
  status: 'latest' | 'update-available' | 'error'
  currentVersion: string
  latest?: UpdateCheckLatest
  error?: string
}

const RELEASES_URL = 'https://api.github.com/repos/klarkxy/dsh-editor/releases/latest'
const REQUEST_TIMEOUT_MS = 10_000
const BODY_LIMIT = 2000

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number
  json(): Promise<unknown>
}>

function defaultFetch(input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) {
  return globalThis.fetch(input, init) as unknown as ReturnType<FetchLike>
}

/**
 * Strip a leading `v`/`V` from a tag like `v0.2.0`. Anything else passes through
 * so the caller's local version (`0.1.1`, no prefix) still compares correctly.
 */
function stripTagPrefix(tag: string): string {
  return tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag
}

/**
 * Compare two stable semver strings segment by segment. Returns a negative
 * number if `a < b`, zero if equal, positive if `a > b`. Trailing zero segments
 * (`0.1` vs `0.1.0`) are treated as equal. Prerelease suffixes are not
 * supported — the desktop app only ships stable releases.
 */
export function compareVersions(a: string, b: string): number {
  const left = stripTagPrefix(a).split('.').map((part) => Number.parseInt(part, 10))
  const right = stripTagPrefix(b).split('.').map((part) => Number.parseInt(part, 10))
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) return 0
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index] ?? 0
    const rightSegment = right[index] ?? 0
    if (leftSegment === rightSegment) continue
    return leftSegment - rightSegment
  }
  return 0
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

export async function checkLatest(
  currentVersion: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<UpdateCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(RELEASES_URL, {
      headers: {
        'User-Agent': 'dsh-editor',
        Accept: 'application/vnd.github+json',
      },
      signal: controller.signal,
    })
    if (response.status === 404) {
      // No release published yet — treat the local build as up to date.
      return { status: 'latest', currentVersion }
    }
    if (response.status !== 200) {
      return { status: 'error', currentVersion, error: `GitHub returned HTTP ${response.status}` }
    }
    const payload = asRecord(await response.json())
    if (!payload) {
      return { status: 'error', currentVersion, error: 'GitHub returned an unexpected payload' }
    }
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : ''
    const name = typeof payload.name === 'string' ? payload.name : ''
    const publishedAt = typeof payload.published_at === 'string' ? payload.published_at : ''
    const url = typeof payload.html_url === 'string' ? payload.html_url : ''
    const body = truncate(typeof payload.body === 'string' ? payload.body : '', BODY_LIMIT)
    if (!tag) {
      return { status: 'error', currentVersion, error: 'GitHub release is missing tag_name' }
    }
    const version = stripTagPrefix(tag)
    const status: UpdateCheckResult['status'] = compareVersions(currentVersion, version) < 0
      ? 'update-available'
      : 'latest'
    return {
      status,
      currentVersion,
      latest: { version, tag, name, publishedAt, url, body },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', currentVersion, error: message }
  } finally {
    clearTimeout(timer)
  }
}
