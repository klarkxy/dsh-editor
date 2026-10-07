// Owner markers are shared with the desktop restoration path.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const PLUGIN_PRESETS_DIRNAME = '.agent-presets'
export const PRESET_OWNER_MARKER = '.dsh-editor-owner.json'
export type PresetOwner = { app?: unknown; schema?: unknown; plugin?: unknown }

export async function readPresetOwner(directory: string): Promise<PresetOwner | undefined> {
  try {
    const marker = JSON.parse(await readFile(join(directory, PRESET_OWNER_MARKER), 'utf8')) as PresetOwner
    return marker.app === 'dsh-editor' && marker.schema === 1 ? marker : undefined
  } catch {
    return undefined
  }
}
