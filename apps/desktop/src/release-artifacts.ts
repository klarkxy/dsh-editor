// 桌面产物命名与选择:打包器、发布上传、选择器消费同一套平台/安装形态信息。
// electron-builder 的模板、GitHub 上传时的空格改连字符、应用内 selectAsset
// 都对这里的名字。契约测试会核对 yml、工作流和脚本没有各写一份正则。

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
    case 'win32-portable':
      return `${RELEASE_PRODUCT_NAME}-${version}-win-x64.exe`
    case 'win32-setup':
      return `${RELEASE_PRODUCT_NAME}-Setup-${version}-win-x64.exe`
    case 'darwin-dmg':
      return `${RELEASE_PRODUCT_NAME}-${version}-mac-${arch}.dmg`
    case 'darwin-zip':
      return `${RELEASE_PRODUCT_NAME}-${version}-mac-${arch}.zip`
  }
}

export function releaseArtifactName(kind: ReleaseArtifactKind, version: string, arch?: string): string {
  return sanitizeReleaseAssetName(localArtifactName(kind, version, arch))
}

export function localArtifactsForPlatform(
  platform: NodeJS.Platform | string,
  version: string,
  arch = process.arch,
): string[] {
  if (platform === 'win32') {
    return [localArtifactName('win32-portable', version), localArtifactName('win32-setup', version)]
  }
  if (platform === 'darwin') {
    return [localArtifactName('darwin-dmg', version, arch), localArtifactName('darwin-zip', version, arch)]
  }
  return []
}

/** 从 release 附件里挑出当前平台/安装形态对应的安装包。便携版是 EXE,不是 ZIP。 */
export function matchesReleaseAsset(
  name: string,
  platform: NodeJS.Platform | string,
  portable: boolean,
): boolean {
  if (platform === 'win32') {
    if (portable) return /-win-x64\.exe$/i.test(name) && !/setup/i.test(name)
    return /setup-.+-win-x64\.exe$/i.test(name)
  }
  if (platform === 'darwin') return /-mac-arm64\.dmg$/i.test(name)
  return false
}

export function selectAsset<T extends { name: string }>(
  assets: T[],
  platform: NodeJS.Platform | string,
  portable: boolean,
): T | null {
  return assets.find((asset) => matchesReleaseAsset(asset.name, platform, portable)) ?? null
}

export function isSafeAssetFileName(name: string): boolean {
  if (!name || name !== name.trim()) return false
  if (name.includes('\0') || name === '.' || name === '..') return false
  if (name !== basename(name)) return false
  if (/[<>:"|?*]/.test(name)) return false
  return true
}

const RELEASE_DOWNLOAD = new RegExp(
  `^https://github\\.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/v[^/]+/[^/]+$`,
)

export function isTrustedReleaseAssetUrl(url: string): boolean {
  return RELEASE_DOWNLOAD.test(url)
}

export function parseGitHubDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  const prefixed = /^sha256:([0-9a-fA-F]{64})$/i.exec(text)
  if (prefixed) return prefixed[1]!.toLowerCase()
  const raw = /^([0-9a-fA-F]{64})$/.exec(text)
  return raw ? raw[1]!.toLowerCase() : undefined
}
