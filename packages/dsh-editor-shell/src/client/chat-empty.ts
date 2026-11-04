import { LEGACY_AGENT_PRESET } from '../conversation-presets.ts'
import { isManuscriptChapterPath } from '../project-files.ts'
import { getLocale, t, type MessageKey } from '../i18n/index.ts'

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

/* 空状态起步建议（shell-rewrite-spec §5）：《X》取当前文档的显示标题
   （与概览一致），缺省退文件名，再退作品名，最后是笼统的「稿件」。 */
export function partnerSuggestionTitle(activePath: string | undefined, workTitle: string | undefined, displayTitle?: string): string {
  const leaf = activePath?.split(/[\\/]/).pop()?.replace(/\.(md|txt)$/i, '').trim()
  return displayTitle?.trim() || leaf || workTitle?.trim() || t('chat.suggestFallback')
}

export type PartnerSuggestionKind = 'chapter' | 'document'

/* 建议语气跟着「文档种类」走而不只是模式：小说模式下打开的正文/章节
   才给情节向建议；资料、大纲等普通文档（以及非小说模式、无打开文档
   的非小说场景）给审读/概括/核实向建议。 */
export function partnerSuggestionKind(activePath: string | undefined, presetId: string | null | undefined): PartnerSuggestionKind {
  if (chatPromptVoice(presetId) === 'novel' && (!activePath || isManuscriptChapterPath(activePath))) return 'chapter'
  return 'document'
}

export function partnerSuggestions(title: string, kind: PartnerSuggestionKind = 'chapter'): string[] {
  /* 标题本身可能带书名号（如「《越共》常见问题与自检清单」）：
     中文界面里内层改用〈〉，避免套出《《…》…》的双层书名号。 */
  const innerTitle = getLocale() === 'zh'
    ? title.replaceAll('《', '〈').replaceAll('》', '〉')
    : title
  if (kind === 'document') {
    return [
      t('chat.suggestDocReview', { title: innerTitle }),
      t('chat.suggestDocSummary', { title: innerTitle }),
      t('chat.suggestDocCheck', { title: innerTitle }),
    ]
  }
  return [
    t('chat.suggestPace', { title: innerTitle }),
    t('chat.suggestNames', { title: innerTitle }),
    t('chat.suggestOutline', { title: innerTitle }),
  ]
}
