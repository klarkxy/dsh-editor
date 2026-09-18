/** 桌面产物命名契约:打包校验、发布上传和选择器必须消费同一套名字。 */

export const RELEASE_PRODUCT_NAME = 'DSH Editor'
export const RELEASE_OWNER = 'klarkxy'
export const RELEASE_REPO = 'dsh-editor'

export function sanitizeReleaseAssetName(localName) {
  return localName.replaceAll(' ', '-')
}

export function localArtifactName(kind, version, arch = 'arm64') {
  switch (kind) {
    case 'win32-portable':
      return `${RELEASE_PRODUCT_NAME}-${version}-win-x64.exe`
    case 'win32-setup':
      return `${RELEASE_PRODUCT_NAME}-Setup-${version}-win-x64.exe`
    case 'darwin-dmg':
      return `${RELEASE_PRODUCT_NAME}-${version}-mac-${arch}.dmg`
    case 'darwin-zip':
      return `${RELEASE_PRODUCT_NAME}-${version}-mac-${arch}.zip`
    default:
      throw new Error(`unknown release artifact kind: ${kind}`)
  }
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
