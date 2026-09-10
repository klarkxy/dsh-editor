import { MARKETPLACE_PAGE_SIZE, MARKETPLACE_QUERY_MAX, MARKETPLACE_TOPIC, type MarketplaceListing } from './contracts.ts'

export type GitHubSpec = { owner: string; repo: string; ref?: string; spec: string }

const OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const SEARCH_TOKEN = /^[\p{L}\p{N}._\-\s]+$/u

export function sanitizeMarketplaceQuery(query: string): string | undefined {
  const trimmed = query.trim().slice(0, MARKETPLACE_QUERY_MAX)
  if (!trimmed) return ''
  if (!SEARCH_TOKEN.test(trimmed)) return undefined
  return trimmed
}

export function parseGitHubSpec(input: string): GitHubSpec | undefined {
  const raw = input.trim()
  if (!raw || raw.length > 200) return undefined
  let ownerRepo = raw
  let ref: string | undefined
  const githubPrefix = raw.match(/^github:([^#]+)(?:#(.+))?$/i)
  if (githubPrefix) {
    ownerRepo = githubPrefix[1]
    ref = githubPrefix[2] || undefined
  } else {
    const url = raw.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/tree\/([^/?#]+))?\/?$/i)
    if (url) {
      ownerRepo = url[1]
      ref = url[2] || undefined
    }
  }
  ownerRepo = ownerRepo.replace(/\.git$/i, '')
  if (!OWNER_REPO.test(ownerRepo)) return undefined
  const [owner, repo] = ownerRepo.split('/')
  if (!owner || !repo || owner === '.' || repo === '.' || owner === '..' || repo === '..') return undefined
  const spec = ref ? `github:${owner}/${repo}#${ref}` : `github:${owner}/${repo}`
  return { owner, repo, ref, spec }
}

export function marketplaceSearchUrl(query: string): string {
  const sanitized = sanitizeMarketplaceQuery(query) ?? ''
  const q = sanitized ? `${sanitized} topic:${MARKETPLACE_TOPIC}` : `topic:${MARKETPLACE_TOPIC}`
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${MARKETPLACE_PAGE_SIZE}`
}

export function githubTarballUrl(spec: GitHubSpec): string {
  const ref = spec.ref ? encodeURIComponent(spec.ref) : ''
  return ref
    ? `https://api.github.com/repos/${spec.owner}/${spec.repo}/tarball/${ref}`
    : `https://api.github.com/repos/${spec.owner}/${spec.repo}/tarball`
}

export function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-editor',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export function parseMarketplaceSearch(payload: unknown): MarketplaceListing[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const items = (payload as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const listings: MarketplaceListing[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const fullName = typeof row.full_name === 'string' ? row.full_name : ''
    const parsed = parseGitHubSpec(fullName)
    if (!parsed) continue
    const topics = Array.isArray(row.topics) ? row.topics.filter((topic): topic is string => typeof topic === 'string').slice(0, 12) : []
    listings.push({
      spec: parsed.spec,
      owner: parsed.owner,
      repo: parsed.repo,
      description: typeof row.description === 'string' ? row.description.slice(0, 400) : '',
      stars: typeof row.stargazers_count === 'number' && Number.isFinite(row.stargazers_count) ? Math.max(0, Math.floor(row.stargazers_count)) : 0,
      url: typeof row.html_url === 'string' && /^https:\/\/github\.com\//.test(row.html_url) ? row.html_url : `https://github.com/${parsed.owner}/${parsed.repo}`,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
      topics,
    })
  }
  return listings
}

export function tarEntryIsSafe(entry: string): boolean {
  const normalized = entry.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  const parts = normalized.split('/')
  return parts.every((part) => part !== '..' && part !== '.')
}
