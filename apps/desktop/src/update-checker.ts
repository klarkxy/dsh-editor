// Lightweight GitHub release lookup for the in-app "About / update" page.
//
// The renderer is locked down by a strict Content-Security-Policy that only
// permits `connect-src 'self' ws://127.0.0.1:*`, so any network call to
// api.github.com has to go through the main process. This module stays free of
// Electron imports on purpose so it can be unit-tested with a stubbed fetch.

/** Release 附件:GitHub 原始下载地址 + 字节数,镜像下载前用它比对候选。 */
export interface UpdateAsset {
  name: string
  url: string
  size: number
}

export interface UpdateCheckLatest {
  version: string
  tag: string
  name: string
  publishedAt: string
  url: string
  body: string
  assets: UpdateAsset[]
  /** 当前平台/安装形态对应的附件,由主进程 selectAsset 选出;无匹配为 null。 */
  asset: UpdateAsset | null
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

/* 下载镜像:前缀式代理,按顺序尝试,直连兜底。镜像只代理 github.com 文件下载,
 * 版本检查的 api.github.com 请求不走镜像。DSH_UPDATE_MIRRORS(逗号分隔)可在
 * 内置列表之前追加/覆盖——镜像可用性变化快,用户侧有最后一道开关。 */
const BUILTIN_MIRROR_PREFIXES = [
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
  'https://ghfast.top/',
]

export interface DownloadCandidate {
  label: string
  url: string
}

function mirrorLabel(prefix: string): string {
  try {
    return new URL(prefix).host
  } catch {
    return prefix
  }
}

function joinMirrorPrefix(prefix: string, url: string): string {
  return prefix.endsWith('/') ? prefix + url : `${prefix}/${url}`
}

/**
 * 把一个 GitHub 下载地址展开成按优先级排序的候选列表:环境变量镜像 →
 * 内置镜像 → 直连。非 github.com 地址不套镜像,直接返回原地址。
 */
export function buildDownloadCandidates(url: string, envValue?: string): DownloadCandidate[] {
  if (!url.startsWith('https://github.com/')) return [{ label: '直连', url }]
  const envPrefixes = (envValue ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const candidates = [...envPrefixes, ...BUILTIN_MIRROR_PREFIXES].map((prefix) => ({
    label: mirrorLabel(prefix),
    url: joinMirrorPrefix(prefix, url),
  }))
  candidates.push({ label: 'github.com(直连)', url })
  return candidates
}

/**
 * 从 release 附件里挑出当前平台/安装形态对应的安装包。CI 上传时把空格改成了
 * 连字符,正则不锚定完整产品名,只按后缀特征匹配,兼容两种命名。
 */
export function selectAsset(
  assets: UpdateAsset[],
  platform: NodeJS.Platform | string,
  portable: boolean,
): UpdateAsset | null {
  if (platform === 'win32') {
    if (portable) {
      return assets.find((asset) => /-win-x64\.zip$/i.test(asset.name) && !/setup/i.test(asset.name)) ?? null
    }
    return assets.find((asset) => /setup-.+-win-x64\.exe$/i.test(asset.name)) ?? null
  }
  if (platform === 'darwin') {
    return assets.find((asset) => /-mac-arm64\.dmg$/i.test(asset.name)) ?? null
  }
  return null
}

/**
 * 解析 release 里随产物上传的 sha256sums.txt(`<hash>  <文件名>` 每行一条,
 * 兼容 `sha256sum` 的 `*` 二进制标记)。镜像有可能被劫持,下载后按它校验。
 */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim())
    if (match) sums.set(match[2]!.trim(), match[1]!.toLowerCase())
  }
  return sums
}

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

function parseAssets(value: unknown): UpdateAsset[] {
  if (!Array.isArray(value)) return []
  const assets: UpdateAsset[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const name = typeof record.name === 'string' ? record.name : ''
    const url = typeof record.browser_download_url === 'string' ? record.browser_download_url : ''
    const size = typeof record.size === 'number' ? record.size : 0
    if (name && url) assets.push({ name, url, size })
  }
  return assets
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
    const assets = parseAssets(payload.assets)
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
      latest: { version, tag, name, publishedAt, url, body, assets, asset: null },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', currentVersion, error: message }
  } finally {
    clearTimeout(timer)
  }
}
