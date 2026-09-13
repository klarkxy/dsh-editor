import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishedArtifact, verifyPublishedArchive } from './published.ts'
import { stageGitHubPlugin, installGitHubPlugin, defaultNpmInstall, resolveNpmCli, downloadTarball } from './install.ts'
import { resolvePluginPaths } from './paths.ts'
import { parseGitHubSpec } from './github.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const spec = parseGitHubSpec('acme/demo')!
const manifest = { name: 'demo-plugin', version: '1.0.0', repository: 'https://github.com/acme/demo', main: 'lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }
const data = Buffer.alloc(128, 42)
const integrity = 'sha512-' + createHash('sha512').update(data).digest('base64')
const metadata = { ...manifest, dist: { tarball: 'https://registry.npmjs.org/demo-plugin/-/demo-plugin-1.0.0.tgz', integrity } }
async function root() { const dir = await mkdtemp(join(tmpdir(), 'dsh-published-')); roots.push(dir); return dir }
async function packageFiles(dir: string, built = false) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: demo-plugin\n      name: demo-plugin\n')
  if (built) { await mkdir(join(dir, 'lib'), { recursive: true }); await writeFile(join(dir, 'lib/index.js'), 'export const name = "demo"') }
}

describe('published build fallback', () => {
  it('uses the exact repository version and verifies bytes before extraction', async () => {
    const dir = await root()
    const ioFetch = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/1.0.0') ? Response.json(metadata) : new Response(data)) as unknown as typeof fetch
    const extract = vi.fn(async (_archive: string, destination: string) => packageFiles(destination, destination.endsWith('published')))
    const staged = await stageGitHubPlugin(spec, resolvePluginPaths({ DSH_HOME: dir }, []), new AbortController().signal, { fetch: ioFetch, extract })
    expect(staged.sourceNote).toContain('demo-plugin@1.0.0')
    expect(extract).toHaveBeenCalledTimes(2)
    expect(await readFile(join(staged.unpacked, 'lib/index.js'), 'utf8')).toContain('export')
    await expect(verifyPublishedArchive(join(staged.staging, 'published.tgz'), 'sha512-wrong')).rejects.toThrow(/完整性/)
  })
  it('does not substitute a different repository, version, untrusted URL, or explicit commit', async () => {
    const dir = await root(); await packageFiles(dir)
    for (const replacement of [{ repository: 'https://github.com/other/demo' }, { version: '2.0.0' }, { dist: { ...metadata.dist, tarball: 'https://evil.test/plugin.tgz' } }]) {
      const ioFetch = vi.fn(async () => Response.json({ ...metadata, ...replacement })) as unknown as typeof fetch
      expect(await publishedArtifact(dir, spec, new AbortController().signal, ioFetch)).toBeUndefined()
    }
    const fetcher = vi.fn()
    expect(await publishedArtifact(dir, { ...spec, ref: 'abcdef123' }, new AbortController().signal, fetcher)).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('retries a closed download connection once, but not an HTTP rejection', async () => {
    const dir = await root(), archive = join(dir, 'download.tgz')
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } })).mockResolvedValueOnce(new Response(data))
    await downloadTarball(metadata.dist.tarball, archive, new AbortController().signal, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await readFile(archive)).toEqual(data)
    const rejected = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    await expect(downloadTarball(metadata.dist.tarball, archive, new AbortController().signal, rejected)).rejects.toThrow(/403/)
    expect(rejected).toHaveBeenCalledOnce()
  })
  it('retains the existing plugin when dependency installation fails', async () => {
    const dir = await root(), paths = resolvePluginPaths({ DSH_HOME: dir }, [])
    const installed = join(paths.userPluginsDir, manifest.name)
    await packageFiles(installed, true)
    await writeFile(join(installed, 'marker'), 'existing')
    await expect(installGitHubPlugin(spec, paths, new AbortController().signal, {
      fetch: (async () => new Response(data)) as typeof fetch,
      extract: async (_archive, destination) => packageFiles(destination, true),
      npmInstall: async () => { throw new Error('dependency failed') }, link: vi.fn(),
    })).rejects.toThrow('dependency failed')
    expect(await readFile(join(installed, 'marker'), 'utf8')).toBe('existing')
  })
  it('starts npm through Node in a path with spaces without running lifecycle scripts', async () => {
    expect(resolveNpmCli(process.execPath)).toMatch(/npm-cli\.js$/)
    const dir = join(await root(), 'plugin with spaces'); await mkdir(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'npm-launch-fixture', version: '1.0.0', devDependencies: { 'nonexistent-dsh-development-fixture': '99.99.99' }, scripts: { preinstall: 'exit 42' } }))
    await defaultNpmInstall(dir, AbortSignal.timeout(15000))
    expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).name).toBe('npm-launch-fixture')
  })
})
