import type { ShortcutCommand, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceShortcutAction } from './shared.ts'

type RegisteredAction = WorkspaceShortcutAction | 'new-window' | 'palette'
type Binding = ShortcutCommand['defaults'][keyof ShortcutCommand['defaults']]

const desktop = (code: string, modifiers: NonNullable<Binding>['modifiers']) => ({
  'desktop:macos': { code, modifiers },
  'desktop:windows': { code, modifiers },
  'desktop:linux': { code, modifiers },
}) as ShortcutCommand['defaults']

const commands: readonly {
  action: RegisteredAction
  id: string
  label: string
  aliases: readonly string[]
  defaults: ShortcutCommand['defaults']
}[] = [
  { action: 'palette', id: 'editor.palette.open', label: '命令面板', aliases: ['command palette'], defaults: {
    ...desktop('KeyK', ['primary']),
    'web:macos': { code: 'KeyK', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyK', modifiers: ['primary', 'alt'] },
  } },
  { action: 'new-window', id: 'editor.window.new', label: '新建窗口', aliases: ['new window'], defaults: {
    ...desktop('KeyN', ['primary', 'shift']),
  } },
  { action: 'toggle-sidebar', id: 'sidebar.left.toggle', label: '切换文件栏', aliases: ['left sidebar', 'files'], defaults: {
    ...desktop('KeyB', ['primary']),
    'web:macos': { code: 'KeyB', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyB', modifiers: ['primary', 'alt'] },
  } },
  { action: 'settings', id: 'editor.settings.open', label: '打开设置', aliases: ['settings'], defaults: {
    ...desktop('Comma', ['primary']),
    'web:macos': { code: 'Comma', modifiers: ['primary'] },
    'web:windows': { code: 'Comma', modifiers: ['primary'] },
  } },
  { action: 'toggle-assistant', id: 'editor.assistant.toggle', label: '切换助手栏', aliases: ['assistant'], defaults: {
    ...desktop('KeyJ', ['primary']),
    'web:macos': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyJ', modifiers: ['primary', 'alt'] },
  } },
  { action: 'toggle-focus', id: 'editor.focus.toggle', label: '切换专注模式', aliases: ['focus'], defaults: {
    ...desktop('KeyF', ['primary', 'alt']),
    'web:macos': { code: 'KeyF', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyF', modifiers: ['primary', 'alt'] },
  } },
  { action: 'focus-assistant', id: 'editor.assistant.focus', label: '聚焦助手输入', aliases: ['composer'], defaults: {
    ...desktop('KeyL', ['primary']),
    'web:macos': { code: 'KeyL', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyL', modifiers: ['primary', 'alt'] },
  } },
  { action: 'search', id: 'editor.search.open', label: '搜索文稿', aliases: ['search'], defaults: {
    ...desktop('KeyF', ['primary', 'shift']),
    'web:macos': { code: 'KeyF', modifiers: ['primary', 'shift'] },
    'web:windows': { code: 'KeyF', modifiers: ['primary', 'shift'] },
  } },
  { action: 'toggle-typewriter', id: 'editor.typewriter.toggle', label: '切换打字机模式', aliases: ['typewriter'], defaults: {
    ...desktop('KeyT', ['primary', 'alt']),
    'web:macos': { code: 'KeyT', modifiers: ['primary', 'alt'] },
    'web:windows': { code: 'KeyT', modifiers: ['primary', 'alt'] },
  } },
  { action: 'toggle-focus-paragraph', id: 'editor.paragraph-focus.toggle', label: '切换段落聚焦', aliases: ['paragraph focus'], defaults: {
    ...desktop('KeyP', ['primary', 'alt']),
    'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
    'web:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
  } },
]

/** Register Editor-owned actions in the official catalog for one mounted root. */
export function registerEditorWorkspaceShortcuts(
  shortcuts: Pick<Shortcuts, 'register'>,
  handlers: Readonly<Partial<Record<RegisteredAction, () => void>>>,
  enabled: (action: RegisteredAction) => boolean = () => true,
  label: (action: RegisteredAction, fallback: string) => string = (_action, fallback) => fallback,
): () => void {
  const dispose: Array<() => void> = []
  try {
    for (const command of commands) {
      dispose.push(shortcuts.register({
        id: command.id as ShortcutCommand['id'],
        label: () => label(command.action, command.label),
        aliases: command.aliases,
        defaults: command.defaults,
        regions: ['page', 'editable'],
        modals: [],
        resolve: () => {
          const run = handlers[command.action]
          return run && enabled(command.action)
            ? { status: 'handled', run }
            : { status: 'pass' }
        },
      }))
    }
  } catch (error) {
    for (const off of dispose.reverse()) off()
    throw error
  }
  return () => { for (const off of dispose.reverse()) off() }
}
