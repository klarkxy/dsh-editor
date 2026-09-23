import { syncPresetDeclarations } from './preset-config.ts'
import { randomUUID } from 'node:crypto'
import { publishedArtifact, verifyPublishedArchive, matchesRepository } from './published.ts'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { INSTALL_TARBALL_MAX_BYTES } from './contracts.ts'
import { isProtectedPackage, isSafePackageName, type RuntimeCatalog } from './core.ts'
import { githubHeaders, githubTarballUrl, tarEntryIsSafe, type GitHubSpec } from './github.ts'
import { blockedReason, inspectPluginPackage, type PluginInspectReport } from './inspect.ts'
import { deployPluginPresets, removePluginPresets } from './presets.ts'
import type { PluginPaths } from './paths.ts'

export type InstalledBundle = { name: string; version: string; spec: string; inspect: PluginInspectReport }

export type InstallIo = {
  fetch: typeof fetch
  extract: (archive: string, destination: string, signal: AbortSignal) => Promise<void>
  npmInstall: (directory: string, signal: AbortSignal) => Promise<void>
  link: (source: string, destination: string) => Promise<void>
}

function fail(message: string): never {
  throw new Error(message)
}

export async function inspectBundleManifest(directory: string, catalog?: RuntimeCatalog): Promise<{ name: string; version: string; inspect: PluginInspectReport }> {
  const inspect = await inspectPluginPackage(directory, catalog)
  if (inspect.verdict === 'blocked' || !inspect.name) fail(blockedReason(inspect))
  return { name: inspect.name, version: inspect.version ?? '', inspect }
}

export async function stageGitHubPlugin(
  spec: GitHubSpec,
  paths: PluginPaths,
  signal: AbortSignal,
  io: Pick<InstallIo, 'fetch' | 'extract'>,
): Promise<{ staging: string; unpacked: string; sourceNote?: string }> {
  const staging = join(paths.home, 'user-plugins', `.staging-${process.pid}-${randomUUID()}`)
  const archive = join(staging, 'plugin.tgz')
  const unpacked = join(staging, 'unpacked')
  await mkdir(unpacked, { recursive: true })
  try {
    await downloadTarball(githubTarballUrl(spec), archive, signal, io.fetch)
    await io.extract(archive, unpacked, signal)
    const initial = await inspectPluginPackage(unpacked)
    const missingBuild = initial.findings.some((item) => item.code === 'entry-file' || item.code === 'client-file')
    if (missingBuild) {
      const artifact = await publishedArtifact(unpacked, spec, signal, io.fetch)
      if (artifact) {
        const publishedArchive = join(staging, 'published.tgz')
        const publishedDir = join(staging, 'published')
        await downloadTarball(artifact.url, publishedArchive, signal, io.fetch)
        await verifyPublishedArchive(publishedArchive, artifact.integrity)
        await io.extract(publishedArchive, publishedDir, signal)
        const manifest = JSON.parse(await readFile(join(publishedDir, 'package.json'), 'utf8'))
        if (manifest.name !== artifact.name || manifest.version !== artifact.version || !matchesRepository(manifest, spec)) fail('npm 发布包与仓库身份不匹配')
        return { staging, unpacked: publishedDir, sourceNote: '仓库未包含编译产物，将使用同仓库的 npm 发布包 ' + artifact.name + '@' + artifact.version + '（已校验完整性）' }
      }
    }
    return { staging, unpacked }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function downloadTarball(url: string, destination: string, signal: AbortSignal, ioFetch: typeof fetch = fetch): Promise<void> {
  try {
    await downloadTarballOnce(url, destination, signal, ioFetch)
  } catch (error) {
    signal.throwIfAborted()
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code
    if (code !== 'UND_ERR_SOCKET' && code !== 'ECONNRESET') throw error
    // Retry this read-only download once when a reused connection was closed.
    await rm(destination, { force: true })
    await downloadTarballOnce(url, destination, signal, ioFetch)
  }
}

async function downloadTarballOnce(url: string, destination: string, signal: AbortSignal, ioFetch: typeof fetch): Promise<void> {
  const headers = new URL(url).hostname === 'api.github.com' ? githubHeaders() : { 'User-Agent': 'dsh-editor' }
  const response = await ioFetch(url, { headers, redirect: 'follow', signal })
  if (!response.ok) fail(response.status === 404 ? '未找到该 GitHub 仓库' : `下载插件失败（HTTP ${response.status}）`)
  const length = Number(response.headers.get('content-length') || '0')
  if (length > INSTALL_TARBALL_MAX_BYTES) fail('插件压缩包超过 40 MB')
  if (!response.body) fail('下载插件失败')
  await mkdir(dirname(destination), { recursive: true })
  const file = createWriteStream(destination)
  try {
    await pipeline(response.body as unknown as NodeJS.ReadableStream, file)
  } catch (error) {
    file.destroy()
    await rm(destination, { force: true })
    throw error
  }
  const size = (await stat(destination)).size
  if (size > INSTALL_TARBALL_MAX_BYTES) {
    await rm(destination, { force: true })
    fail('插件压缩包超过 40 MB')
  }
  if (size < 64) {
    await rm(destination, { force: true })
    fail('插件压缩包无效')
  }
}

export function listTarEntries(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function assertSafeTarListing(entries: readonly string[]): void {
  if (entries.length === 0) fail('插件压缩包为空')
  if (entries.length > 20_000) fail('插件压缩包文件过多')
  if (entries.some((entry) => !tarEntryIsSafe(entry))) fail('插件压缩包包含不安全路径')
}

function run(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk) => stdout.push(chunk as Buffer))
    child.stderr?.on('data', (chunk) => stderr.push(chunk as Buffer))
    const onAbort = () => { child.kill('SIGTERM') }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    child.once('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.once('exit', (code) => {
      signal.removeEventListener('abort', onAbort)
      const text = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (code === 0) resolve(text)
      else reject(new Error(err.trim() || `${command} 退出码 ${code ?? 'null'}`))
    })
  })
}

export async function defaultExtract(archive: string, destination: string, signal: AbortSignal): Promise<void> {
  const listing = await run('tar', ['-tzf', archive], dirname(archive), signal)
  assertSafeTarListing(listTarEntries(listing))
  await mkdir(destination, { recursive: true })
  await run('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'], destination, signal)
}

export function resolveNpmCli(nodePath: string): string | undefined {
  const dir = dirname(nodePath)
  for (const candidate of [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export async function defaultNpmInstall(directory: string, signal: AbortSignal): Promise<void> {
  const npm = resolveNpmCli(process.execPath)
  if (!npm) fail('当前环境无法安装插件依赖（需要 npm）')
  // npm resolves dev dependencies even with --omit=dev. Published plugins can
  // retain an old development host graph; only their runtime graph is relevant.
  const manifestPath = join(directory, 'package.json')
  const original = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  delete manifest.devDependencies
  await writeFile(manifestPath, JSON.stringify(manifest))
  try {
    await run(process.execPath, [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', '--no-progress', '--package-lock=false'], directory, signal)
  } finally {
    await writeFile(manifestPath, original)
  }
}

export async function defaultLink(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  try {
    await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    const { cp } = await import('node:fs/promises')
    await cp(source, destination, { recursive: true })
  }
}

export async function addBundleToProfile(profileDir: string, packageName: string): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
    dependencies?: Record<string, string>
  }
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  if (!bundles.includes(packageName)) bundles.push(packageName)
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  manifest.dependencies = { ...manifest.dependencies, [packageName]: '*' }
  const stage = `${manifestPath}.${process.pid}.tmp`
  await writeFile(stage, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(stage, manifestPath)
}

export async function removeBundleFromProfile(profileDir: string, packageName: string): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
    dependencies?: Record<string, string>
  }
  const bundles = (manifest.dsh?.profile?.bundles ?? []).filter((name) => name !== packageName)
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  if (manifest.dependencies) {
    const next = { ...manifest.dependencies }
    delete next[packageName]
    manifest.dependencies = next
  }
  const stage = `${manifestPath}.${process.pid}.tmp`
  await writeFile(stage, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(stage, manifestPath)
}

export async function installGitHubPlugin(
  spec: GitHubSpec,
  paths: PluginPaths,
  signal: AbortSignal,
  io: InstallIo = { fetch, extract: defaultExtract, npmInstall: defaultNpmInstall, link: defaultLink },
  catalog?: RuntimeCatalog,
): Promise<InstalledBundle> {
  const staged = await stageGitHubPlugin(spec, paths, signal, io)
  try {
    const manifest = await inspectBundleManifest(staged.unpacked, catalog)
    if (staged.sourceNote) manifest.inspect.findings.push({ code: 'published-artifact', severity: 'info', message: staged.sourceNote })
    await io.npmInstall(staged.unpacked, signal)
    signal.throwIfAborted()
    const destination = join(paths.userPluginsDir, manifest.name)
    await mkdir(paths.userPluginsDir, { recursive: true })
    await rm(destination, { recursive: true, force: true })
    await rename(staged.unpacked, destination)
    await io.link(destination, join(paths.profileDir, 'node_modules', manifest.name))
    await addBundleToProfile(paths.profileDir, manifest.name)
    await deployPluginPresets(paths.home, manifest.name, destination)
    await syncPresetDeclarations(paths.home, paths.profileDir)
    return { name: manifest.name, version: manifest.version, spec: spec.spec, inspect: manifest.inspect }
  } finally {
    await rm(staged.staging, { recursive: true, force: true })
  }
}

export async function uninstallUserPlugin(packageName: string, paths: PluginPaths, catalog: RuntimeCatalog): Promise<void> {
  if (isProtectedPackage(packageName, catalog.bundles) || !isSafePackageName(packageName)) fail('不能卸载系统核心插件')
  await removeBundleFromProfile(paths.profileDir, packageName)
  await rm(join(paths.profileDir, 'node_modules', packageName), { recursive: true, force: true })
  await rm(join(paths.userPluginsDir, packageName), { recursive: true, force: true })
  await removePluginPresets(paths.home, packageName)
  await syncPresetDeclarations(paths.home, paths.profileDir)
}
