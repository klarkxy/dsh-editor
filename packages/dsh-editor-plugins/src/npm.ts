import type { MarketplaceListing, NpmArtifact } from './contracts.ts'

export type NpmSpec = { name: string; version?: string; spec: string }

const PACKAGE_NAME = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/

export function isExactNpmVersion(version: string): boolean {
  if (version.length > 80) return false
  const match = EXACT_VERSION.exec(version)
  return !!match && (!match[4] || match[4].split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')))
}

/** Bare scoped names are unambiguous; bare unscoped text remains a search query. */
export function parseNpmSpec(input: string): NpmSpec | undefined {
  const raw = input.trim()
  if (!raw || raw.length > 200) return undefined
  const explicit = raw.startsWith('npm:')
  if (!explicit && !raw.startsWith('@')) return undefined
  const value = explicit ? raw.slice(4) : raw
  const versionAt = value.indexOf('@', value.startsWith('@') ? 1 : 0)
  const name = versionAt < 0 ? value : value.slice(0, versionAt)
  const version = versionAt < 0 ? undefined : value.slice(versionAt + 1)
  if (!PACKAGE_NAME.test(name) || name.length > 120 || name.includes('..') || ['node_modules', 'favicon.ico'].includes(name)) return undefined
  if (version !== undefined && !isExactNpmVersion(version)) return undefined
  return { name, version, spec: `npm:${name}${version ? '@' + version : ''}` }
}

export function isSha512Integrity(value: unknown): value is string {
  return typeof value === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value)
}

export function registryTarballUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.port || url.search || url.hash) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export async function resolveNpmArtifact(spec: NpmSpec, signal: AbortSignal, ioFetch: typeof fetch): Promise<NpmArtifact & { name: string; version: string; url: string }> {
  const response = await ioFetch(`https://registry.npmjs.org/${encodeURIComponent(spec.name)}/${encodeURIComponent(spec.version ?? 'latest')}`, { signal, redirect: 'error' })
  if (!response.ok) throw new Error(response.status === 404 ? '未找到该 npm 包或版本' : `获取 npm 发布包失败（HTTP ${response.status}）`)
  const metadata = await response.json() as { name?: unknown; version?: unknown; dist?: { tarball?: unknown; integrity?: unknown } } | null
  if (!metadata || metadata.name !== spec.name || typeof metadata.version !== 'string' || !isExactNpmVersion(metadata.version) || !parseNpmSpec(`npm:${spec.name}@${metadata.version}`) || (spec.version && metadata.version !== spec.version)) {
    throw new Error('npm 发布包元数据与请求的包名或版本不匹配')
  }
  const url = registryTarballUrl(metadata.dist?.tarball)
  if (!url || !isSha512Integrity(metadata.dist?.integrity)) throw new Error('npm 发布包缺少可信的官方压缩包地址或 SHA-512 摘要')
  return { name: spec.name, version: metadata.version, spec: `npm:${spec.name}@${metadata.version}`, url, integrity: metadata.dist.integrity }
}

export function npmMarketplaceListing(spec: NpmSpec): MarketplaceListing {
  const slash = spec.name.indexOf('/')
  return {
    spec: spec.spec,
    source: 'npm',
    owner: slash < 0 ? 'npm' : spec.name.slice(0, slash),
    repo: slash < 0 ? spec.name : spec.name.slice(slash + 1),
    description: spec.version ? `从 npm 安装 ${spec.version}` : '从 npm 检查并安装最新发布版本',
    stars: 0,
    url: `https://www.npmjs.com/package/${spec.name}`,
    updatedAt: '',
    topics: [],
  }
}
