import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { migratePiAiCacheRetention } from '../src/settings-migration.js'

async function profile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-ai-migration-'))
  return dir
}

async function providersOf(dir: string): Promise<Record<string, Record<string, unknown>>> {
  const rows = parse(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')) as Array<{ id?: string; config?: { providers?: Record<string, Record<string, unknown>> } }>
  return rows.find((row) => row.id === 'llm-pi-ai')?.config?.providers ?? {}
}

const PATCH = `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openai:
        api: openai-chat
        baseURL: https://api.example.com
        models: []
      explicit:
        api: openai-chat
        cacheRetention: short
        models: []
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
`

describe('pi-ai cacheRetention migration', () => {
  it('backfills long on providers without cacheRetention and keeps explicit values', async () => {
    const dir = await profile()
    await writeFile(join(dir, 'cordis.patch.yml'), PATCH)
    await migratePiAiCacheRetention(dir)
    const providers = await providersOf(dir)
    expect(providers.openai?.cacheRetention).toBe('long')
    expect(providers.explicit?.cacheRetention).toBe('short')
    await rm(dir, { recursive: true })
  })

  it('leaves deepseek config untouched and is idempotent', async () => {
    const dir = await profile()
    await writeFile(join(dir, 'cordis.patch.yml'), PATCH)
    await migratePiAiCacheRetention(dir)
    const after = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    const rows = parse(after) as Array<{ id?: string; config?: { apiKeyEnv?: string } }>
    expect(rows.find((row) => row.id === 'llm-deepseek')?.config?.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
    expect(after).not.toContain('llm-deepseek:\n        cacheRetention')
    await migratePiAiCacheRetention(dir)
    expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toBe(after)
    await rm(dir, { recursive: true })
  })

  it('handles a patch without the llm-pi-ai row', async () => {
    const dir = await profile()
    await writeFile(join(dir, 'cordis.patch.yml'), '- id: other\n  name: x\n')
    await expect(migratePiAiCacheRetention(dir)).resolves.toBeUndefined()
    await rm(dir, { recursive: true })
  })
})
