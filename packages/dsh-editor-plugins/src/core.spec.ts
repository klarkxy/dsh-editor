import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RUNTIME_CATALOG_FILE, isSafeEntryId, isSafePackageName, readPreparedCatalog } from './core.ts'

describe('discovery prepared catalog', () => {
  it('validates identifiers used by local artifacts and preset declarations', () => {
    expect(isSafeEntryId('editor-shell')).toBe(true)
    expect(isSafeEntryId('../escape')).toBe(false)
    expect(isSafeEntryId('a'.repeat(81))).toBe(false)
    expect(isSafePackageName('@deepseek-ai/unknown-extra')).toBe(true)
    expect(isSafePackageName('../escape')).toBe(false)
    expect(isSafePackageName('@scope/pkg/tools')).toBe(false)
  })

  it('reads distribution metadata without scanning or trusting installed claims', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
    await writeFile(join(profile, RUNTIME_CATALOG_FILE), JSON.stringify({
      bundles: ['dsh-editor-shell', 4],
      entries: {
        zhihu: { title: '知乎资料', description: 'prepared', locked: false, packageName: '@klarkxy/dsh-zhihu', feature: 'zhihu' },
        core: { title: 'Core', description: 'prepared', locked: true, packageName: 'dsh-editor-shell', builtin: true, managedBy: 'session' },
        loose: { title: 'Loose', description: 'prepared', locked: 'yes', packageName: 'other', builtin: 'yes', managedBy: 'author' },
        bad: { title: 'bad', packageName: 'other' },
      },
    }))
    const catalog = await readPreparedCatalog(profile)
    expect(catalog?.bundles).toEqual(['dsh-editor-shell'])
    expect(catalog?.entries.zhihu).toMatchObject({ title: '知乎资料', feature: 'zhihu' })
    expect(catalog?.entries.core).toMatchObject({ builtin: true, managedBy: 'session' })
    expect(catalog?.entries.loose).toEqual({ title: 'Loose', description: 'prepared', locked: false, packageName: 'other' })
    expect(catalog?.entries).not.toHaveProperty('bad')
  })
})
