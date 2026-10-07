/** 桌面产物命名契约:打包校验、发布上传和选择器必须消费同一套名字。 */
import release from '../apps/desktop/src/release-artifacts.json' with { type: 'json' }

export const RELEASE_PRODUCT_NAME = release.productName
export const RELEASE_OWNER = release.owner
export const RELEASE_REPO = release.repo

export function sanitizeReleaseAssetName(localName) {
  return localName.replaceAll(' ', '-')
}

export function localArtifactName(kind, version, arch = 'arm64') {
  const template = release.templates[kind]
  if (!template) throw new Error(`unknown release artifact kind: ${kind}`)
  return template.replaceAll('{productName}', RELEASE_PRODUCT_NAME).replaceAll('{version}', version).replaceAll('{arch}', arch)
}

export function releaseArtifactName(kind, version, arch) {
  return sanitizeReleaseAssetName(localArtifactName(kind, version, arch))
}

export function localArtifactsForPlatform(platform, version, arch = process.arch) {
  if (platform === 'win32') {
    return [localArtifactName('win32-portable', version), localArtifactName('win32-setup', version)]
  }
  if (platform === 'darwin') {
    return [localArtifactName('darwin-dmg', version, arch), localArtifactName('darwin-zip', version, arch)]
  }
  return []
}
