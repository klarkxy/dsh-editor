import { cp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceTemplate = resolve(root, 'apps', 'desktop', 'resources', 'profile')
const template = resolve(root, '.dev', 'desktop-profile-template')
const devDshRuntime = resolve(root, '.dev', 'desktop-dsh-runtime')
const packages = ['dsh-manuscript', 'dsh-editor-workbench', 'dsh-editor-novel-kernel', 'dsh-editor-shell']

if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '24.16.0') {
  throw new Error(`desktop development requires Windows x64 Node 24.16.0; found ${process.platform} ${process.arch} Node ${process.versions.node}`)
}
const dsh = resolveDshInstallation('0.1.1-rc.2')

function packageCopyFilter(source) {
  const normalized = source.replaceAll('\\', '/')
  return !normalized.includes('/node_modules/') &&
    !normalized.includes('/src/') &&
    !normalized.includes('/test/') &&
    !normalized.endsWith('/tsconfig.json') &&
    !normalized.endsWith('/tsdown.config.ts')
}

await rm(template, { recursive: true, force: true })
await mkdir(dirname(template), { recursive: true })
await cp(sourceTemplate, template, { recursive: true })
for (const packageName of packages) {
  await cp(resolve(root, 'packages', packageName), resolve(template, 'node_modules', packageName), {
    recursive: true,
    filter: packageCopyFilter,
  })
}

let runtimeReady = false
try {
  const manifest = JSON.parse(await readFile(resolve(devDshRuntime, 'package.json'), 'utf8'))
  runtimeReady = manifest.name === '@deepseek-ai/dsh' && manifest.version === '0.1.1-rc.2'
} catch {}
if (!runtimeReady) {
  console.log('desktop-dev: materializing the pinned app-owned DSH runtime (first run only)')
  await rm(devDshRuntime, { recursive: true, force: true })
  await cp(dsh.packageRoot, devDshRuntime, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.replaceAll('\\', '/').includes('/node_modules/.bin/'),
  })
}
for (const packageName of packages) {
  const destination = resolve(devDshRuntime, 'node_modules', packageName)
  await rm(destination, { recursive: true, force: true })
  await symlink(resolve(root, 'packages', packageName), destination, 'junction')
}

console.log(`desktop-dev: prepared ${template}`)
