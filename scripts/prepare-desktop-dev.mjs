import { materializeDsh } from './materialize-dsh.mjs'
import { copyRuntimeDependencies } from './runtime-dependencies.mjs'
import { cp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'
import { compositionInstallNames } from './plugin-manifest.mjs'
import { workspacePackageDir, desktopComposition, configureProfile, runtimeDependencySources, DESKTOP_PACKAGE_NAMES } from './desktop-compositions.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceTemplate = resolve(root, 'apps', 'desktop', 'resources', 'profile')
const template = resolve(root, '.dev', 'desktop-profile-template')
const devDshRuntime = resolve(root, '.dev', 'desktop-dsh-runtime-0.1.7-rc.2')
const composition = await desktopComposition()
const packages = compositionInstallNames(composition)

if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '24.16.0') {
  throw new Error(`desktop development requires Windows x64 Node 24.16.0; found ${process.platform} ${process.arch} Node ${process.versions.node}`)
}
const dsh = resolveDshInstallation('0.1.7-rc.2')

function packageCopyFilter(source) {
  const normalized = source.replaceAll('\\', '/')
  return !normalized.includes('/node_modules/') &&
    !normalized.includes('/src/') &&
    !normalized.includes('/test/') &&
    !normalized.endsWith('.map') &&
    !normalized.endsWith('/tsconfig.json') &&
    !normalized.endsWith('/tsdown.config.ts')
}

async function installPackage(packageName, destination) {
  await rm(destination, { recursive: true, force: true })
  const source = workspacePackageDir(packageName)
  if (process.env.DSH_EDITOR_COPY_PACKAGES === '1') {
    await cp(source, destination, { recursive: true, filter: packageCopyFilter })
    return
  }
  await mkdir(dirname(destination), { recursive: true })
  await symlink(source, destination, 'junction')
}

await rm(template, { recursive: true, force: true })
await mkdir(dirname(template), { recursive: true })
await cp(sourceTemplate, template, { recursive: true })
await configureProfile(template, composition)
await mkdir(resolve(template, 'node_modules'), { recursive: true })
for (const packageName of packages) {
  await installPackage(packageName, resolve(template, 'node_modules', packageName))
}

let runtimeReady = false
try {
  const manifest = JSON.parse(await readFile(resolve(devDshRuntime, 'package.json'), 'utf8'))
  runtimeReady = manifest.name === '@deepseek-ai/dsh' && manifest.version === '0.1.7-rc.2'
    && JSON.parse(await readFile(resolve(devDshRuntime, '.dsh-editor-materialized'), 'utf8')).version === manifest.version
} catch {}
if (!runtimeReady) {
  console.log('desktop-dev: materializing the pinned app-owned DSH runtime (first run only)')
  await rm(devDshRuntime, { recursive: true, force: true })
  await materializeDsh(dsh.packageRoot, devDshRuntime)
}
await copyRuntimeDependencies(devDshRuntime, runtimeDependencySources(composition))
for (const packageName of DESKTOP_PACKAGE_NAMES) {
  const destination = resolve(devDshRuntime, 'node_modules', packageName)
  if (packages.includes(packageName)) await installPackage(packageName, destination)
  else await rm(destination, { recursive: true, force: true })
}

console.log(`desktop-dev: prepared ${template}`)
