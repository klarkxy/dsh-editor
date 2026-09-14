import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isSafePackageName } from './core.ts'
import { parseGitHubSpec, type GitHubSpec } from './github.ts'

type PublishedManifest = { name?: string; version?: string; repository?: string | { url?: string }; dist?: { tarball?: string; integrity?: string } }

export function matchesRepository(manifest: PublishedManifest, spec: GitHubSpec): boolean {
  const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  const parsed = typeof repo === 'string' ? parseGitHubSpec(repo.replace(/^git\+/, '')) : undefined
  return !!parsed && parsed.owner.toLowerCase() === spec.owner.toLowerCase() && parsed.repo.toLowerCase() === spec.repo.toLowerCase()
}

export async function publishedArtifact(directory: string, spec: GitHubSpec, signal: AbortSignal, ioFetch: typeof fetch): Promise<{ name: string; version: string; url: string; integrity: string } | undefined> {
  const source = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PublishedManifest
  if (!source.name || !isSafePackageName(source.name) || !source.version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(source.version)) return
  // A branch or commit request must not silently become an npm release.
  if (spec.ref && spec.ref !== source.version && spec.ref !== 'v' + source.version) return
  const response = await ioFetch('https://registry.npmjs.org/' + encodeURIComponent(source.name) + '/' + encodeURIComponent(source.version), { signal, redirect: 'error' })
  if (response.status === 404) return
  if (!response.ok) throw new Error('获取 npm 已编译发布包失败（HTTP ' + response.status + '）。')
  const published = await response.json() as PublishedManifest
  if (published.name !== source.name || published.version !== source.version || !matchesRepository(published, spec)) return
  if (!published.dist?.tarball || !published.dist.integrity || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(published.dist.integrity)) return
  const url = new URL(published.dist.tarball)
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.port) return
  return { name: source.name, version: source.version, url: url.toString(), integrity: published.dist.integrity }
}

export async function verifyPublishedArchive(path: string, integrity: string): Promise<void> {
  const actual = 'sha512-' + createHash('sha512').update(await readFile(path)).digest('base64')
  if (actual !== integrity) throw new Error('npm 发布包完整性校验失败，请重试。')
}
