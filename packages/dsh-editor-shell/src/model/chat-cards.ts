import type { ChatRow } from '../adapter.ts'
import type { ShellMessageCardRegistry } from '../seats.ts'
import { t } from '../i18n/index.ts'

export function isChatStepRow(row: ChatRow, cards?: ShellMessageCardRegistry) {
  if (row.proposal) return false
  if (row.toolName && cards?.get(row.toolName)) return false
  if (row.role === 'thinking') return true
  return row.role === 'tool' && Boolean(row.error || row.content)
}

export function clusterChatRows(rows: readonly ChatRow[], cards?: ShellMessageCardRegistry) {
  const blocks: Array<{ kind: 'item'; row: ChatRow } | { kind: 'steps'; rows: ChatRow[] }> = []
  for (const row of rows) {
    if (!isChatStepRow(row, cards)) {
      blocks.push({ kind: 'item', row })
      continue
    }
    const last = blocks.at(-1)
    if (last?.kind === 'steps') last.rows.push(row)
    else blocks.push({ kind: 'steps', rows: [row] })
  }
  return blocks
}

/** DSH compact transcript: first line when settled, last line while streaming. */
export function stepPreview(text: string, running = false): string {
  const visible = text.replaceAll('**', '').trim()
  if (!visible) return ''
  if (running) {
    const newline = visible.lastIndexOf('\n')
    return (newline === -1 ? visible : visible.slice(newline + 1)).trim()
  }
  const newline = visible.indexOf('\n')
  return (newline === -1 ? visible : visible.slice(0, newline)).trim()
}

/** Same rule as DSH `TurnProcessNodeView`: tools take the label, else “已思考”. */
export function turnProcessLabel(input: { tools: number; running?: boolean }): string {
  if (input.running && input.tools === 0) return t('chat.thinking')
  if (input.tools === 1) return t('chat.turnToolOne', { count: 1 })
  if (input.tools > 1) return t('chat.turnTools', { count: input.tools })
  return t('chat.turnThought')
}

export function toolStepTitle(row: ChatRow): string {
  return row.text || row.detail || row.toolName || ''
}

/** Keep thinking, tool use, and errors; details stay inside each row. */
export function processDetailRows(rows: readonly ChatRow[]): ChatRow[] {
  return rows.filter((row) => row.role === 'thinking' || row.role === 'tool')
}
