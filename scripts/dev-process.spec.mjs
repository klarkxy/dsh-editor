import { describe, expect, it } from 'vitest'
import { firstCompilePattern, isLeftoverDevCommand } from './dev-process.mjs'

const root = 'D:\\0 code\\dsh-editor'

describe('leftover dev process matching', () => {
  it('matches this repo\'s tsdown watchers, Electron main, and DSH runtime', () => {
    expect(isLeftoverDevCommand(`node D:\\0 code\\dsh-editor\\node_modules\\tsdown\\dist\\run.mjs --watch --no-clean`, root)).toBe(true)
    expect(isLeftoverDevCommand('node D:/0 code/dsh-editor/apps/desktop/node_modules/electron/cli.js D:/0 code/dsh-editor/apps/desktop/dist/main.js', root)).toBe(true)
    expect(isLeftoverDevCommand('node D:/0 code/dsh-editor/.dev/desktop-dsh-runtime-0.1.7-alpha.1/lib/bin.js --profile dsh-editor', root)).toBe(true)
  })

  it('ignores other commands in this repo and the same tools in another tree', () => {
    expect(isLeftoverDevCommand(`node D:\\0 code\\dsh-editor\\node_modules\\vitest\\dist\\cli.js run`, root)).toBe(false)
    expect(isLeftoverDevCommand('node C:\\other\\project\\node_modules\\tsdown\\dist\\run.mjs --watch', root)).toBe(false)
    expect(isLeftoverDevCommand('', root)).toBe(false)
    expect(isLeftoverDevCommand('node --watch', root)).toBe(false)
  })
})

describe('first compile logs', () => {
  it('waits for wrap-client output on browser packages and tsdown rebuild on host packages', () => {
    expect(firstCompilePattern('dsh-editor-shell', true).test('wrapped dsh-editor-shell -> lib/client.js')).toBe(true)
    expect(firstCompilePattern('dsh-editor-shell', true).test('Rebuilt in 16ms.')).toBe(false)
    expect(firstCompilePattern('dsh-editor-workbench', false).test('\u001b[32mRebuilt in 16ms.\u001b[0m')).toBe(true)
    expect(firstCompilePattern('dsh-editor-workbench', false).test('Build start')).toBe(false)
  })
})
