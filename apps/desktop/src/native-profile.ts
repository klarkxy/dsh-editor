import { REQUIRED_CORE_BUNDLES, RETIRED_PLUGIN_PACKAGES, HOST_LOCKED_ENTRY_IDS as HOST_LOCKED_PLUGIN_IDS, RESTORED_PATCH_IDS as CORE_PATCH_IDS } from './distribution-contract.js'
export { REQUIRED_CORE_BUNDLES } from './distribution-contract.js'
import { copyFile, cp, lstat, mkdir, readFile, readdir, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve as resolvePath, sep, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq, type ParsedNode } from 'yaml'
import { resolveBundledPackageManager, type BundledPackageManager } from './package-manager.js'

export const NATIVE_PLUGIN_MIGRATION_MARKER = '.dsh-editor-native-plugins-migrated'
export const NATIVE_STATE_BACKUP_SUFFIX = '.before-native-plugin-manager'
export const PROFILE_NAME = 'dsh-editor'
export const NATIVE_WORKSPACE_YAML = `packages:
  - '.'
nodeLinker: hoisted
autoInstallPeers: false
`

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/
export const PROFILE_CONFIG_PACKAGE = 'dsh-editor-profile-config'
export const PROFILE_CONFIG_SPEC = 'link:./profile-config'
export const BUNDLED_PACKAGES_DIR = join('bundled-packages', 'node_modules')
export const RUNTIME_LINKS_DIR = join('runtime-links', 'node_modules')
const NATIVE_OWNED_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'compatibility.json'] as const
const MANAGED_PATCH_MARK = 'managed-by: dsh-editor-plugins'
const HOME_PLUGIN_FILES = ['dsh-plugins.json', 'cordis.patch.yml', NATIVE_PLUGIN_MIGRATION_MARKER] as const
const NATIVE_MIGRATION_MARKER_BODY = `${JSON.stringify({ app: 'dsh-editor', schema: 1 })}\n`

export type ProfileManifest = {
  name?: string
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export type NativeBaseline = Record<string, string>

export type MergeNativeManifestOptions = {
  templatePackages?: readonly string[]
  previousPackages?: readonly string[]
  templateBaseline?: NativeBaseline
  previousBaseline?: NativeBaseline
}

export type NativePluginCommand = (
  context: { profile: string; dir: string; installAnchor: string },
  args: readonly string[],
  options: BundledPackageManager & { activateNewBundles: false },
) => Promise<{ exitCode?: number; output?: string }>

export type PreserveNativeProfileResult = {
  previousDependencies: Record<string, string>
  mergedDependencies: Record<string, string>
  merged: ProfileManifest
}

type InstalledRecord = { name?: unknown; spec?: unknown; version?: unknown }
type ModuleMergePolicy = { keepStaged: ReadonlySet<string>; skipTop: ReadonlySet<string> }

export type HomeFileSnapshot = { path: string; content: string | undefined }

export function isRetiredPackage(name: string): boolean {
  return RETIRED_PLUGIN_PACKAGES.has(name)
}

export function isRequiredCoreBundle(name: string): boolean {
  return REQUIRED_CORE_BUNDLES.has(name)
}

export function isSafeUserPackageName(name: string, protectedNames: readonly string[]): boolean {
  return PACKAGE_NAME.test(name) && !name.includes('..') && !protectedNames.includes(name)
    && !isRequiredCoreBundle(name) && !isRetiredPackage(name)
}

export async function nativeMigrationComplete(home: string): Promise<boolean> {
  return existsSync(join(home, NATIVE_PLUGIN_MIGRATION_MARKER))
}

export async function writeNativeMigrationMarker(home: string, write: typeof writeFile = writeFile): Promise<void> {
  await write(join(home, NATIVE_PLUGIN_MIGRATION_MARKER), NATIVE_MIGRATION_MARKER_BODY)
}

export async function snapshotHomePluginFiles(home: string): Promise<HomeFileSnapshot[]> {
  const snaps: HomeFileSnapshot[] = []
  for (const file of HOME_PLUGIN_FILES) snaps.push(await snapshotFile(join(home, file)))
  return snaps
}

export async function restoreHomePluginFiles(snaps: readonly HomeFileSnapshot[]): Promise<void> {
  for (const snap of snaps) await restoreSnapshot(snap)
}

export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function readCompositionPackages(dir: string): Promise<string[]> {
  const composition = await readJsonFile<{ packages?: unknown; libraries?: unknown }>(join(dir, 'composition.json'))
  const names = [
    ...(Array.isArray(composition?.packages) ? composition.packages : []),
    ...(Array.isArray(composition?.libraries) ? composition.libraries : []),
  ]
  return names.filter((name): name is string => typeof name === 'string' && name !== '')
}

/** Immutable distribution baseline, or `undefined` when a legacy profile never recorded one. */
export async function readNativeBaseline(dir: string): Promise<NativeBaseline | undefined> {
  const composition = await readJsonFile<{ nativeDependencies?: unknown }>(join(dir, 'composition.json'))
  if (!composition || !Object.prototype.hasOwnProperty.call(composition, 'nativeDependencies')) return undefined
  return asStringRecord(composition.nativeDependencies)
}

export function importerSpecsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && item.trim() && item !== '*') out[key] = item
  }
  return out
}

function asNameList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string' && name !== '') : []
}

function mappingId(node: unknown): string | undefined {
  if (!isMap(node)) return undefined
  const id = node.get('id')
  return typeof id === 'string' && id ? id : undefined
}

function cloneYamlNode(item: unknown): ParsedNode {
  const cloned = item && typeof item === 'object' && 'clone' in item && typeof item.clone === 'function'
    ? (item as { clone: () => unknown }).clone()
    : item
  return cloned as ParsedNode
}

function dumpDocument(doc: { toString(): string }): string {
  const text = String(doc)
  return text.endsWith('\n') ? text : `${text}\n`
}

/** Merge a new shipped template onto the previous native profile package ownership. */
export function mergeNativeManifest(
  template: ProfileManifest,
  previous: ProfileManifest | undefined,
  options: MergeNativeManifestOptions = {},
): ProfileManifest {
  const templateDeps = asStringRecord(template.dependencies)
  const previousDeps = asStringRecord(previous?.dependencies)
  const currentBaseline = asStringRecord(options.templateBaseline ?? templateDeps)
  const previousBaseline = asStringRecord(options.previousBaseline)
  const legacy = options.previousBaseline === undefined
  const dependencies: Record<string, string> = {}

  for (const [name, spec] of Object.entries(previousDeps)) {
    if (isRetiredPackage(name)) continue
    const currentSpec = currentBaseline[name] ?? templateDeps[name]
    if (isRequiredCoreBundle(name)) {
      dependencies[name] = currentSpec ?? spec
      continue
    }
    if (legacy) {
      dependencies[name] = spec
      continue
    }
    const priorBase = previousBaseline[name]
    if (priorBase !== undefined && spec === priorBase) {
      if (currentSpec !== undefined) dependencies[name] = currentSpec
      continue
    }
    dependencies[name] = spec
  }

  for (const [name, spec] of Object.entries(currentBaseline)) {
    if (name in dependencies || isRetiredPackage(name)) continue
    if (isRequiredCoreBundle(name)) {
      dependencies[name] = spec
      continue
    }
    if (!legacy && previousBaseline[name] !== undefined && !(name in previousDeps)) continue
    if (name in previousDeps) continue
    dependencies[name] = spec
  }

  const templateBundles = asNameList(template.dsh?.profile?.bundles)
  const previousBundles = asNameList(previous?.dsh?.profile?.bundles)
  const previousComposition = new Set(options.previousPackages ?? [])
  const bundles: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    if (!name || seen.has(name) || isRetiredPackage(name)) return
    seen.add(name)
    bundles.push(name)
  }
  if (previous === undefined) {
    for (const name of templateBundles) add(name)
  } else {
    for (const name of templateBundles) {
      if (isRequiredCoreBundle(name)) add(name)
    }
    for (const name of Object.keys(currentBaseline)) {
      if (isRequiredCoreBundle(name) || !(name in dependencies) || name in previousDeps) continue
      if (previousComposition.has(name)) continue
      add(name)
    }
    for (const name of previousBundles) {
      if (!legacy && previousBaseline[name] !== undefined && !(name in previousDeps)) continue
      if (isRequiredCoreBundle(name)) continue
      if (name in dependencies || templateBundles.includes(name)) add(name)
    }
  }
  return {
    ...previous,
    ...template,
    dependencies,
    dsh: {
      ...previous?.dsh,
      ...template.dsh,
      profile: {
        ...previous?.dsh?.profile,
        ...template.dsh?.profile,
        bundles,
      },
    },
  }
}

export function mergeProfilePatch(templateText: string, previousText: string | undefined): string {
  const templateDoc = parseDocument(templateText)
  const previousDoc = parseDocument(previousText ?? '[]\n')
  const templateSeq = isSeq(templateDoc.contents) ? templateDoc.contents : new YAMLSeq()
  const previousSeq = isSeq(previousDoc.contents) ? previousDoc.contents : new YAMLSeq()
  const previousById = new Map<string, unknown>()
  for (const item of previousSeq.items) {
    const id = mappingId(item)
    if (id) previousById.set(id, item)
  }
  const merged = new YAMLSeq<ParsedNode>()
  const seen = new Set<string>()
  if (isSeq(previousSeq) && previousSeq.commentBefore && !merged.commentBefore) merged.commentBefore = previousSeq.commentBefore
  for (const item of templateSeq.items) {
    const id = mappingId(item)
    if (id === 'ui-plugin-manager') continue
    if (id) {
      seen.add(id)
      const previous = previousById.get(id)
      merged.add(cloneYamlNode(previous && !CORE_PATCH_IDS.has(id) ? previous : item))
    } else merged.add(cloneYamlNode(item))
  }
  for (const item of previousSeq.items) {
    const id = mappingId(item)
    if (!id || seen.has(id) || id === 'ui-plugin-manager' || HOST_LOCKED_PLUGIN_IDS.has(id)) continue
    merged.add(cloneYamlNode(item))
  }
  const output = previousText !== undefined ? previousDoc : templateDoc
  output.contents = merged as typeof output.contents
  if (!output.commentBefore && previousDoc.commentBefore) output.commentBefore = previousDoc.commentBefore
  return dumpDocument(output)
}

function applyEnablementToPatch(patchText: string, enablement: Record<string, boolean>): string {
  if (Object.keys(enablement).length === 0) return patchText.endsWith('\n') ? patchText : `${patchText}\n`
  const doc = parseDocument(patchText)
  if (!isSeq(doc.contents)) {
    const empty = parseDocument('[]\n')
    if (isSeq(empty.contents)) doc.contents = empty.contents
  }
  const seq = doc.contents
  if (!isSeq(seq)) return dumpDocument(doc)
  const byId = new Map<string, YAMLMap>()
  for (const item of seq.items) {
    const id = mappingId(item)
    if (id && isMap(item)) byId.set(id, item as YAMLMap)
  }
  for (const [id, enabled] of Object.entries(enablement)) {
    const current = byId.get(id)
    if (current) {
      current.set('disabled', !enabled)
      continue
    }
    seq.add(cloneYamlNode(doc.createNode({ id, disabled: !enabled })))
  }
  return dumpDocument(doc)
}

async function snapshotFile(path: string): Promise<HomeFileSnapshot> {
  try {
    return { path, content: await readFile(path, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, content: undefined }
    throw error
  }
}

async function restoreSnapshot(snap: HomeFileSnapshot): Promise<void> {
  if (snap.content === undefined) {
    try { await unlink(snap.path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return
  }
  await mkdir(dirname(snap.path), { recursive: true })
  await writeFile(snap.path, snap.content)
}

async function backupOnce(path: string, suffix = NATIVE_STATE_BACKUP_SUFFIX): Promise<void> {
  try {
    await copyFile(path, path + suffix, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function copyIfPresent(source: string, target: string): Promise<void> {
  try {
    await copyFile(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function symlinkKind(directory: boolean): 'junction' | 'dir' | 'file' {
  if (process.platform === 'win32') return directory ? 'junction' : 'file'
  return directory ? 'dir' : 'file'
}

function retargetedLink(sourceLink: string, rawTarget: string, sourceRoot: string, destLink: string, destRoot: string): string {
  const sourceAbs = isAbsolute(rawTarget) ? rawTarget : resolvePath(dirname(sourceLink), rawTarget)
  if (!isPathInside(sourceRoot, sourceAbs) && sourceAbs !== sourceRoot) return rawTarget
  const destAbs = join(destRoot, relative(sourceRoot, sourceAbs))
  if (process.platform === 'win32') return destAbs
  const rel = relative(dirname(destLink), destAbs)
  if (!rel) return '.'
  return rel.startsWith('.') ? rel : join('.', rel)
}

async function copyRetargetedLink(source: string, dest: string, sourceRoot: string, destRoot: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const raw = await readlink(source)
  const st = await lstat(source)
  const targetAbs = isAbsolute(raw) ? raw : resolvePath(dirname(source), raw)
  let directory = st.isDirectory()
  if (!directory) {
    try { directory = (await lstat(targetAbs)).isDirectory() } catch { directory = true }
  }
  const target = retargetedLink(source, raw, sourceRoot, dest, destRoot)
  await symlink(target, dest, symlinkKind(directory))
}

async function copyTreeRetargeting(
  source: string,
  dest: string,
  sourceRoot: string,
  destRoot: string,
  skip?: ReadonlySet<string>,
): Promise<void> {
  if (!existsSync(source) || existsSync(dest)) return
  const st = await lstat(source)
  if (st.isSymbolicLink()) {
    await copyRetargetedLink(source, dest, sourceRoot, destRoot)
    return
  }
  if (st.isDirectory()) {
    await mkdir(dest, { recursive: true })
    for (const name of await readdir(source)) {
      if (skip?.has(name)) continue
      await copyTreeRetargeting(join(source, name), join(dest, name), sourceRoot, destRoot)
    }
    return
  }
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(source, dest)
}

/** Copy a profile/template tree, retargeting internal links and leaving external SDK links unchanged. */
export async function copyRetargetedProfileTree(
  source: string,
  dest: string,
  options: { skip?: readonly string[] } = {},
): Promise<void> {
  await copyTreeRetargeting(source, dest, source, dest, options.skip ? new Set(options.skip) : undefined)
}

function packageDir(root: string, base: string, name: string): string {
  return join(root, base, ...name.split('/'))
}

async function listMaterializedPackageNames(nodeModulesRoot: string): Promise<string[]> {
  if (!existsSync(nodeModulesRoot)) return []
  const names: string[] = []
  for (const entry of await readdir(nodeModulesRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue
    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModulesRoot, entry.name)
      let children: import('node:fs').Dirent[]
      try { children = await readdir(scopeDir, { withFileTypes: true }) } catch { continue }
      for (const child of children) {
        if (child.name.startsWith('.') || (!child.isDirectory() && !child.isSymbolicLink())) continue
        names.push(`${entry.name}/${child.name}`)
      }
    } else {
      names.push(entry.name)
    }
  }
  return names.sort()
}

async function ensureRealDirectory(path: string): Promise<void> {
  if (existsSync(path)) {
    const st = await lstat(path)
    if (st.isSymbolicLink()) await rm(path, { recursive: true, force: true })
    else if (st.isDirectory()) return
    else await rm(path, { force: true })
  }
  await mkdir(path, { recursive: true })
}

async function replaceWithLink(dest: string, target: string): Promise<void> {
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
  await mkdir(dirname(dest), { recursive: true })
  await symlink(target, dest, symlinkKind(true))
}

function distributionSpec(name: string, spec: string): boolean {
  return spec === PROFILE_CONFIG_SPEC
    || spec === `link:./bundled-packages/node_modules/${name}`
}

async function overlayNativePackage(source: string, dest: string, sourceRoot: string, destRoot: string): Promise<void> {
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
  await copyTreeRetargeting(source, dest, sourceRoot, destRoot)
}

/** Preserve the previous native module graph; default-owned artifacts on stage stay put. */
async function mergeModuleTree(
  source: string,
  dest: string,
  sourceRoot: string,
  destRoot: string,
  policy: ModuleMergePolicy | undefined,
  scopePrefix = '',
): Promise<void> {
  if (!existsSync(source)) return
  await mkdir(dest, { recursive: true })
  for (const name of await readdir(source)) {
    const from = join(source, name)
    const to = join(dest, name)
    const packageName = `${scopePrefix}${name}`
    const scoped = name.startsWith('@')
    const store = name === '.pnpm' || name === '.bin'
    if (isRetiredPackage(packageName) || policy?.skipTop.has(packageName)) continue
    const fromStat = await lstat(from)
    if (!store && !scoped && !fromStat.isDirectory() && !fromStat.isSymbolicLink()) continue
    if (!existsSync(to)) {
      if (scoped && fromStat.isDirectory() && !fromStat.isSymbolicLink()) {
        await mkdir(to, { recursive: true })
        await mergeModuleTree(from, to, sourceRoot, destRoot, policy, `${name}/`)
        continue
      }
      await copyTreeRetargeting(from, to, sourceRoot, destRoot)
      continue
    }
    const toStat = await lstat(to)
    const bothDirs = fromStat.isDirectory() && !fromStat.isSymbolicLink() && toStat.isDirectory() && !toStat.isSymbolicLink()
    if (store && bothDirs) await mergeModuleTree(from, to, sourceRoot, destRoot, policy)
    else if (scoped && bothDirs) await mergeModuleTree(from, to, sourceRoot, destRoot, policy, `${name}/`)
    else if (!store && !scoped && !isRequiredCoreBundle(packageName) && !policy?.keepStaged.has(packageName)) {
      await overlayNativePackage(from, to, sourceRoot, destRoot)
    }
  }
}

async function copyRetainedArtifacts(previous: string, stage: string, currentBaseline: NativeBaseline): Promise<void> {
  const sourceRoot = join(previous, BUNDLED_PACKAGES_DIR)
  const destRoot = join(stage, BUNDLED_PACKAGES_DIR)
  if (!existsSync(sourceRoot)) return
  await mkdir(destRoot, { recursive: true })
  for (const name of await listMaterializedPackageNames(sourceRoot)) {
    if (name in currentBaseline && existsSync(packageDir(stage, BUNDLED_PACKAGES_DIR, name))) continue
    await copyTreeRetargeting(packageDir(previous, BUNDLED_PACKAGES_DIR, name), packageDir(stage, BUNDLED_PACKAGES_DIR, name), previous, stage)
  }
}

async function removeRemovedOptionalTops(stage: string, removed: ReadonlySet<string>): Promise<void> {
  for (const name of removed) {
    const dest = packageDir(stage, 'node_modules', name)
    if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
  }
}

/** Project each materialized SDK package individually; never symlink a whole namespace. */
export async function projectRuntimeLinks(
  stage: string,
  runtimeNodeModules: string,
  appNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  const destRoot = join(stage, RUNTIME_LINKS_DIR)
  if (existsSync(join(stage, 'runtime-links'))) await rm(join(stage, 'runtime-links'), { recursive: true, force: true })
  await mkdir(destRoot, { recursive: true })
  await ensureRealDirectory(join(stage, 'node_modules'))
  for (const name of await listMaterializedPackageNames(runtimeNodeModules)) {
    if (appNames.has(name) || name === PROFILE_CONFIG_PACKAGE) continue
    const source = packageDir(runtimeNodeModules, '', name)
    if (!existsSync(source)) continue
    const projected = packageDir(stage, RUNTIME_LINKS_DIR, name)
    const scoped = name.includes('/')
    if (scoped) await ensureRealDirectory(dirname(projected))
    await replaceWithLink(projected, source)
    const top = packageDir(stage, 'node_modules', name)
    if (scoped) await ensureRealDirectory(dirname(top))
    if (existsSync(top)) {
      const st = await lstat(top)
      if (st.isSymbolicLink() || appNames.has(name)) continue
    }
    if (!existsSync(top)) await replaceWithLink(top, source)
  }
}

export async function linkSdkIntoArtifactTree(stage: string, runtimeNodeModules?: string): Promise<void> {
  const artifactsRoot = join(stage, BUNDLED_PACKAGES_DIR)
  if (!existsSync(artifactsRoot)) return
  for (const name of await listMaterializedPackageNames(artifactsRoot)) {
    const artifact = packageDir(stage, BUNDLED_PACKAGES_DIR, name)
    const manifest = await readJsonFile<ProfileManifest>(join(artifact, 'package.json'))
    for (const [dep, spec] of Object.entries(asStringRecord(manifest?.dependencies))) {
      const dest = packageDir(artifact, 'node_modules', dep)
      let target: string | undefined
      if (spec.startsWith('link:') || spec.startsWith('file:')) {
        target = resolvePath(artifact, spec.slice(spec.indexOf(':') + 1))
      } else if (runtimeNodeModules && existsSync(packageDir(runtimeNodeModules, '', dep))) {
        target = packageDir(runtimeNodeModules, '', dep)
      }
      if (!target || !existsSync(target)) continue
      if (dep.includes('/')) await ensureRealDirectory(dirname(dest))
      await replaceWithLink(dest, target)
    }
  }
}

export async function linkInitialNativeModules(stage: string, merged: ProfileManifest): Promise<void> {
  const deps = asStringRecord(merged.dependencies)
  for (const [name, spec] of Object.entries(deps)) {
    const dest = packageDir(stage, 'node_modules', name)
    if (name.includes('/')) await ensureRealDirectory(dirname(dest))
    if (name === PROFILE_CONFIG_PACKAGE || spec === PROFILE_CONFIG_SPEC) {
      const config = join(stage, 'profile-config')
      if (!existsSync(config)) continue
      await replaceWithLink(dest, config)
      continue
    }
    if (!distributionSpec(name, spec)) continue
    const artifact = packageDir(stage, BUNDLED_PACKAGES_DIR, name)
    if (!existsSync(artifact)) continue
    await replaceWithLink(dest, artifact)
  }
}

function overlayPolicy(
  mergedDeps: Record<string, string>,
  currentBaseline: NativeBaseline,
  previousBaseline: NativeBaseline | undefined,
  artifactNames: readonly string[],
): ModuleMergePolicy {
  const keepStaged = new Set<string>([...REQUIRED_CORE_BUNDLES, PROFILE_CONFIG_PACKAGE, ...artifactNames])
  for (const [name, spec] of Object.entries(mergedDeps)) {
    if (currentBaseline[name] !== undefined && spec === currentBaseline[name]) keepStaged.add(name)
  }
  const skipTop = new Set<string>()
  for (const name of Object.keys(previousBaseline ?? {})) {
    if (isRequiredCoreBundle(name) || name in mergedDeps) continue
    skipTop.add(name)
    keepStaged.delete(name)
  }
  for (const [name, spec] of Object.entries(mergedDeps)) {
    if (currentBaseline[name] !== undefined && spec !== currentBaseline[name]) keepStaged.delete(name)
  }
  return { keepStaged, skipTop }
}

/** Rewrite absolute links that still name `fromRoot` so they stay inside `toRoot` after a directory rename. */
export async function retargetInternalLinkTargets(root: string, fromRoot: string, toRoot: string): Promise<void> {
  if (fromRoot === toRoot || !existsSync(root)) return
  let names: string[]
  try { names = await readdir(root) } catch { return }
  for (const name of names) {
    const path = join(root, name)
    const st = await lstat(path)
    if (st.isSymbolicLink()) {
      const raw = await readlink(path)
      const abs = isAbsolute(raw) ? raw : resolvePath(dirname(path), raw)
      if (!isPathInside(fromRoot, abs) && abs !== fromRoot) continue
      await unlink(path)
      const destAbs = join(toRoot, relative(fromRoot, abs))
      const target = process.platform === 'win32' ? destAbs : retargetedLink(path, destAbs, toRoot, path, toRoot)
      await symlink(target, path, symlinkKind(st.isDirectory() || true))
    } else if (st.isDirectory()) {
      await retargetInternalLinkTargets(path, fromRoot, toRoot)
    }
  }
}

export async function ensureNativeWorkspace(profileDir: string): Promise<void> {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  if (existsSync(path)) return
  await writeFile(path, NATIVE_WORKSPACE_YAML.endsWith('\n') ? NATIVE_WORKSPACE_YAML : `${NATIVE_WORKSPACE_YAML}\n`)
}

/** Copy native manager-owned files from an owned profile onto a staged template. */
export async function preserveNativeProfileState(
  previous: string,
  stage: string,
  options: { mergePatch?: boolean; runtimeNodeModules?: string } = {},
): Promise<PreserveNativeProfileResult> {
  const templateManifest = await readJsonFile<ProfileManifest>(join(stage, 'package.json')) ?? {}
  const templateBaseline = await readNativeBaseline(stage) ?? asStringRecord(templateManifest.dependencies)
  if (!existsSync(join(previous, 'package.json'))) {
    await ensureNativeWorkspace(stage)
    const merged = templateManifest
    await linkInitialNativeModules(stage, merged)
    if (options.runtimeNodeModules) await linkSdkIntoArtifactTree(stage, options.runtimeNodeModules)
    return {
      previousDependencies: {},
      mergedDependencies: asStringRecord(merged.dependencies),
      merged,
    }
  }
  const previousManifest = await readJsonFile<ProfileManifest>(join(previous, 'package.json'))
  const previousBaseline = await readNativeBaseline(previous)
  const merged = mergeNativeManifest(templateManifest, previousManifest, {
    templatePackages: await readCompositionPackages(stage),
    previousPackages: await readCompositionPackages(previous),
    templateBaseline,
    previousBaseline,
  })
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(merged, null, 2)}\n`)
  for (const file of NATIVE_OWNED_FILES) await copyIfPresent(join(previous, file), join(stage, file))
  let templatePatch = '[]\n'
  let previousPatch: string | undefined
  try { templatePatch = await readFile(join(stage, 'cordis.patch.yml'), 'utf8') } catch { /* staged template may omit it */ }
  try { previousPatch = await readFile(join(previous, 'cordis.patch.yml'), 'utf8') } catch { previousPatch = undefined }
  if (previousPatch !== undefined && options.mergePatch !== false) {
    await writeFile(join(stage, 'cordis.patch.yml'), mergeProfilePatch(templatePatch, previousPatch), 'utf8')
  }
  for (const file of ['.editor-writing-migrated', 'cordis.patch.before-dsh-0.1.7.yml']) {
    await copyIfPresent(join(previous, file), join(stage, file))
  }
  const mergedDeps = asStringRecord(merged.dependencies)
  await copyRetainedArtifacts(previous, stage, templateBaseline)
  const artifacts = existsSync(join(stage, BUNDLED_PACKAGES_DIR))
    ? await listMaterializedPackageNames(join(stage, BUNDLED_PACKAGES_DIR))
    : []
  const policy = overlayPolicy(mergedDeps, templateBaseline, previousBaseline, artifacts)
  await mergeModuleTree(join(previous, 'node_modules'), join(stage, 'node_modules'), previous, stage, policy)
  await removeRemovedOptionalTops(stage, policy.skipTop)
  await linkInitialNativeModules(stage, merged)
  if (options.runtimeNodeModules) await linkSdkIntoArtifactTree(stage, options.runtimeNodeModules)
  await ensureNativeWorkspace(stage)
  return {
    previousDependencies: asStringRecord(previousManifest?.dependencies),
    mergedDependencies: mergedDeps,
    merged,
  }
}

export function resolveNativeNodePath(
  options?: { nodePath?: string },
  deploy?: { nodePath?: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  return options?.nodePath?.trim()
    || deploy?.nodePath?.trim()
    || env.DSH_DESKTOP_NODE_PATH?.trim()
    || process.execPath
}

export async function loadPublicPluginOperations(runtimeNodeModules: string): Promise<NativePluginCommand> {
  const operations = join(runtimeNodeModules, '@deepseek-ai', 'dsh-plugin-manager', 'lib', 'types', 'operations.js')
  const module = await import(pathToFileURL(operations).href) as { runPluginCommand: NativePluginCommand }
  if (typeof module.runPluginCommand !== 'function') {
    throw new Error(`Public plugin operations are missing runPluginCommand: ${operations}`)
  }
  return module.runPluginCommand
}

/** Reconcile a copied lock when importer specs changed. Does not edit the lock directly. */
export async function reconcileNativeLockfile(options: {
  stage: string
  runtimeNodeModules: string
  nodePath: string
  env?: NodeJS.ProcessEnv
  previousDependencies: Record<string, string>
  mergedDependencies: Record<string, string>
  runPluginCommand?: NativePluginCommand
}): Promise<void> {
  if (importerSpecsEqual(options.previousDependencies, options.mergedDependencies)) return
  if (!existsSync(join(options.stage, 'pnpm-lock.yaml'))) return
  const runtimeRoot = dirname(options.runtimeNodeModules)
  const installAnchor = join(runtimeRoot, 'package.json')
  if (!existsSync(installAnchor)) throw new Error(`Native lock reconciliation is missing installAnchor: ${installAnchor}`)
  const runPluginCommand = options.runPluginCommand ?? await loadPublicPluginOperations(options.runtimeNodeModules)
  const manager = resolveBundledPackageManager(options.nodePath, options.env ?? process.env)
  const result = await runPluginCommand(
    { profile: PROFILE_NAME, dir: options.stage, installAnchor },
    ['install', '--lockfile-only', '--no-frozen-lockfile', '--offline', '--ignore-scripts'],
    { ...manager, activateNewBundles: false },
  )
  if ((result?.exitCode ?? 0) !== 0) {
    throw new Error(`Native lock reconciliation failed: ${result?.output ?? `exit ${result?.exitCode}`}`)
  }
}

function dependencyMaterialized(profilePath: string, name: string, spec: string): boolean {
  if (name === PROFILE_CONFIG_PACKAGE || spec === PROFILE_CONFIG_SPEC) {
    return existsSync(join(profilePath, 'profile-config', 'package.json'))
  }
  if (spec.startsWith('link:./bundled-packages/')) {
    return existsSync(packageDir(profilePath, BUNDLED_PACKAGES_DIR, name))
  }
  return existsSync(join(packageDir(profilePath, 'node_modules', name), 'package.json'))
}

export async function nativeReuseLayoutReady(
  profilePath: string,
  template: string,
  runtimeNodeModules?: string,
): Promise<'legacy' | 'ready' | 'restage'> {
  const templateBaseline = await readNativeBaseline(template)
  if (templateBaseline === undefined) return 'legacy'
  const profileBaseline = await readNativeBaseline(profilePath)
  if (profileBaseline === undefined) return 'restage'
  if (!existsSync(join(profilePath, 'profile-config', 'package.json')) && PROFILE_CONFIG_PACKAGE in templateBaseline) {
    return 'restage'
  }
  for (const name of REQUIRED_CORE_BUNDLES) {
    const spec = templateBaseline[name]
    if (!spec) continue
    if (!dependencyMaterialized(profilePath, name, spec)) return 'restage'
  }
  const manifest = await readJsonFile<ProfileManifest>(join(profilePath, 'package.json'))
  for (const [name, spec] of Object.entries(asStringRecord(manifest?.dependencies))) {
    if (!dependencyMaterialized(profilePath, name, spec)) return 'restage'
  }
  if (runtimeNodeModules && existsSync(join(profilePath, 'runtime-links'))) {
    for (const name of await listMaterializedPackageNames(join(profilePath, RUNTIME_LINKS_DIR))) {
      const link = packageDir(profilePath, RUNTIME_LINKS_DIR, name)
      const target = packageDir(runtimeNodeModules, '', name)
      if (!existsSync(link) || !existsSync(target)) return 'restage'
      try {
        const st = await lstat(link)
        if (!st.isSymbolicLink()) return 'restage'
        const resolved = resolvePath(dirname(link), await readlink(link))
        if (resolved !== resolvePath(target)) return 'restage'
      } catch {
        return 'restage'
      }
    }
    const scope = join(profilePath, 'node_modules', '@deepseek-ai')
    if (existsSync(scope)) {
      try {
        if ((await lstat(scope)).isSymbolicLink()) return 'restage'
      } catch {
        return 'restage'
      }
    }
  }
  return 'ready'
}

function renderManagedOverridePatch(overrides: Record<string, boolean>): string {
  const ids = Object.keys(overrides).sort()
  if (ids.length === 0) return '[]\n'
  return `# ${MANAGED_PATCH_MARK}\n${ids.map((id) => `- id: ${id}\n  disabled: ${overrides[id] ? 'false' : 'true'}`).join('\n')}\n`
}

function parseManagedOverridePatch(text: string): Record<string, boolean> | undefined {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const trimmed = normalized.trim()
  if (!trimmed || trimmed === '[]') return {}
  if (!trimmed.includes(MANAGED_PATCH_MARK)) return undefined
  const overrides: Record<string, boolean> = {}
  const pattern = /- id:\s*([A-Za-z0-9._-]+)\r?\n\s+disabled:\s*(true|false)/g
  for (const match of normalized.matchAll(pattern)) {
    if (match[1] && !HOST_LOCKED_PLUGIN_IDS.has(match[1])) overrides[match[1]] = match[2] === 'false'
  }
  const comparable = normalized.endsWith('\n') ? normalized : `${normalized}\n`
  if (comparable !== renderManagedOverridePatch(overrides)) return undefined
  return overrides
}

export function localFileSpec(profileDir: string, pluginDir: string): string {
  const rel = relative(profileDir, pluginDir).split(sep).join(posix.sep)
  const normalized = (rel.startsWith('.') ? rel : `./${rel}`).split(win32.sep).join(posix.sep)
  return `file:${normalized}`
}

async function linkOrCopy(source: string, destination: string): Promise<void> {
  if (existsSync(destination)) return
  await mkdir(dirname(destination), { recursive: true })
  try {
    await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    await cp(source, destination, { recursive: true })
  }
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Re-create missing node_modules links for native `file:` specs that still live in user-plugins. */
export async function ensureLocalFileLinks(home: string, profileDir: string): Promise<void> {
  const manifest = await readJsonFile<ProfileManifest>(join(profileDir, 'package.json'))
  if (!manifest?.dependencies) return
  const userPlugins = join(home, 'user-plugins')
  for (const [name, spec] of Object.entries(manifest.dependencies)) {
    if (!spec.startsWith('file:') || !PACKAGE_NAME.test(name)) continue
    const source = join(profileDir, spec.slice('file:'.length))
    if (!isPathInside(userPlugins, source) || !existsSync(join(source, 'package.json'))) continue
    await linkOrCopy(source, join(profileDir, 'node_modules', name))
  }
}

function asInstalled(value: unknown): InstalledRecord[] {
  return Array.isArray(value) ? value.filter((item): item is InstalledRecord => Boolean(item && typeof item === 'object')) : []
}

/** One-time move of custom installed records into native profile files. Never writes `*` or the complete marker. */
export async function migrateLegacyPluginInventory(home: string, profileDir: string, bundledNames: readonly string[]): Promise<void> {
  if (await nativeMigrationComplete(home)) return
  const statePath = join(home, 'dsh-plugins.json')
  const homePatchPath = join(home, 'cordis.patch.yml')
  const markerPath = join(home, NATIVE_PLUGIN_MIGRATION_MARKER)
  const state = await readJsonFile<{ schema?: unknown; installed?: unknown; overrides?: unknown; presets?: unknown }>(statePath)
  const manifestPath = join(profileDir, 'package.json')
  const manifest = await readJsonFile<ProfileManifest>(manifestPath)
  if (!manifest) return
  const snapshots = [
    await snapshotFile(statePath),
    await snapshotFile(homePatchPath),
    await snapshotFile(markerPath),
    await snapshotFile(manifestPath),
    await snapshotFile(join(profileDir, 'cordis.patch.yml')),
  ]
  try {
    const dependencies = { ...(manifest.dependencies ?? {}) }
    const bundles = [...asNameList(manifest.dsh?.profile?.bundles)]
    if (state?.schema === 1) {
      for (const item of asInstalled(state.installed)) {
        const name = typeof item.name === 'string' ? item.name : ''
        if (!isSafeUserPackageName(name, bundledNames)) continue
        const source = join(home, 'user-plugins', name)
        if (!existsSync(join(source, 'package.json'))) continue
        await linkOrCopy(source, join(profileDir, 'node_modules', name))
        if (!(name in dependencies) || dependencies[name] === '*') dependencies[name] = localFileSpec(profileDir, source)
        if (!bundles.includes(name)) bundles.push(name)
      }
    }
    let patchText = '[]\n'
    try { patchText = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8') } catch { patchText = '[]\n' }
    let homePatchText: string | undefined
    try { homePatchText = await readFile(homePatchPath, 'utf8') } catch { homePatchText = undefined }
    const overlay = homePatchText === undefined ? {} : parseManagedOverridePatch(homePatchText)
    const jsonOverrides = state?.overrides && typeof state.overrides === 'object' && !Array.isArray(state.overrides)
      ? state.overrides as Record<string, unknown>
      : {}
    const enablement: Record<string, boolean> = { ...(overlay ?? {}) }
    for (const [id, enabled] of Object.entries(jsonOverrides)) {
      if (typeof enabled === 'boolean' && !HOST_LOCKED_PLUGIN_IDS.has(id)) enablement[id] = enabled
    }
    if (Object.keys(enablement).length) patchText = applyEnablementToPatch(patchText, enablement)
    manifest.dependencies = dependencies
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(profileDir, 'cordis.patch.yml'), patchText, 'utf8')
    if (state?.schema === 1) {
      await backupOnce(statePath)
      await writeFile(statePath, `${JSON.stringify({
        schema: 1,
        overrides: {},
        presets: state.presets && typeof state.presets === 'object' && !Array.isArray(state.presets) ? state.presets : {},
        installed: [],
      }, null, 2)}\n`)
    }
    if (homePatchText !== undefined && parseManagedOverridePatch(homePatchText)) {
      await backupOnce(homePatchPath)
      await writeFile(homePatchPath, '[]\n')
    }
  } catch (error) {
    await restoreHomePluginFiles(snapshots)
    throw error
  }
}

export function selectedPresetOwners(bundles: readonly string[], bundledNames: readonly string[]): Set<string> {
  return new Set(bundles.filter((name) => (
    PACKAGE_NAME.test(name) && !name.includes('..')
    && !bundledNames.includes(name)
    && !isRequiredCoreBundle(name)
    && !isRetiredPackage(name)
  )))
}

/** Fatal recovery: drop user-selected bundles. Files and author data stay on disk. */
export async function disableUserBundles(home: string): Promise<number> {
  const profileDir = join(home, 'profiles', PROFILE_NAME)
  const manifest = await readJsonFile<ProfileManifest>(join(profileDir, 'package.json'))
  if (!manifest) return 0
  const previous = asNameList(manifest.dsh?.profile?.bundles)
  const bundles = previous.filter((name) => isRequiredCoreBundle(name))
  if (bundles.length === previous.length) return 0
  await backupOnce(join(profileDir, 'package.json'), '.before-fatal-recovery')
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return previous.length - bundles.length
}
