import { describe, expect, it } from 'vitest'
import {
  marketplaceSearchUrl, parseGitHubSpec, parseMarketplaceSearch, sanitizeMarketplaceQuery,
} from './github.ts'

describe('GitHub marketplace specs', () => {
  it('accepts owner/repo, github: and https GitHub URLs', () => {
    expect(parseGitHubSpec('acme/dsh-theme')).toEqual({ owner: 'acme', repo: 'dsh-theme', ref: undefined, spec: 'github:acme/dsh-theme' })
    expect(parseGitHubSpec('github:acme/dsh-theme#v1.2.0')?.ref).toBe('v1.2.0')
    expect(parseGitHubSpec('https://github.com/acme/dsh-theme.git')?.spec).toBe('github:acme/dsh-theme')
    expect(parseGitHubSpec('https://example.com/acme/dsh-theme')).toBeUndefined()
    expect(parseGitHubSpec('../etc/passwd')).toBeUndefined()
    expect(parseGitHubSpec('')).toBeUndefined()
  })

  it('builds a topic search and parses GitHub search payloads', () => {
    expect(sanitizeMarketplaceQuery('校对 主题')).toBe('校对 主题')
    expect(sanitizeMarketplaceQuery('foo;curl')).toBeUndefined()
    expect(marketplaceSearchUrl('')).toContain('topic%3Adsh-plugin')
    expect(marketplaceSearchUrl('theme')).toContain('theme%20topic%3Adsh-plugin')
    expect(parseMarketplaceSearch({
      items: [
        { full_name: 'acme/dsh-theme', description: '纸', stargazers_count: 12, html_url: 'https://github.com/acme/dsh-theme', updated_at: '2026-01-01T00:00:00Z', topics: ['dsh-plugin'] },
        { full_name: 'not a repo' },
      ],
    })).toEqual([expect.objectContaining({ spec: 'github:acme/dsh-theme', stars: 12, owner: 'acme', repo: 'dsh-theme' })])
  })

})
