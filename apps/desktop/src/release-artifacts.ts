// The publisher and updater share the same product, platform and package names.
import { basename } from 'node:path'

export const RELEASE_PRODUCT_NAME = 'DSH Editor'
export const RELEASE_OWNER = 'klarkxy'
export const RELEASE_REPO = 'dsh-editor'
export type ReleaseArtifactKind = 'win32-portable' | 'win32-setup' | 'darwin-dmg' | 'darwin-zip'

export function sanitizeReleaseAssetName(localName: string): string {
  return localName.replaceAll(' ', '-')
}
export function localArtifactName(kind: ReleaseArtifactKind, version: string, arch = 'arm64'): string {
  switch (kind) {
    case 'win32-portable': return `${RELEASE_PRODUCT_NAME}-${version}-win-x64.exe`
    case 'win32-setup': return `${RELEASE_PRODUCT_NAME}-Setup-${version}-win-x64.exe`
    case 'darwin-dmg': return `${RELEASE_PRODUCT_NAME}-${version}-mac-${arch}.dmg`
    case 'darwin-zip': return `${RELEASE_PRODUCT_NAME}-${version}-mac-${arch}.zip`
  }
}
export function releaseArtifactName(kind: ReleaseArtifactKind, version: string, arch?: string): string {
  return sanitizeReleaseAssetName(localArtifactName(kind, version, arch))
}
export function localArtifactsForPlatform(platform: NodeJS.Platform | string, version: string, arch = process.arch): string[] {
  if (platform === 'win32') return [localArtifactName('win32-portable', version), localArtifactName('win32-setup', version)]
  if (platform === 'darwin') return [localArtifactName('darwin-dmg', version, arch), localArtifactName('darwin-zip', version, arch)]
  return []
}

export function matchesReleaseAsset(name: string, platform: NodeJS.Platform | string, portable: boolean, arch?: string): boolean {
  if (!isSafeAssetFileName(name)) return false
  const normalized = sanitizeReleaseAssetName(name)
  if (platform === 'win32') {
    if (arch && arch !== 'x64') return false
    return portable
      ? /^DSH-Editor-\d+\.\d+\.\d+-win-x64\.exe$/.test(normalized)
      : /^DSH-Editor-Setup-\d+\.\d+\.\d+-win-x64\.exe$/.test(normalized)
  }
  if (platform === 'darwin') {
    const target = arch ?? 'arm64'
    return ['arm64', 'x64'].includes(target) && new RegExp(`^DSH-Editor-\\d+\\.\\d+\\.\\d+-mac-${target}\\.dmg$`).test(normalized)
  }
  return false
}
export function selectAsset<T extends { name: string }>(assets: T[], platform: NodeJS.Platform | string, portable: boolean, arch?: string): T | null {
  return assets.find((asset) => matchesReleaseAsset(asset.name, platform, portable, arch)) ?? null
}
export function isSafeAssetFileName(name: string): boolean {
  if (!name || name !== name.trim() || /[. ]$/.test(name)) return false
  if (/[\x00-\x1f\x7f<>:"|?*\\/]/.test(name) || name !== basename(name)) return false
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) return false
  return true
}

/** Match the exact official endpoint, including decoded tag and basename. */
export function isTrustedReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) return false
    const parts = url.pathname.split('/')
    if (parts.length !== 7 || parts[1] !== RELEASE_OWNER || parts[2] !== RELEASE_REPO || parts[3] !== 'releases' || parts[4] !== 'download') return false
    const tag = decodeURIComponent(parts[5]!)
    const name = decodeURIComponent(parts[6]!)
    return /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) && isSafeAssetFileName(name)
  } catch { return false }
}
export function assetMatchesRelease(url: string, tag: string, name: string): boolean {
  if (!isTrustedReleaseAssetUrl(url)) return false
  const parts = new URL(url).pathname.split('/')
  return decodeURIComponent(parts[5]!) === tag && decodeURIComponent(parts[6]!) === name
}
export function parseGitHubDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(?:sha256:)?([0-9a-fA-F]{64})$/i.exec(value.trim())
  return match?.[1]?.toLowerCase()
}
