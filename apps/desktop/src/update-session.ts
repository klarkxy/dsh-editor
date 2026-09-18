// 主进程持有的更新会话:检查结果里的可信资产、下载后的校验记录。
// 渲染端只看到 updateId / 名称 / 大小,不能指定 URL、文件名或安装路径。

import { timingSafeEqual } from 'node:crypto'
import { resolve, sep } from 'node:path'
import {
  isSafeAssetFileName,
  isTrustedReleaseAssetUrl,
  selectAsset,
} from './release-artifacts.js'
import { parseSha256Sums, type UpdateAsset } from './update-checker.js'

export { selectAsset }

export type InstallBlockedReason = 'missing-integrity' | 'no-matching-asset'

export interface PublicUpdateAsset {
  id: string
  name: string
  size: number
}

export interface PublicUpdateCheckLatest {
  version: string
  tag: string
  name: string
  publishedAt: string
  url: string
  body: string
  asset: PublicUpdateAsset | null
  installBlockedReason?: InstallBlockedReason
}

export interface PublicUpdateCheckResult {
  status: 'latest' | 'update-available' | 'error'
  currentVersion: string
  latest?: PublicUpdateCheckLatest
  error?: string
}

export interface OfferedUpdate {
  id: string
  version: string
  tag: string
  asset: UpdateAsset & { digest: string }
}

export interface DownloadedUpdate {
  id: string
  path: string
  digest: string
  name: string
}

export function makeUpdateId(tag: string, name: string): string {
  return `${tag}:${name}`
}

export function publicAsset(offer: OfferedUpdate): PublicUpdateAsset {
  return { id: offer.id, name: offer.asset.name, size: offer.asset.size }
}

export function resolveUpdateFilePath(dir: string, name: string): string {
  if (!isSafeAssetFileName(name)) throw new Error('非法的更新文件名')
  const root = resolve(dir)
  const target = resolve(root, name)
  if (target !== root && !target.startsWith(root + sep)) throw new Error('非法的更新文件路径')
  return target
}

export function digestsEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length || actual.length !== 64) return false
  try {
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function assertUpdateFileMatches(
  path: string,
  expected: { size: number; digest: string },
  io: {
    sha256(path: string): Promise<string>
    size(path: string): Promise<number>
  },
): Promise<void> {
  if (!expected.digest) throw new Error('缺少可信校验信息,已停止自动安装')
  const size = await io.size(path)
  if (expected.size > 0 && size !== expected.size) {
    throw new Error(`文件大小不符(${size}/${expected.size} 字节)`)
  }
  const actual = await io.sha256(path)
  if (!digestsEqual(actual, expected.digest)) throw new Error('SHA-256 校验失败,文件可能被篡改')
}

type TextFetch = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number
  text(): Promise<string>
}>

/** 只从官方 GitHub 拉 sha256sums.txt,不走镜像。API digest 优先。 */
export async function resolveOfficialDigest(
  asset: UpdateAsset,
  fetchImpl: TextFetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (asset.digest) return asset.digest
  if (!isTrustedReleaseAssetUrl(asset.url)) return undefined
  const slash = asset.url.lastIndexOf('/')
  if (slash < 0) return undefined
  const sumsUrl = `${asset.url.slice(0, slash + 1)}sha256sums.txt`
  if (!isTrustedReleaseAssetUrl(sumsUrl)) return undefined
  try {
    const response = await fetchImpl(sumsUrl, {
      headers: { 'User-Agent': 'dsh-editor' },
      signal,
    })
    if (response.status !== 200) return undefined
    return parseSha256Sums(await response.text()).get(asset.name)
  } catch {
    return undefined
  }
}

export class UpdateOfferStore {
  #offer: OfferedUpdate | null = null
  #downloaded: DownloadedUpdate | null = null

  get offer(): OfferedUpdate | null {
    return this.#offer
  }

  get downloaded(): DownloadedUpdate | null {
    return this.#downloaded
  }

  replaceOffer(offer: OfferedUpdate | null): void {
    if (this.#offer?.id !== offer?.id) this.#downloaded = null
    this.#offer = offer
  }

  requireOffer(id: string): OfferedUpdate {
    if (!id || !this.#offer || this.#offer.id !== id) {
      throw new Error('没有对应的已验证更新,请重新检查更新')
    }
    return this.#offer
  }

  recordDownload(downloaded: DownloadedUpdate): void {
    this.requireOffer(downloaded.id)
    this.#downloaded = downloaded
  }

  requireDownload(id: string): DownloadedUpdate {
    this.requireOffer(id)
    if (!this.#downloaded || this.#downloaded.id !== id) {
      throw new Error('没有已校验的更新文件,请先下载')
    }
    return this.#downloaded
  }

  clearDownload(): void {
    this.#downloaded = null
  }
}

export interface InternalUpdateCheckLatest {
  version: string
  tag: string
  name: string
  publishedAt: string
  url: string
  body: string
  assets: UpdateAsset[]
}

export interface InternalUpdateCheckResult {
  status: 'latest' | 'update-available' | 'error'
  currentVersion: string
  latest?: InternalUpdateCheckLatest
  error?: string
}

export function toPublicUpdateCheck(
  result: InternalUpdateCheckResult,
  offer: OfferedUpdate | null,
  blocked?: InstallBlockedReason,
): PublicUpdateCheckResult {
  if (!result.latest) {
    return { status: result.status, currentVersion: result.currentVersion, error: result.error }
  }
  return {
    status: result.status,
    currentVersion: result.currentVersion,
    error: result.error,
    latest: {
      version: result.latest.version,
      tag: result.latest.tag,
      name: result.latest.name,
      publishedAt: result.latest.publishedAt,
      url: result.latest.url,
      body: result.latest.body,
      asset: offer ? publicAsset(offer) : null,
      installBlockedReason: result.status === 'update-available' && !offer ? blocked : undefined,
    },
  }
}

export async function presentUpdateCheck(
  result: InternalUpdateCheckResult,
  input: {
    platform: NodeJS.Platform | string
    portable: boolean
    store: UpdateOfferStore
    fetchImpl?: TextFetch
  },
): Promise<PublicUpdateCheckResult> {
  if (!result.latest || result.status !== 'update-available') {
    input.store.replaceOffer(null)
    return toPublicUpdateCheck(result, null)
  }
  const selected = selectAsset(result.latest.assets, input.platform, input.portable)
  if (!selected) {
    input.store.replaceOffer(null)
    return toPublicUpdateCheck(result, null, 'no-matching-asset')
  }
  const digest = selected.digest ?? (
    input.fetchImpl
      ? await resolveOfficialDigest(selected, input.fetchImpl)
      : selected.digest
  )
  if (!digest || !isSafeAssetFileName(selected.name) || !isTrustedReleaseAssetUrl(selected.url)) {
    input.store.replaceOffer(null)
    return toPublicUpdateCheck(result, null, digest ? 'no-matching-asset' : 'missing-integrity')
  }
  const offer: OfferedUpdate = {
    id: makeUpdateId(result.latest.tag, selected.name),
    version: result.latest.version,
    tag: result.latest.tag,
    asset: { ...selected, digest },
  }
  input.store.replaceOffer(offer)
  return toPublicUpdateCheck(result, offer)
}
