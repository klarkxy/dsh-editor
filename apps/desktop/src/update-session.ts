// Main-process authority for offered assets and verified downloads. The renderer
// can select an opaque ID, never a URL, a digest or an installation destination.
import { timingSafeEqual } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { assetMatchesRelease, isSafeAssetFileName, isTrustedReleaseAssetUrl, parseGitHubDigest, selectAsset } from './release-artifacts.js'
import { parseSha256Sums, type UpdateAsset } from './update-checker.js'
export { selectAsset }
export type InstallBlockedReason = 'missing-integrity' | 'no-matching-asset'
export interface PublicUpdateAsset { id: string; name: string; size: number }
export interface PublicUpdateCheckLatest {
  version: string; tag: string; name: string; publishedAt: string; url: string; body: string
  asset: PublicUpdateAsset | null
  installBlockedReason?: InstallBlockedReason
}
export interface PublicUpdateCheckResult {
  status: 'latest' | 'update-available' | 'error'
  currentVersion: string
  latest?: PublicUpdateCheckLatest
  error?: string
}
export interface OfferedUpdate { id: string; version: string; tag: string; asset: UpdateAsset & { digest: string } }
export interface DownloadedUpdate { id: string; path: string; digest: string; name: string }
export function makeUpdateId(tag: string, name: string): string { return `${tag}:${name}` }
export function publicAsset(offer: OfferedUpdate): PublicUpdateAsset { return { id: offer.id, name: offer.asset.name, size: offer.asset.size } }
export function resolveUpdateFilePath(dir: string, name: string): string {
  if (!isSafeAssetFileName(name)) throw new Error('非法的更新文件名')
  const root = resolve(dir), target = resolve(root, name)
  if (target === root || !target.startsWith(root + sep)) throw new Error('非法的更新文件路径')
  return target
}
export function digestsEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actual) || !/^[0-9a-f]{64}$/i.test(expected)) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}
export async function assertUpdateFileMatches(path: string, expected: { size: number; digest: string }, io: {
  sha256(path: string): Promise<string>; size(path: string): Promise<number>
}): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(expected.digest)) throw new Error('缺少可信校验信息,已停止自动安装')
  if (!Number.isSafeInteger(expected.size) || expected.size <= 0) throw new Error('缺少可信文件大小,已停止自动安装')
  const size = await io.size(path)
  if (size !== expected.size) throw new Error(`文件大小不符(${size}/${expected.size} 字节)`)
  if (!digestsEqual(await io.sha256(path), expected.digest)) throw new Error('SHA-256 校验失败,文件可能被篡改')
}
type TextFetch = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>

/** Mirrors supply bytes only. Missing digests may be recovered from the official
 * checksum manifest, with a deadline covering both headers and body. */
export async function resolveOfficialDigest(asset: UpdateAsset, fetchImpl: TextFetch, signal?: AbortSignal): Promise<string | undefined> {
  const digest = parseGitHubDigest(asset.digest)
  if (digest) return digest
  if (!isTrustedReleaseAssetUrl(asset.url)) return undefined
  const sumsUrl = `${asset.url.slice(0, asset.url.lastIndexOf('/') + 1)}sha256sums.txt`
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(sumsUrl, { headers: { 'User-Agent': 'dsh-editor' }, signal: combined })
    if (response.status !== 200) return undefined
    const text = await response.text()
    combined.throwIfAborted()
    if (text.length > 1_048_576) return undefined
    return parseSha256Sums(text).get(asset.name)
  } catch { return undefined } finally { clearTimeout(timer) }
}

function sameOffer(left: OfferedUpdate | null, right: OfferedUpdate | null): boolean {
  return left?.id === right?.id && left?.asset.url === right?.asset.url
    && left?.asset.name === right?.asset.name && left?.asset.size === right?.asset.size
    && left?.asset.digest === right?.asset.digest && left?.version === right?.version && left?.tag === right?.tag
}
export class UpdateOfferStore {
  #offer: OfferedUpdate | null = null
  #downloaded: DownloadedUpdate | null = null
  get offer(): OfferedUpdate | null { return this.#offer }
  get downloaded(): DownloadedUpdate | null { return this.#downloaded }
  replaceOffer(offer: OfferedUpdate | null): void {
    // A publisher can replace an asset under the same name and tag.
    if (!sameOffer(this.#offer, offer)) this.#downloaded = null
    this.#offer = offer
  }
  requireOffer(id: string): OfferedUpdate {
    if (!id || !this.#offer || this.#offer.id !== id) throw new Error('没有对应的已验证更新,请重新检查更新')
    return this.#offer
  }
  recordDownload(downloaded: DownloadedUpdate): void {
    const offer = this.requireOffer(downloaded.id)
    if (downloaded.name !== offer.asset.name || !digestsEqual(downloaded.digest, offer.asset.digest)) throw new Error('更新校验信息已变化,请重新下载')
    this.#downloaded = downloaded
  }
  requireDownload(id: string): DownloadedUpdate {
    const offer = this.requireOffer(id)
    if (!this.#downloaded || this.#downloaded.id !== id) throw new Error('没有已校验的更新文件,请先下载')
    if (this.#downloaded.name !== offer.asset.name || !digestsEqual(this.#downloaded.digest, offer.asset.digest)) throw new Error('更新校验信息已变化,请重新下载')
    return this.#downloaded
  }
  clearDownload(): void { this.#downloaded = null }
}
export interface InternalUpdateCheckLatest {
  version: string; tag: string; name: string; publishedAt: string; url: string; body: string; assets: UpdateAsset[]
}
export interface InternalUpdateCheckResult {
  status: 'latest' | 'update-available' | 'error'; currentVersion: string; latest?: InternalUpdateCheckLatest; error?: string
}
export function toPublicUpdateCheck(result: InternalUpdateCheckResult, offer: OfferedUpdate | null, blocked?: InstallBlockedReason): PublicUpdateCheckResult {
  if (!result.latest) return { status: result.status, currentVersion: result.currentVersion, error: result.error }
  const { version, tag, name, publishedAt, url, body } = result.latest
  return {
    status: result.status, currentVersion: result.currentVersion, error: result.error,
    latest: { version, tag, name, publishedAt, url, body, asset: offer ? publicAsset(offer) : null,
      installBlockedReason: result.status === 'update-available' && !offer ? blocked : undefined },
  }
}
export async function presentUpdateCheck(result: InternalUpdateCheckResult, input: {
  platform: NodeJS.Platform | string; portable: boolean; arch?: string; store: UpdateOfferStore; fetchImpl?: TextFetch
}): Promise<PublicUpdateCheckResult> {
  // A network failure is not a revocation of an already verified offer/download.
  if (result.status === 'error') return toPublicUpdateCheck(result, null)
  if (!result.latest || result.status !== 'update-available') {
    input.store.replaceOffer(null)
    return toPublicUpdateCheck(result, null)
  }
  const selected = selectAsset(result.latest.assets, input.platform, input.portable, input.arch)
  if (!selected) {
    input.store.replaceOffer(null)
    return toPublicUpdateCheck(result, null, 'no-matching-asset')
  }
  const digest = parseGitHubDigest(selected.digest) ?? (input.fetchImpl ? await resolveOfficialDigest(selected, input.fetchImpl) : undefined)
  const normalizedName = selected.name.replaceAll(' ', '-')
  const expectedVersion = result.latest.version
  const correctVersion = normalizedName.startsWith(`DSH-Editor-${expectedVersion}-`) || normalizedName.startsWith(`DSH-Editor-Setup-${expectedVersion}-`)
  if (!digest || !Number.isSafeInteger(selected.size) || selected.size <= 0 || !correctVersion || !assetMatchesRelease(selected.url, result.latest.tag, selected.name)) {
    input.store.replaceOffer(null)
    return toPublicUpdateCheck(result, null, digest ? 'no-matching-asset' : 'missing-integrity')
  }
  const offer: OfferedUpdate = { id: makeUpdateId(result.latest.tag, selected.name), version: result.latest.version, tag: result.latest.tag, asset: { ...selected, digest } }
  input.store.replaceOffer(offer)
  return toPublicUpdateCheck(result, offer)
}
