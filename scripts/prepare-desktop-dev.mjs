import { materializeDsh } from './materialize-dsh.mjs'
import { copyRuntimeDependencies } from './runtime-dependencies.mjs'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'
import {
  desktopComposition,
  configureProfile,
  runtimeDependencySources,
  materializedRuntimePackageNames,
  projectProfileArtifacts,
  removeAppPackagesFromRuntime,
} from './desktop-compositions.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceTemplate = resolve(root, 'apps', 'desktop', 'resources', 'profile')
const template = resolve(root, '.dev', 'desktop-profile-template')
const devDshRuntime = resolve(root, '.dev', 'desktop-dsh-runtime-0.2.0-rc.2')
const composition = await desktopComposition()
// The cached runtime can outlive a product recipe. Remove only packages owned
// by the previous generated composition; source directories and user data stay intact.
let previousPackages = []
try {
  const previous = JSON.parse(await readFile(resolve(template, 'composition.json'), 'utf8'))
  previousPackages = [...(previous.packages ?? []), ...(previous.libraries ?? [])]
    .filter(name => typeof name === 'string' && /^(?:@klarkxy\/)?dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
} catch {}

if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '26.10.0') {
  throw new Error(`desktop development requires Windows x64 Node 26.10.0; found ${process.platform} ${process.arch} Node ${process.versions.node}`)
}
const dsh = resolveDshInstallation('0.2.0-rc.2')

await rm(template, { recursive: true, force: true })
await mkdir(dirname(template), { recursive: true })
await cp(sourceTemplate, template, { recursive: true })

let runtimeReady = false
try {
  const manifest = JSON.parse(await readFile(resolve(devDshRuntime, 'package.json'), 'utf8'))
  runtimeReady = manifest.name === '@deepseek-ai/dsh' && manifest.version === '0.2.0-rc.2'
    && JSON.parse(await readFile(resolve(devDshRuntime, '.dsh-editor-materialized'), 'utf8')).version === manifest.version
} catch {}
if (!runtimeReady) {
  console.log('desktop-dev: materializing the pinned app-owned DSH runtime (first run only)')
  await rm(devDshRuntime, { recursive: true, force: true })
  await materializeDsh(dsh.packageRoot, devDshRuntime)
}
await copyRuntimeDependencies(devDshRuntime, runtimeDependencySources(composition))
await removeAppPackagesFromRuntime(devDshRuntime, previousPackages)
const runtimePackageNames = await materializedRuntimePackageNames(devDshRuntime)
await projectProfileArtifacts(template, composition, runtimePackageNames)
await configureProfile(template, composition)

console.log(`desktop-dev: prepared ${template}`)
