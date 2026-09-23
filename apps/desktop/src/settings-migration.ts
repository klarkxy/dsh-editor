import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { isMap, isSeq, parse, parseDocument, type Document } from 'yaml'

/** Import editor sections before the Shell records its one-time AI-purpose migration. */
export async function migrateWritingSettings(home: string, profileDir: string): Promise<void> {
  const marker = join(profileDir, '.editor-writing-migrated')
  try { await readFile(marker); return } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let legacy: Record<string, unknown> = {}
  let source: string | undefined
  let sourceText = ''
  for (const name of ['settings.yaml', 'settings.yaml.imported']) {
    try {
      source = join(home, name)
      sourceText = await readFile(source, 'utf8')
      legacy = parse(sourceText) ?? {}
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Invalid legacy settings document')
      break
    } catch (error) {
      source = undefined
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const file = join(profileDir, 'cordis.patch.yml')
  const document: Document = parseDocument(await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error }))
  if (document.errors.length || !isSeq(document.contents)) throw new Error('Cannot migrate editor settings: invalid profile patch')
  let changed = false
  const owned = ['dsh-editor-writing', 'ui-developer']
  for (const id of owned) {
    const value = legacy[id]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    // Any saved override, including an explicit reset, wins over the old document.
    if (document.contents.items.some(row => isMap(row) && row.get('id') === id)) continue
    document.contents.add(document.createNode({ id, config: value }))
    changed = true
  }
  if (changed) {
    document.contents.flow = false
    const stage = `${file}.${process.pid}.tmp`
    await writeFile(stage, String(document))
    await rename(stage, file)
  }
  if (source === join(home, 'settings.yaml')) {
    // The native importer runs after Loader readiness. It must not reapply these
    // old sections over values we just preserved (or a user's explicit reset).
    const remaining: Document = parseDocument(sourceText)
    for (const id of owned) remaining.delete(id)
    // DSH's official DeepSeek adapter now uses Messages exclusively; retain all
    // other fields and the original document, but omit the removed protocol key.
    const deepseek = remaining.get('llm-deepseek', true)
    if (isMap(deepseek)) deepseek.delete('protocol')
    try { await copyFile(source, `${source}.before-dsh-0.1.7`, constants.COPYFILE_EXCL) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stage = `${source}.${process.pid}.tmp`
    await writeFile(stage, String(remaining))
    await rename(stage, source)
  }
  // Written last: a failed conversion can safely retry; original data has a durable backup.
  await writeFile(marker, 'DSH 0.1.7 editor settings imported\n')
}
