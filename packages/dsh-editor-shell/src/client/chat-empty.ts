import { LEGACY_AGENT_PRESET } from '../conversation-presets.ts'
import { t, type MessageKey } from '../i18n/index.ts'

const NOVEL_PRESET = 'dsh-editor-novel'
const ARTICLE_PRESET = 'dsh-editor-article'
const TECHNICAL_PRESET = 'dsh-editor-technical'

export type ChatPromptVoice = 'writing' | 'novel' | 'article' | 'technical'

const PLACEHOLDER_KEYS: Record<ChatPromptVoice, MessageKey> = {
  writing: 'chat.placeholderWriting',
  novel: 'chat.placeholderNovel',
  article: 'chat.placeholderArticle',
  technical: 'chat.placeholderTechnical',
}

/** Novel copy stays on fiction modes. General writing does not talk about plot. */
export function chatPromptVoice(presetId: string | null | undefined): ChatPromptVoice {
  if (presetId === NOVEL_PRESET || presetId === LEGACY_AGENT_PRESET) return 'novel'
  if (presetId === ARTICLE_PRESET) return 'article'
  if (presetId === TECHNICAL_PRESET) return 'technical'
  return 'writing'
}

/** An empty conversation carries no hint paragraph: the placeholder is the only per-mode copy. */
export function chatEmptyPrompt(presetId: string | null | undefined): string {
  return t(PLACEHOLDER_KEYS[chatPromptVoice(presetId)])
}

/* 空状态起步建议（shell-rewrite-spec §5）：《X》取当前文档标题，
   没有当前文档用作品名，再退到笼统的「稿件」。 */
export function partnerSuggestionTitle(activePath: string | undefined, workTitle: string | undefined): string {
  const leaf = activePath?.split(/[\\/]/).pop()?.replace(/\.(md|txt)$/i, '').trim()
  return leaf || workTitle?.trim() || t('chat.suggestFallback')
}

export function partnerSuggestions(title: string): string[] {
  return [
    t('chat.suggestPace', { title }),
    t('chat.suggestNames', { title }),
    t('chat.suggestOutline', { title }),
  ]
}
