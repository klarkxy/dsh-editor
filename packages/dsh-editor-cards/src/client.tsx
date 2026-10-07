import type { Context } from '@deepseek-ai/cordis'
import { COMMANDS_SERVICE, type ShellCommand, type ShellCommandRegistry } from 'dsh-editor-seats'

export const name = 'dsh-editor-cards-client'
export const inject = [COMMANDS_SERVICE] as const

const commands: ShellCommand[] = [
  {
    id: 'cards-character',
    group: 'writing',
    label: { zh: '人物卡', en: 'Characters' },
    hint: { zh: 'Ctrl+Shift+C · 在文件树中展开人物卡', en: 'Ctrl+Shift+C · reveal Characters in the file tree' },
    keywords: ['character', '人物', '人物卡', '角色'],
    shortcut: { key: 'c', ctrl: true, shift: true },
    when: 'workspace',
    run(context) {
      context.expandTreePath('人物卡')
      context.highlightTreePath('人物卡')
    },
  },
  {
    id: 'cards-worldbook',
    group: 'writing',
    label: { zh: '世界书', en: 'Worldbook' },
    hint: { zh: 'Ctrl+Shift+W · 在文件树中展开世界书', en: 'Ctrl+Shift+W · reveal Worldbook in the file tree' },
    keywords: ['worldbook', '世界书', '设定', 'Lore', '触发词'],
    shortcut: { key: 'w', ctrl: true, shift: true },
    when: 'workspace',
    run(context) {
      context.expandTreePath('世界书')
      context.highlightTreePath('世界书')
    },
  },
]

export function apply(ctx: Context): void {
  const registry = (ctx as Context & { [COMMANDS_SERVICE]: ShellCommandRegistry })[COMMANDS_SERVICE]
  for (const command of commands) {
    ctx.effect(() => registry.register(command), `dsh-editor-cards-client.command.${command.id}`)
  }
}
