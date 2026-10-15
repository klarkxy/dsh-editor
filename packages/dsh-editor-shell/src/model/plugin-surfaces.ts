import type { ShellCommand, ShellLocale } from '../seats.ts'

export type SlotEntry = { options?: { id?: string; order?: number; label?: string | (() => string) } }

export function firstSurfaceEntry(entries: readonly SlotEntry[]): string | undefined {
  return entries.filter(entry => typeof entry.options?.id === 'string' && entry.options.id.trim())
    .map((entry, index) => ({ id: entry.options!.id!, order: entry.options?.order ?? 0, index }))
    .sort((left, right) => left.order - right.order || left.index - right.index)[0]?.id
}

export function modelSettingsSections(entries: readonly SlotEntry[], locale: 'zh' | 'en') {
  const seen = new Set<string>()
  return entries.flatMap((entry, index) => {
    const id = entry.options?.id?.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    let label = id
    try {
      const raw = typeof entry.options?.label === 'function' ? entry.options.label() : entry.options?.label
      if (typeof raw === 'string' && raw.trim()) label = raw.trim()
    } catch { /* A label failure cannot hide other plugin settings. */ }
    return [{ id, label, order: entry.options?.order ?? 0, index }]
  }).sort((a, b) => a.order - b.order || a.index - b.index)
}

export type ToolLauncher = {
  id: string
  label: string
  hint?: string
  command: ShellCommand
}

/*
 * 「工具」页签空态的启动行。sidebar 工具贡献按「请求时才渲染」的约定
 * 工作（记忆面板在 memory-open 命令前渲染 null），所以空态列出能打开
 * 它们的入口：每个贡献配一条 `${id}-open`（其次 `${id}`）命令；没有
 * 打开命令的贡献不出现在列表里（常显面板本就不会触发空态）。
 */
export function toolLaunchers(
  entries: readonly SlotEntry[],
  commands: readonly ShellCommand[],
  locale: ShellLocale,
): ToolLauncher[] {
  const seen = new Set<string>()
  return entries.flatMap((entry, index) => {
    const id = entry.options?.id?.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    const command = commands.find((item) => item.id === `${id}-open`) ?? commands.find((item) => item.id === id)
    if (!command) return []
    let label = id
    try {
      const raw = typeof entry.options?.label === 'function' ? entry.options.label() : entry.options?.label
      if (typeof raw === 'string' && raw.trim()) label = raw.trim()
    } catch { /* A label failure cannot hide other tool launchers. */ }
    const commandLabel = command.label[locale] || command.label.zh
    if (commandLabel?.trim()) label = commandLabel.trim()
    const hint = command.hint?.[locale] || command.hint?.zh
    return [{ id, label, hint: hint?.trim() || undefined, command, order: entry.options?.order ?? 0, index }]
  }).sort((a, b) => a.order - b.order || a.index - b.index)
}
