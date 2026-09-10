/** Explicit product recipes shared by preparation, development and artifact verification. */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const COMPOSITION_IDS = ['basic', 'smart', 'full']
export const DESKTOP_PACKAGE_NAMES = ['dsh-manuscript', 'dsh-proofread', 'dsh-editor-workbench', 'dsh-editor-novel-kernel', 'dsh-zhihu', 'dsh-editor-shell', 'dsh-editor-plugins']
export const PUBLIC_PLUGIN_PACKAGES = ['dsh-manuscript', 'dsh-proofread', 'dsh-zhihu']
export const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
export async function desktopComposition(id = process.env.DSH_EDITOR_COMPOSITION || 'full') {
  if (!COMPOSITION_IDS.includes(id)) throw new Error(`unsupported desktop composition: ${id}`)
  const value = JSON.parse(await readFile(resolve(root, 'apps/desktop/resources/compositions', `${id}.json`), 'utf8'))
  if (value.id !== id || !Array.isArray(value.packages) || new Set(value.packages).size !== value.packages.length ||
    value.packages.some(name => !DESKTOP_PACKAGE_NAMES.includes(name))) throw new Error(`invalid composition: ${id}`)
  for (const required of ['dsh-manuscript', 'dsh-proofread', 'dsh-editor-workbench', 'dsh-editor-shell', 'dsh-editor-plugins']) {
    if (!value.packages.includes(required)) throw new Error(`${id}: missing required ${required}`)
  }
  if (value.shell.assistant !== value.packages.includes('dsh-editor-novel-kernel') ||
    value.shell.zhihu !== value.packages.includes('dsh-zhihu')) throw new Error(`${id}: feature/package mismatch`)
  return value
}
export async function configureProfile(destination, composition) {
  const manifestPath = resolve(destination, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = [...BASE_BUNDLES, ...composition.packages]
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const basePatch = await readFile(resolve(root, 'apps/desktop/resources/profile/cordis.patch.yml'), 'utf8')
  const selectionPatch = [
    ...(composition.packages.includes('dsh-zhihu') ? ["- insert:\n    - id: zhihu-tools\n      name: dsh-zhihu/tools\n"] : []),
    ...composition.disabledEntries.map(id => `- id: ${id}\n  disabled: true\n`),
    `- id: editor-shell\n  config:\n    assistant: ${composition.shell.assistant}\n    zhihu: ${composition.shell.zhihu}\n`,
  ].join('')
  await writeFile(resolve(destination, 'cordis.patch.yml'), `${basePatch.trimEnd()}\n${selectionPatch}`)
  await writeFile(resolve(destination, 'composition.json'), `${JSON.stringify(composition, null, 2)}\n`)
}
