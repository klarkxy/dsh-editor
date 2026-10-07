import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { COMMANDS_SERVICE, createCommandRegistry, type ShellToolSeatContext } from 'dsh-editor-seats'
import { apply, inject } from './client.tsx'

describe('cards file navigation commands', () => {
  it('registers localized workspace commands without a slot or RPC service, then disposes them', () => {
    const commands = createCommandRegistry()
    const disposers: Array<() => void> = []
    apply({
      effect(fn: () => () => void) { disposers.push(fn()) },
      [COMMANDS_SERVICE]: commands,
    } as never)
    expect(inject).toEqual([COMMANDS_SERVICE])
    expect(commands.list().map(command => command.id)).toEqual(['cards-character', 'cards-worldbook'])
    const expandTreePath = vi.fn()
    const highlightTreePath = vi.fn()
    const context = { expandTreePath, highlightTreePath } as unknown as ShellToolSeatContext
    for (const [index, folder] of ['人物卡', '世界书'].entries()) {
      const command = commands.list()[index]!
      expect(command.when).toBe('workspace')
      expect(command.shortcut).toEqual({ key: index === 0 ? 'c' : 'w', ctrl: true, shift: true })
      expect(command.label).toEqual(index === 0 ? { zh: '人物卡', en: 'Characters' } : { zh: '世界书', en: 'Worldbook' })
      command.run(context)
      expect(expandTreePath).toHaveBeenLastCalledWith(folder)
      expect(highlightTreePath).toHaveBeenLastCalledWith(folder)
    }
    for (const dispose of disposers) dispose()
    expect(commands.list()).toEqual([])
  })

  it('does not advertise the retired cards transport and metadata API', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.exports['./host-api']).toBeUndefined()
    expect(pkg.exports['./contracts']).toBeUndefined()
    expect(pkg.dsh.client.inject).toEqual([])
  })
})
