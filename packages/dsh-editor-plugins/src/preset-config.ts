import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

/** Existing preset directories are distribution artifacts; the native registry owns live definitions. */
export async function syncPresetDeclarations(home: string, profileDir: string): Promise<void> {
  const root = join(home, '.agent-presets')
  let entries: import('node:fs').Dirent[]
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    entries = []
  }
  const rows = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    let text: string
    try { text = await readFile(join(dir, 'preset.yml'), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const meta = parse(text) as { name?: string; description?: string; order?: number } | null
    const baseUrl = pathToFileURL(dir + '/').href
    const plugins = parse(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), { customTags: [{
      tag: 'tag:yaml.org,2002:js',
      resolve: (expression: string) => ({ __jsExpr: `((baseUrl) => (${expression}))(${JSON.stringify(baseUrl)})` }),
    }] }) as unknown
    if (!Array.isArray(plugins)) throw new Error(`Invalid preset composition: ${entry.name}`)
    const anchor = (rows: unknown[]): void => {
      for (const item of rows) {
        if (!item || typeof item !== 'object') throw new Error(`Invalid preset row: ${entry.name}`)
        const row = item as { name?: unknown; group?: boolean; config?: unknown }
        if (typeof row.name !== 'string') throw new Error(`Missing preset plugin name: ${entry.name}`)
        if (isAbsolute(row.name) || row.name.startsWith('./') || row.name.startsWith('../')) row.name = pathToFileURL(resolve(dir, row.name)).href
        if (row.group && Array.isArray(row.config)) anchor(row.config)
      }
    }
    anchor(plugins)
    rows.push({ id: `editor-preset-${entry.name}`, name: '@deepseek-ai/dsh-agent-preset', config: {
      id: entry.name, ...(meta?.name ? { name: meta.name } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
      ...(typeof meta?.order === 'number' ? { order: meta.order } : {}),
      plugins,
    } })
  }
  const bundle = join(profileDir, 'node_modules', 'dsh-editor-profile-config')
  await mkdir(bundle, { recursive: true })
  const file = join(bundle, 'presets.patch.json')
  const content = JSON.stringify([{ insert: rows }], null, 2) + '\n'
  try { if (await readFile(file, 'utf8') === content) return } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, file)
}
