import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
/** Add the opt-in tool bridge only when its package is present in this composition. */
export async function configureWebSearchPresets(profilePath, composition) {
  if (!composition.shellFeatures['web-search']) return
  const root = join(profilePath, 'agent-presets')
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-editor')) continue
    const path = join(root, entry.name, 'agent.cordis.yml')
    let content
    try { content = await readFile(path, 'utf8') } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (content.includes('name: dsh-web-search-manager/tools')) continue
    await writeFile(path, `${content.trimEnd()}\n\n# Authorization and limits come from the host network-search manager.\n- id: editor-web-search-tools\n  name: dsh-web-search-manager/tools\n`)
  }
}
