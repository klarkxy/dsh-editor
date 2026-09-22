import type { TitleMessage } from './contracts.ts'

export const FRAME_PREFIX =
  'Choose the current task from these recent human messages, ordered oldest to newest:\n'

export function frameMessages(messages: readonly TitleMessage[]): string {
  return `${FRAME_PREFIX}${JSON.stringify(messages)}`
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function middleSlice(codePoints: readonly string[], kept: number): string {
  if (kept >= codePoints.length) return codePoints.join('')
  if (kept <= 0) return ''
  if (kept === 1) return '…'

  const contentPoints = kept - 1
  const headCount = Math.ceil(contentPoints / 2)
  const tailCount = Math.floor(contentPoints / 2)
  return `${codePoints.slice(0, headCount).join('')}…${
    tailCount === 0 ? '' : codePoints.slice(-tailCount).join('')
  }`
}

export function fitSingleMessage(message: TitleMessage, maxInputBytes: number): TitleMessage {
  const empty = { ...message, text: '' }
  if (utf8Bytes(frameMessages([empty])) > maxInputBytes) {
    throw new Error('dsh-current-title: maxInputBytes is too small for the input envelope')
  }
  if (utf8Bytes(frameMessages([message])) <= maxInputBytes) return message

  const points = Array.from(message.text)
  let low = 0
  let high = points.length
  let best = ''

  while (low <= high) {
    const kept = Math.floor((low + high) / 2)
    const text = middleSlice(points, kept)
    if (utf8Bytes(frameMessages([{ ...message, text }])) <= maxInputBytes) {
      best = text
      low = kept + 1
    } else {
      high = kept - 1
    }
  }

  return { ...message, text: best }
}

export function selectRecentMessages(
  messages: readonly TitleMessage[],
  maxRecentMessages: number,
  maxInputBytes: number,
): TitleMessage[] {
  if (messages.length === 0) return []

  const selected = messages.slice(-maxRecentMessages).map(message => ({ ...message }))
  while (selected.length > 1 && utf8Bytes(frameMessages(selected)) > maxInputBytes) {
    selected.shift()
  }

  if (utf8Bytes(frameMessages(selected)) > maxInputBytes) {
    selected[0] = fitSingleMessage(selected[0]!, maxInputBytes)
  }

  return selected
}
