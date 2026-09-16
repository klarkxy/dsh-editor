import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WRITING_PRESET_IDS } from './index.ts'

const packageRoot = join(import.meta.dirname, '..')

describe('first-party writing presets', () => {
  it('declares exactly the shipped preset dirs, each with the required files', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dshEditor: { presets: Array<{ id: string; path: string }> }
    }
    expect(manifest.dshEditor.presets.map((row) => row.id).sort()).toEqual([...WRITING_PRESET_IDS].sort())
    for (const row of manifest.dshEditor.presets) {
      expect(row.path).toBe(`presets/${row.id}`)
      expect(existsSync(join(packageRoot, row.path, 'preset.yml'))).toBe(true)
      expect(existsSync(join(packageRoot, row.path, 'agent.cordis.yml'))).toBe(true)
    }
  })
})
