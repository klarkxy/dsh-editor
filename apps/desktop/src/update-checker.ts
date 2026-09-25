// Pure release lookup; only the main process may use the network.
import { isTrustedReleaseAssetUrl, parseGitHubDigest, selectAsset } from './release-artifacts.js'
import type { InternalUpdateCheckResult } from './update-session.js'
export { selectAsset }
export interface UpdateAsset { name: string; url: string; size: number; digest?: string }
export type UpdateCheckResult = InternalUpdateCheckResult
const RELEASES_URL = 'https://api.github.com/repos/klarkxy/dsh-editor/releases/latest'
const BUILTIN_MIRROR_PREFIXES = ['https://ghproxy.net/', 'https://gh-proxy.com/', 'https://ghfast.top/']
export interface DownloadCandidate { label: string; url: string }

export function buildDownloadCandidates(url: string, envValue?: string): DownloadCandidate[] {
  if (!isTrustedReleaseAssetUrl(url)) throw new Error('更新地址不是官方 GitHub 发布附件')
  const prefixes = [...(envValue ?? '').split(','), ...BUILTIN_MIRROR_PREFIXES]
  const seen = new Set<string>()
  const candidates: DownloadCandidate[] = []
  for (const raw of prefixes) {
    try {
      const prefix = new URL(raw.trim())
      if (prefix.protocol !== 'https:' || prefix.username || prefix.password || prefix.search || prefix.hash) continue
      const normalized = prefix.toString().replace(/\/?$/, '/')
      if (seen.has(normalized)) continue
      seen.add(normalized)
      candidates.push({ label: prefix.host, url: normalized + url })
    } catch { /* Invalid optional mirrors do not disable official downloads. */ }
  }
  candidates.push({ label: 'github.com(直连)', url })
  return candidates
}

export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  const conflicts = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim())
    if (!match) continue
    const name = match[2]!.trim(), digest = match[1]!.toLowerCase()
    if (sums.has(name) && sums.get(name) !== digest) conflicts.add(name)
    sums.set(name, digest)
  }
  for (const name of conflicts) sums.delete(name)
  return sums
}

function parseVersion(value: string): { core: bigint[]; pre: string[] } | undefined {
  const match = /^[vV]?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
  if (!match) return undefined
  const pre = match[4]?.split('.') ?? []
  if (pre.some((part) => /^0\d+$/.test(part))) return undefined
  return { core: [BigInt(match[1]!), BigInt(match[2] ?? '0'), BigInt(match[3] ?? '0')], pre }
}
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a), right = parseVersion(b)
  if (!left || !right) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i]! > right.core[i]! ? 1 : -1
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length ? -1 : right.pre.length ? 1 : 0
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const l = left.pre[i], r = right.pre[i]
    if (l === r) continue
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r)
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1
    if (ln !== rn) return ln ? -1 : 1
    return l > r ? 1 : -1
  }
  return 0
}

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function parseAssets(value: unknown): UpdateAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record || typeof record.name !== 'string' || !record.name || typeof record.browser_download_url !== 'string' || !record.browser_download_url) return []
    const size = typeof record.size === 'number' && Number.isSafeInteger(record.size) && record.size > 0 ? record.size : 0
    const digest = parseGitHubDigest(record.digest)
    return [{ name: record.name, url: record.browser_download_url, size, ...(digest ? { digest } : {}) }]
  })
}
export async function checkLatest(currentVersion: string, fetchImpl: FetchLike = globalThis.fetch): Promise<UpdateCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(RELEASES_URL, {
      headers: { 'User-Agent': 'dsh-editor', Accept: 'application/vnd.github+json' }, signal: controller.signal,
    })
    if (response.status === 404) return { status: 'latest', currentVersion }
    if (response.status !== 200) return { status: 'error', currentVersion, error: `GitHub returned HTTP ${response.status}` }
    const payload = asRecord(await response.json())
    if (!payload) throw new Error('GitHub returned an unexpected payload')
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : ''
    if (!tag) throw new Error('GitHub release is missing tag_name')
    // latest is a stable channel. Never reinterpret malformed tags as equal or newer.
    if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) || payload.draft === true || payload.prerelease === true || !parseVersion(currentVersion)) {
      throw new Error('GitHub release has an invalid or non-stable version')
    }
    const version = tag.replace(/^v/, '')
    return {
      status: compareVersions(currentVersion, version) < 0 ? 'update-available' : 'latest', currentVersion,
      latest: {
        version, tag,
        name: typeof payload.name === 'string' ? payload.name : '',
        publishedAt: typeof payload.published_at === 'string' ? payload.published_at : '',
        url: `https://github.com/klarkxy/dsh-editor/releases/tag/${encodeURIComponent(tag)}`,
        body: (typeof payload.body === 'string' ? payload.body : '').slice(0, 2000),
        assets: parseAssets(payload.assets),
      },
    }
  } catch (error) {
    return { status: 'error', currentVersion, error: error instanceof Error ? error.message : String(error) }
  } finally { clearTimeout(timer) }
}
