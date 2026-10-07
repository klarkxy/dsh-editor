import type { MarketplaceListing } from './contracts.ts'

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
