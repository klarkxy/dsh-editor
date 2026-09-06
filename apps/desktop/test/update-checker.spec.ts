import { describe, expect, it, vi } from 'vitest'
import {
  buildDownloadCandidates,
  checkLatest,
  compareVersions,
  parseSha256Sums,
  selectAsset,
} from '../src/update-checker.js'

interface CapturedCall {
  url: string
  headers: Record<string, string>
  signal: AbortSignal | undefined
}

function makeFetch(impl: (call: CapturedCall) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }) {
  return vi.fn(async (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const call: CapturedCall = { url: input, headers: init?.headers ?? {}, signal: init?.signal }
    const result = await impl(call)
    return {
      status: result.status,
      json: async () => result.body,
    }
  })
}

const RELEASES_URL = 'https://api.github.com/repos/klarkxy/dsh-editor/releases/latest'

describe('compareVersions', () => {
  it('treats matching segments as equal, ignoring the leading v', () => {
    expect(compareVersions('v0.1.1', '0.1.1')).toBe(0)
    expect(compareVersions('0.1.1', 'v0.1.1')).toBe(0)
  })
  it('compares segment-by-segment with numeric ordering (not lexical)', () => {
    expect(Math.sign(compareVersions('v0.1.10', '0.1.9'))).toBe(1)
    expect(Math.sign(compareVersions('0.1.9', 'v0.1.10'))).toBe(-1)
  })
  it('treats a major bump as larger than any 0.x version', () => {
    expect(Math.sign(compareVersions('v1.0.0', '0.9.9'))).toBe(1)
    expect(Math.sign(compareVersions('0.9.9', 'v1.0.0'))).toBe(-1)
  })
})

describe('checkLatest', () => {
  it('returns update-available with mapped fields when the tag is newer', async () => {
    const fetchImpl = makeFetch(async () => ({
      status: 200,
      body: {
        tag_name: 'v0.2.0',
        name: '0.2.0 — new release',
        published_at: '2025-04-01T12:00:00Z',
        html_url: 'https://github.com/klarkxy/dsh-editor/releases/tag/v0.2.0',
        body: '## Highlights\n- feature A\n- feature B',
        assets: [
          {
            name: 'DSH-Editor-Setup-0.2.0-win-x64.exe',
            browser_download_url: 'https://github.com/klarkxy/dsh-editor/releases/download/v0.2.0/DSH-Editor-Setup-0.2.0-win-x64.exe',
            size: 153447778,
          },
          { name: 'missing-url', size: 1 },
          'not-a-record',
        ],
      },
    }))
    const result = await checkLatest('0.1.1', fetchImpl)
    expect(result).toEqual({
      status: 'update-available',
      currentVersion: '0.1.1',
      latest: {
        version: '0.2.0',
        tag: 'v0.2.0',
        name: '0.2.0 — new release',
        publishedAt: '2025-04-01T12:00:00Z',
        url: 'https://github.com/klarkxy/dsh-editor/releases/tag/v0.2.0',
        body: '## Highlights\n- feature A\n- feature B',
        assets: [{
          name: 'DSH-Editor-Setup-0.2.0-win-x64.exe',
          url: 'https://github.com/klarkxy/dsh-editor/releases/download/v0.2.0/DSH-Editor-Setup-0.2.0-win-x64.exe',
          size: 153447778,
        }],
        asset: null,
      },
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const call = fetchImpl.mock.calls[0]!
    expect(call[0]).toBe(RELEASES_URL)
    expect(call[1]?.headers).toEqual({ 'User-Agent': 'dsh-editor', Accept: 'application/vnd.github+json' })
    expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns latest with mapped fields when the tag matches the current version', async () => {
    const fetchImpl = makeFetch(async () => ({
      status: 200,
      body: {
        tag_name: 'v0.1.1',
        name: '0.1.1',
        published_at: '2025-03-15T08:30:00Z',
        html_url: 'https://github.com/klarkxy/dsh-editor/releases/tag/v0.1.1',
        body: 'Patch release.',
      },
    }))
    const result = await checkLatest('0.1.1', fetchImpl)
    expect(result.status).toBe('latest')
    expect(result.currentVersion).toBe('0.1.1')
    expect(result.latest?.version).toBe('0.1.1')
    expect(result.latest?.tag).toBe('v0.1.1')
    expect(result.latest?.url).toBe('https://github.com/klarkxy/dsh-editor/releases/tag/v0.1.1')
  })

  it('treats 404 (no release yet) as up-to-date with no latest payload', async () => {
    const fetchImpl = makeFetch(async () => ({ status: 404, body: { message: 'Not Found' } }))
    const result = await checkLatest('0.1.1', fetchImpl)
    expect(result).toEqual({ status: 'latest', currentVersion: '0.1.1' })
  })

  it('returns error for any other non-200 status', async () => {
    for (const status of [403, 500, 502, 503]) {
      const fetchImpl = makeFetch(async () => ({ status, body: { message: 'rate limit' } }))
      const result = await checkLatest('0.1.1', fetchImpl)
      expect(result.status).toBe('error')
      expect(result.currentVersion).toBe('0.1.1')
      expect(result.error).toBe(`GitHub returned HTTP ${status}`)
    }
  })

  it('returns error when fetch throws a network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ENOTFOUND api.github.com') })
    const result = await checkLatest('0.1.1', fetchImpl)
    expect(result).toEqual({ status: 'error', currentVersion: '0.1.1', error: 'ENOTFOUND api.github.com' })
  })

  it('returns error when the request is aborted by the timeout signal', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(async (_input: string, init?: { signal?: AbortSignal }) => {
        return await new Promise((_, reject) => {
          const signal = init?.signal
          if (!signal) {
            reject(new Error('expected abort signal'))
            return
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
      })
      const promise = checkLatest('0.1.1', fetchImpl)
      await vi.advanceTimersByTimeAsync(11_000)
      const result = await promise
      expect(result.status).toBe('error')
      expect(result.error).toMatch(/abort/i)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('selectAsset', () => {
  const assets = [
    { name: 'DSH-Editor-Setup-0.2.0-win-x64.exe', url: 'u-setup', size: 1 },
    { name: 'DSH-Editor-0.2.0-win-x64.zip', url: 'u-portable', size: 2 },
    { name: 'DSH-Editor-0.2.0-mac-arm64.dmg', url: 'u-dmg', size: 3 },
    { name: 'DSH-Editor-0.2.0-mac-arm64.zip', url: 'u-maczip', size: 4 },
    { name: 'sha256sums.txt', url: 'u-sums', size: 5 },
  ]
  it('picks the NSIS setup exe for installed Windows', () => {
    expect(selectAsset(assets, 'win32', false)?.url).toBe('u-setup')
  })
  it('picks the portable zip (not the setup exe) for portable Windows', () => {
    expect(selectAsset(assets, 'win32', true)?.url).toBe('u-portable')
  })
  it('picks the dmg for macOS', () => {
    expect(selectAsset(assets, 'darwin', false)?.url).toBe('u-dmg')
  })
  it('returns null when nothing matches', () => {
    expect(selectAsset(assets, 'linux', false)).toBeNull()
    expect(selectAsset([], 'win32', false)).toBeNull()
    expect(selectAsset([{ name: 'DSH-Editor-0.2.0-win-x64.zip', url: 'u', size: 1 }], 'win32', false)).toBeNull()
  })
})

describe('buildDownloadCandidates', () => {
  const url = 'https://github.com/klarkxy/dsh-editor/releases/download/v0.2.0/DSH-Editor-Setup-0.2.0-win-x64.exe'
  it('puts builtin mirrors first and the direct URL last', () => {
    const candidates = buildDownloadCandidates(url)
    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates.at(-1)).toEqual({ label: 'github.com(直连)', url })
    for (const candidate of candidates.slice(0, -1)) {
      expect(candidate.url.endsWith(url)).toBe(true)
      expect(candidate.url).not.toBe(url)
    }
  })
  it('prepends env-provided mirrors ahead of the builtin ones', () => {
    const candidates = buildDownloadCandidates(url, 'https://my-mirror.example/, , https://second.example')
    expect(candidates[0]).toEqual({ label: 'my-mirror.example', url: `https://my-mirror.example/${url}` })
    expect(candidates[1]).toEqual({ label: 'second.example', url: `https://second.example/${url}` })
    expect(candidates.at(-1)?.url).toBe(url)
  })
  it('does not wrap non-github URLs', () => {
    expect(buildDownloadCandidates('https://example.com/file.zip')).toEqual([
      { label: '直连', url: 'https://example.com/file.zip' },
    ])
  })
})

describe('parseSha256Sums', () => {
  it('parses hash + filename lines, tolerating binary markers and blank lines', () => {
    const text = [
      'a'.repeat(64) + '  DSH-Editor-Setup-0.2.0-win-x64.exe',
      'B'.repeat(64) + ' *DSH-Editor-0.2.0-win-x64.zip',
      '',
      'not-a-sum line',
    ].join('\n')
    const sums = parseSha256Sums(text)
    expect(sums.get('DSH-Editor-Setup-0.2.0-win-x64.exe')).toBe('a'.repeat(64))
    expect(sums.get('DSH-Editor-0.2.0-win-x64.zip')).toBe('b'.repeat(64))
    expect(sums.size).toBe(2)
  })
  it('returns an empty map for unrelated content', () => {
    expect(parseSha256Sums('<html>404</html>').size).toBe(0)
  })
})
