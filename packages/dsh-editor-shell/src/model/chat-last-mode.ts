import { firstAvailableConversationPreset, type ConversationPresetChoice } from '../conversation-presets.ts'

/** 搭档栏「新对话」SplitButton 的上次模式记录键（shell-rewrite-spec §5）。 */
export const LAST_CHAT_MODE_KEY = 'dsh-editor.chat.last-mode'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | null | undefined

export function readLastChatMode(storage: StorageLike): string | undefined {
  try {
    const value = storage?.getItem(LAST_CHAT_MODE_KEY)?.trim()
    return value || undefined
  } catch {
    /* Private-mode storage can throw; treat as no record. */
    return undefined
  }
}

export function writeLastChatMode(storage: StorageLike, presetId: string): void {
  try {
    storage?.setItem(LAST_CHAT_MODE_KEY, presetId)
  } catch {
    /* Non-fatal: the next new conversation falls back to the first mode. */
  }
}

/**
 * 主按钮使用的模式：上次记录仍在可用列表里就用它；没有记录或已不可用时，
 * 与现在的第一项默认模式相同（firstAvailableConversationPreset）。
 */
export function resolveNewChatMode(storage: StorageLike, presets: readonly ConversationPresetChoice[]): string | undefined {
  const last = readLastChatMode(storage)
  if (last && presets.some((preset) => preset.id === last && preset.available)) return last
  return firstAvailableConversationPreset(presets)
}
