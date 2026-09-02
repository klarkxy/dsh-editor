import { cp, rm } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const template = resolve(root, '.dev', 'desktop-profile-template')
const packages = ['dsh-manuscript', 'dsh-editor-workbench', 'dsh-editor-novel-kernel', 'dsh-editor-shell']

const filter = (source) => {
  const normalized = source.replaceAll('\\', '/')
  return !normalized.includes('/node_modules/') &&
    !normalized.includes('/src/') &&
    !normalized.includes('/test/') &&
    !normalized.endsWith('/tsconfig.json') &&
    !normalized.endsWith('/tsdown.config.ts')
}

for (const pkg of packages) {
  const src = join(root, 'packages', pkg)
  const dst = join(template, 'node_modules', pkg)
  await rm(dst, { recursive: true, force: true })
  await cp(src, dst, { recursive: true, filter })
  console.log('refreshed', pkg)
}
