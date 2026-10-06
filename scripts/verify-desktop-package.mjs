import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionInstallNames } from './plugin-manifest.mjs'
import { desktopComposition, nativeDependencyBaseline, PROFILE_CONFIG_PACKAGE } from './desktop-compositions.mjs'
import { localArtifactsForPlatform } from './release-artifacts.mjs'
import { treeDigest } from '../apps/desktop/dist/runtime-tree.js'
import { materializePackagedRuntime } from '../apps/desktop/dist/runtime-cache.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, process.argv[2] ?? '.pack/desktop')
const platformId = `${process.platform}-${process.arch}`
const nodeExecutableName = process.platform === 'win32' ? 'node.exe' : 'node'
const resources = process.platform === 'darwin'
  ? resolve(output, `mac-${process.arch}`, 'DSH Editor.app', 'Contents', 'Resources')
  : resolve(output, 'win-unpacked', 'resources')

async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }

const desktopVersion = (await json(resolve(root, 'apps', 'desktop', 'package.json'))).version
const artifactNames = localArtifactsForPlatform(process.platform, desktopVersion, process.arch)

const manifest = await json(resolve(resources, 'runtime-manifest.json'))
if (manifest.platform !== platformId) throw new Error(`runtime manifest platform mismatch: expected ${platformId}, found ${manifest.platform}`)
const actual = {
  node: await treeDigest(resolve(resources, 'node')),
  dsh: await treeDigest(resolve(resources, 'dsh')),
  profile: await treeDigest(resolve(resources, 'profile-template')),
}
for (const key of ['node', 'dsh', 'profile']) {
  for (const field of ['sha256', 'files', 'bytes']) {
    if (actual[key][field] !== manifest[key][field]) throw new Error(`${key} ${field} mismatch`)
  }
}
const dsh = await json(resolve(resources, 'dsh', 'package.json'))
if (dsh.name !== '@deepseek-ai/dsh' || dsh.version !== '0.2.0-rc.2') throw new Error('packaged DSH identity mismatch')
const composition = await json(resolve(resources, 'profile-template', 'composition.json'))
const { nativeDependencies, ...packagedRecipe } = composition
const expectedComposition = await desktopComposition(composition.id)
if (JSON.stringify(packagedRecipe) !== JSON.stringify(expectedComposition)) throw new Error('packaged composition mismatch')
const expectedNative = nativeDependencyBaseline(expectedComposition)
if (JSON.stringify(nativeDependencies) !== JSON.stringify(expectedNative)) throw new Error('packaged nativeDependencies mismatch')
for (const dependencyName of composition.runtimeDependencies ?? []) {
  const dependency = await json(resolve(resources, 'dsh', 'node_modules', ...dependencyName.split('/'), 'package.json'))
  if (dependency.name !== dependencyName) throw new Error(`packaged runtime dependency identity mismatch: ${dependencyName}`)
}
const profile = await json(resolve(resources, 'profile-template', 'package.json'))
if (JSON.stringify(profile.dsh?.profile?.bundles) !== JSON.stringify([...composition.bundles, PROFILE_CONFIG_PACKAGE])) {
  throw new Error('packaged profile bundles mismatch')
}
if (JSON.stringify(profile.dependencies) !== JSON.stringify(nativeDependencies)) {
  throw new Error('packaged profile native root dependencies mismatch')
}
for (const [name, spec] of Object.entries(nativeDependencies)) {
  if (name === PROFILE_CONFIG_PACKAGE) {
    if (spec !== 'link:./profile-config') throw new Error(`packaged native dependency spec mismatch: ${name}`)
    await stat(resolve(resources, 'profile-template', 'profile-config', 'package.json'))
    continue
  }
  if (spec !== `link:./bundled-packages/node_modules/${name}`) throw new Error(`packaged native dependency spec mismatch: ${name}`)
  await stat(resolve(resources, 'profile-template', 'bundled-packages', 'node_modules', ...name.split('/'), 'package.json'))
}
const installedNames = [...compositionInstallNames(composition), PROFILE_CONFIG_PACKAGE]
for (const packageName of installedNames) {
  await stat(resolve(resources, 'profile-template', 'node_modules', packageName, 'package.json'))
}
if (composition.packages.includes('dsh-editor-novel-kernel')) {
const knowledgeRoot = resolve(resources, 'profile-template', 'node_modules', 'dsh-editor-novel-kernel', 'resources', 'novel-knowledge')
for (const fileName of [
  'planning.md', 'characters.md', 'drafting.md', 'dialogue.md', 'interiority.md',
  'style.md', 'review.md', 'deai.md', 'chinese-flow.md', 'first-reader.md', 'canon.md', 'SOURCES.md',
]) {
  await stat(resolve(knowledgeRoot, fileName))
}
}
const profileModules = resolve(resources, 'profile-template', 'node_modules')
const installed = []
for (const name of await readdir(profileModules)) {
  if (name.startsWith('dsh-')) installed.push(name)
  else if (name.startsWith('@')) {
    for (const child of await readdir(resolve(profileModules, name))) {
      if (child.startsWith('dsh-')) installed.push(`${name}/${child}`)
    }
  }
}
installed.sort()
if (JSON.stringify(installed) !== JSON.stringify([...installedNames].sort())) throw new Error('unexpected packaged business dependencies')
const nodeProbe = spawnSync(resolve(resources, 'node', nodeExecutableName), ['--version'], { encoding: 'utf8', windowsHide: true })
if (nodeProbe.status !== 0 || nodeProbe.stdout.trim() !== 'v26.10.0') throw new Error('packaged Node probe failed')

// Exercise the real portable materializer against the final packaged resources,
// even on macOS where the normal installed launch intentionally skips copying.
const smokeHome = await mkdtemp(join(tmpdir(), 'dsh-runtime-smoke-'))
try {
  const runtime = await materializePackagedRuntime(smokeHome, resources)
  const reused = await materializePackagedRuntime(smokeHome, resources)
  if (runtime.nodePath !== reused.nodePath) throw new Error('packaged runtime cache was not reused')
  const probe = spawnSync(runtime.nodePath, ['--version'], { encoding: 'utf8', windowsHide: true })
  if (probe.status !== 0 || probe.stdout.trim() !== 'v26.10.0') throw new Error('materialized Node probe failed')
  const npmRoot = resolve(dirname(runtime.nodePath), 'node_modules', 'npm')
  const npmVersion = (await json(resolve(npmRoot, 'package.json'))).version
  for (const name of ['npm', 'npx']) {
    const npmProbe = process.platform === 'win32'
      ? spawnSync(runtime.nodePath, [resolve(npmRoot, 'bin', `${name}-cli.js`), '--version'], { encoding: 'utf8', windowsHide: true })
      : spawnSync(resolve(dirname(runtime.nodePath), name), ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } })
    if (npmProbe.status !== 0 || npmProbe.stdout.trim() !== npmVersion) throw new Error(`materialized ${name} probe failed: ${npmProbe.stderr || npmProbe.stdout}`)
  }
  const leftovers = await readdir(join(smokeHome, 'runtime'))
  if (leftovers.length !== 1 || leftovers[0] !== 'dsh-editor-runtime') throw new Error('packaged runtime left staging directories behind')
} finally {
  await rm(smokeHome, { recursive: true, force: true, maxRetries: 3 })
}

// Every macOS release also boots the actual ZIP in a clean user environment.
if (process.platform === 'darwin') await import('../e2e/macos-packaged.mjs')

const artifacts = []
for (const name of artifactNames) {
  const file = resolve(output, name)
  artifacts.push({ file, bytes: (await stat(file)).size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })
}
const report = { ok: true, source: 'current', platform: platformId, artifacts, manifest, actual, runtimeSmoke: true }
await writeFile(resolve(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
