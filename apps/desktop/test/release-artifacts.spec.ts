import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  localArtifactName,
  localArtifactsForPlatform,
  releaseArtifactName,
  sanitizeReleaseAssetName,
  selectAsset,
} from '../src/release-artifacts.js'
import * as published from '../../../scripts/release-artifacts.mjs'

const VERSION = '0.3.0'
const KINDS = ['win32-portable', 'win32-setup', 'darwin-dmg', 'darwin-zip'] as const

describe('release artifact naming contract', () => {
  it('keeps the TypeScript selector and the packaging script on the same names', () => {
    for (const kind of KINDS) {
      expect(localArtifactName(kind, VERSION)).toBe(published.localArtifactName(kind, VERSION))
      expect(releaseArtifactName(kind, VERSION)).toBe(published.releaseArtifactName(kind, VERSION))
    }
    expect(localArtifactsForPlatform('win32', VERSION)).toEqual(published.localArtifactsForPlatform('win32', VERSION))
    expect(localArtifactsForPlatform('darwin', VERSION, 'arm64')).toEqual(
      published.localArtifactsForPlatform('darwin', VERSION, 'arm64'),
    )
    expect(sanitizeReleaseAssetName('DSH Editor-0.3.0-win-x64.exe')).toBe('DSH-Editor-0.3.0-win-x64.exe')
  })

  it('matches the electron-builder templates after interpolating product, version and extension', async () => {
    const builder = await readFile(join(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8')
    const interpolate = (template: string, ext: string) => template
      .replaceAll('${productName}', 'DSH Editor')
      .replaceAll('${version}', VERSION)
      .replaceAll('${ext}', ext)
    expect(interpolate('${productName}-${version}-win-x64.${ext}', 'exe')).toBe(localArtifactName('win32-portable', VERSION))
    expect(interpolate('DSH Editor-Setup-${version}-win-x64.${ext}', 'exe')).toBe(localArtifactName('win32-setup', VERSION))
    expect(interpolate('${productName}-${version}-mac-arm64.${ext}', 'dmg')).toBe(localArtifactName('darwin-dmg', VERSION))
    expect(builder).toContain('artifactName: "${productName}-${version}-win-x64.${ext}"')
    expect(builder).toContain('artifactName: "DSH Editor-Setup-${version}-win-x64.${ext}"')
    expect(builder).toContain('artifactName: "${productName}-${version}-mac-arm64.${ext}"')
  })

  it('matches the GitHub upload sanitizer and the in-app selector for the published v0.3.0 names', async () => {
    const workflow = await readFile(join(import.meta.dirname, '../../..', '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('dashed="${file// /-}"')
    const assets = KINDS.filter((kind) => kind !== 'darwin-zip').map((kind) => ({
      name: releaseArtifactName(kind, VERSION),
      url: `https://github.com/klarkxy/dsh-editor/releases/download/v${VERSION}/${releaseArtifactName(kind, VERSION)}`,
      size: 1,
    }))
    expect(selectAsset(assets, 'win32', true)?.name).toBe('DSH-Editor-0.3.0-win-x64.exe')
    expect(selectAsset(assets, 'win32', false)?.name).toBe('DSH-Editor-Setup-0.3.0-win-x64.exe')
    expect(selectAsset(assets, 'darwin', false)?.name).toBe('DSH-Editor-0.3.0-mac-arm64.dmg')
  })

  it('requires pack verification and portable e2e to import the same contract', async () => {
    const verify = await readFile(join(import.meta.dirname, '../../..', 'scripts/verify-desktop-package.mjs'), 'utf8')
    const portable = await readFile(join(import.meta.dirname, '../../..', 'e2e/portable.mjs'), 'utf8')
    expect(verify).toContain("from './release-artifacts.mjs'")
    expect(verify).toContain('localArtifactsForPlatform(')
    expect(portable).toContain("from '../scripts/release-artifacts.mjs'")
    expect(portable).toContain("localArtifactName('win32-portable'")
  })
})
