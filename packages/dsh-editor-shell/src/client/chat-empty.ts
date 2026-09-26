import { LEGACY_AGENT_PRESET } from '../conversation-presets.ts'
import { t, type MessageKey } from '../i18n/index.ts'

const NOVEL_PRESET = 'dsh-editor-novel'
const ARTICLE_PRESET = 'dsh-editor-article'
const TECHNICAL_PRESET = 'dsh-editor-technical'

export type ChatPromptVoice = 'writing' | 'novel' | 'article' | 'technical'

const VOICE_KEYS: Record<ChatPromptVoice, { empty: MessageKey; named: MessageKey; placeholder: MessageKey }> = {
  writing: { empty: 'chat.emptyWriting', named: 'chat.emptyWritingNamed', placeholder: 'chat.placeholderWriting' },
  novel: { empty: 'chat.emptyNovel', named: 'chat.emptyNovelNamed', placeholder: 'chat.placeholderNovel' },
  article: { empty: 'chat.emptyArticle', named: 'chat.emptyArticleNamed', placeholder: 'chat.placeholderArticle' },
  technical: { empty: 'chat.emptyTechnical', named: 'chat.emptyTechnicalNamed', placeholder: 'chat.placeholderTechnical' },
}

/** Basename without a manuscript extension, for the empty-conversation sentence. */
export function manuscriptDisplayTitle(path: string | undefined): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed
  return base.replace(/\.(md|txt)$/i, '')
}

/** Novel copy stays on fiction modes. General writing does not talk about plot. */
export function chatPromptVoice(presetId: string | null | undefined): ChatPromptVoice {
  if (presetId === NOVEL_PRESET || presetId === LEGACY_AGENT_PRESET) return 'novel'
  if (presetId === ARTICLE_PRESET) return 'article'
  if (presetId === TECHNICAL_PRESET) return 'technical'
  return 'writing'
}

export function chatEmptyPrompt(presetId: string | null | undefined, activePath: string | undefined): { title: string; empty: string; placeholder: string } {
  const voice = chatPromptVoice(presetId)
  const keys = VOICE_KEYS[voice]
  const title = manuscriptDisplayTitle(activePath)
  return {
    title,
    empty: title ? t(keys.named, { title }) : t(keys.empty),
    placeholder: t(keys.placeholder),
  }
}
