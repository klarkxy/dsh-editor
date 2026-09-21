import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { configureWebSearchPresets } from './configure-web-search.mjs'
const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('adds a single tool bridge only to application presets when enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-presets-')); roots.push(root)
  for (const name of ['dsh-editor-writing', 'custom-user-preset']) {
    await mkdir(join(root, 'agent-presets', name), { recursive: true })
    await writeFile(join(root, 'agent-presets', name, 'agent.cordis.yml'), '# existing persona and tools\n')
  }
  await configureWebSearchPresets(root, { shellFeatures: {} })
  const path = join(root, 'agent-presets/dsh-editor-writing/agent.cordis.yml')
  expect(await readFile(path, 'utf8')).not.toContain('web-search-manager')
  await configureWebSearchPresets(root, { shellFeatures: { 'web-search': 'webSearchManager' } })
  await configureWebSearchPresets(root, { shellFeatures: { 'web-search': 'webSearchManager' } })
  expect((await readFile(path, 'utf8')).match(/name: "@klarkxy\/dsh-web-search-manager\/tools"/g)).toHaveLength(1)
  expect(await readFile(join(root, 'agent-presets/custom-user-preset/agent.cordis.yml'), 'utf8')).not.toContain('web-search-manager')
})
it('does not require a preset directory when the capability is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-no-presets-')); roots.push(root)
  await expect(configureWebSearchPresets(root, { shellFeatures: {} })).resolves.toBeUndefined()
})
