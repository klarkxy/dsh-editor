import { isManuscriptChapterPath } from '../project-files.ts'
import { getLocale, t } from '../i18n/index.ts'

/** An empty conversation carries no hint paragraph: the placeholder is the only prompt copy. */
export function chatEmptyPrompt(): string {
  return t('chat.placeholderWriting')
}

/* 空状态起步建议（shell-rewrite-spec §5）：《X》取当前文档的显示标题
   （与概览一致），缺省退文件名，再退作品名，最后是笼统的「稿件」。 */
export function partnerSuggestionTitle(activePath: string | undefined, workTitle: string | undefined, displayTitle?: string): string {
  const leaf = activePath?.split(/[\\/]/).pop()?.replace(/\.(md|txt)$/i, '').trim()
  return displayTitle?.trim() || leaf || workTitle?.trim() || t('chat.suggestFallback')
}

export type PartnerSuggestionKind = 'chapter' | 'document'

/* 建议语气跟文档种类走：打开的正文/章节给情节向建议，其余文档给审读/
   概括/核实向建议。 */
export function partnerSuggestionKind(activePath: string | undefined): PartnerSuggestionKind {
  if (activePath && isManuscriptChapterPath(activePath)) return 'chapter'
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
