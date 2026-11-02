import { describe, expect, it } from 'vitest'
import { bindingIssue, normalizeBinding, parseShortcutDefinitions } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { registerEditorWorkspaceShortcuts } from './official-shortcuts.ts'

// Active 0.2.1-rc.5 UI modules: right sidebar, files tab, and shortcut reference.
// The official layout command is intentionally absent from this composition.
const officialDefinitions = [
  { id: 'sidebar.right.toggle', defaults: {
    'desktop:windows': { code: 'KeyB', modifiers: ['primary', 'alt'] },
    'desktop:macos': { code: 'KeyB', modifiers: ['primary', 'alt'] },
    'desktop:linux': { code: 'KeyB', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyB', modifiers: ['primary', 'shift'] },
    'web:macos': { code: 'KeyB', modifiers: ['primary', 'shift'] },
  } },
  { id: 'pane.split', defaults: Object.fromEntries(
    ['desktop:windows', 'desktop:macos', 'desktop:linux', 'web:windows', 'web:macos']
      .map((profile) => [profile, { code: 'Backslash', modifiers: ['primary'] }]),
  ) },
  { id: 'workspace.files', defaults: {
    'desktop:windows': { code: 'KeyP', modifiers: ['primary'] },
    'desktop:macos': { code: 'KeyP', modifiers: ['primary'] },
    'desktop:linux': { code: 'KeyP', modifiers: ['primary'] },
    'web:windows': { code: 'KeyP', modifiers: ['primary', 'alt'] },
    'web:macos': { code: 'KeyP', modifiers: ['primary', 'alt'] },
  } },
  { id: 'shortcuts.open', defaults: Object.fromEntries(
    ['desktop:windows', 'desktop:macos', 'desktop:linux', 'web:windows', 'web:macos', 'web:linux']
      .map((profile) => [profile, { code: 'Slash', modifiers: ['primary'] }]),
  ) },
]

describe('Editor shortcuts in the official catalog', () => {
  it('owns the left sidebar and uses supported defaults without colliding with active official commands', () => {
    const registered: Array<{ id: string; defaults: Record<string, { code: string; modifiers: Array<'primary' | 'alt' | 'shift'> }>; resolve: () => { status: string; run?: () => void } }> = []
    const removed: string[] = []
    let count = 0
    const dispose = registerEditorWorkspaceShortcuts({ register(command) {
      registered.push(command as typeof registered[number])
      return () => { removed.push(command.id) }
    } }, { 'toggle-sidebar': () => { count += 1 } }, (action) => action === 'toggle-sidebar')
    expect(registered.filter((item) => item.id === 'sidebar.left.toggle')).toHaveLength(1)
    expect(registered.find((item) => item.id === 'sidebar.left.toggle')?.defaults['desktop:windows'])
      .toEqual({ code: 'KeyB', modifiers: ['primary'] })
    expect(registered.find((item) => item.id === 'editor.focus.toggle')?.defaults['desktop:windows'])
      .toEqual({ code: 'KeyF', modifiers: ['primary', 'alt'] })
    expect(registered.find((item) => item.id === 'editor.paragraph-focus.toggle')?.defaults['web:windows'])
      .toEqual({ code: 'KeyP', modifiers: ['primary', 'shift'] })
    registered.find((item) => item.id === 'sidebar.left.toggle')?.resolve().run?.()
    expect(count).toBe(1)
    expect(registered.find((item) => item.id === 'editor.search.open')?.resolve().status).toBe('pass')

    expect(() => parseShortcutDefinitions([...officialDefinitions, ...registered.map(({ id, defaults }) => ({ id, defaults }))])).not.toThrow()
    for (const command of registered) for (const [profile, binding] of Object.entries(command.defaults)) {
      const [runtime, platform] = profile.split(':') as ['desktop' | 'web', 'macos' | 'windows' | 'linux']
      expect(bindingIssue(normalizeBinding(binding, platform), runtime, platform), `${command.id} on ${profile}`).toBeNull()
    }
    dispose()
    expect(removed).toHaveLength(registered.length)
  })
})