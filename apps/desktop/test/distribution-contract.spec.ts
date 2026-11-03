import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORE_PLUGIN_BUNDLE_NAMES, CORE_PLUGIN_ENTRY_IDS, HOST_LOCKED_ENTRY_IDS, REQUIRED_CORE_BUNDLES, RESTORED_PATCH_IDS, RETIRED_PLUGIN_IDS, RETIRED_PLUGIN_PACKAGES } from '../src/distribution-contract.js'
import { isSafeUserPackageName, writeNativeMigrationMarker } from '../src/native-profile.js'
import { sanitizeHostLockedPluginOverrides } from '../src/user-plugins.js'

describe('finite distribution ownership', () => {
  it('keeps restore, native locking, host locking and retirement independent', () => {
    expect(REQUIRED_CORE_BUNDLES.has('@deepseek-ai/dsh-base')).toBe(true)
    expect(CORE_PLUGIN_BUNDLE_NAMES.has('@deepseek-ai/dsh-base')).toBe(false)
    expect(RESTORED_PATCH_IDS.has('ui-layout')).toBe(true)
    expect(CORE_PLUGIN_ENTRY_IDS.has('ui-layout')).toBe(false)
    expect(CORE_PLUGIN_ENTRY_IDS.has('editor-shell')).toBe(true)
    expect(HOST_LOCKED_ENTRY_IDS.has('editor-shell')).toBe(false)
    expect(HOST_LOCKED_ENTRY_IDS.has('editor-workbench-tools')).toBe(true)
    expect(RETIRED_PLUGIN_PACKAGES.has('dsh-web-search-tavily')).toBe(true)
    expect(REQUIRED_CORE_BUNDLES.has('dsh-web-search-tavily')).toBe(false)
    expect(RETIRED_PLUGIN_PACKAGES.has('dsh-proofread')).toBe(true)
    expect(RETIRED_PLUGIN_PACKAGES.has('dsh-editor-proofread-panel')).toBe(true)
    expect(RETIRED_PLUGIN_IDS.has('proofread')).toBe(true)
    expect(RETIRED_PLUGIN_IDS.has('editor-proofread-panel')).toBe(true)
    expect(REQUIRED_CORE_BUNDLES.has('dsh-proofread')).toBe(false)
    expect(REQUIRED_CORE_BUNDLES.has('dsh-editor-proofread-panel')).toBe(false)
  })

  it('allows unknown packages in familiar namespaces but protects finite core and retirement', () => {
    expect(isSafeUserPackageName('@deepseek-ai/author-extra', [])).toBe(true)
    expect(isSafeUserPackageName('dsh-editor-author-extra', [])).toBe(true)
    expect(isSafeUserPackageName('@deepseek-ai/dsh-base', [])).toBe(false)
    expect(isSafeUserPackageName('dsh-editor-shell', [])).toBe(false)
    expect(isSafeUserPackageName('@klarkxy/dsh-memory', [])).toBe(false)
    expect(isSafeUserPackageName('../escape', [])).toBe(false)
  })

  it('keeps stale JSON host guards after migration without writing the old home overlay again', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-migrated-overlay-'))
    await writeNativeMigrationMarker(home)
    const patch = '\uFEFF# managed-by: dsh-editor-plugins\r\n- id: editor-workbench-tools\r\n  disabled: false\r\n'
    await writeFile(join(home, 'cordis.patch.yml'), patch)
    await writeFile(join(home, 'dsh-plugins.json'), JSON.stringify({ schema: 1, overrides: { 'editor-workbench-tools': true, 'author-extra': false }, presets: { 'dsh-editor-novel': false }, installed: [] }))
    await sanitizeHostLockedPluginOverrides(home)
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toMatchObject({ overrides: { 'author-extra': false }, presets: { 'dsh-editor-novel': false } })
  })
})
