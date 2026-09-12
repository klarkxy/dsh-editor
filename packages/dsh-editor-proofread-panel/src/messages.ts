import type { ShellLocale } from 'dsh-editor-seats'

export type MessageKey = keyof typeof zh
export type MessageParams = Record<string, string | number>

export const zh = {
  'common.clear': '清除',
  'proofread.openDocFirst': '请先打开一篇文档。',
  'proofread.openDocBefore': '请先打开一篇文档，再校对当前文档。',
  'proofread.none': '未发现需要处理的问题。',
  'proofread.staleLocate': '文件已变化，定位可能不准。请重新检查。',
  'proofread.mdOnly': '校对建议只能对 Markdown 走确认写入；TXT 请手工修改。',
  'proofread.saveBeforeApply': '请先保存当前文档，再应用建议。',
  'proofread.notUnique': '文件已变化或无法唯一对应原文，请重新检查。',
  'proofread.noPunctBatch': '没有可合并的标点建议，或文件已变化。',
  'proofread.ignoreWriteFailed': '未能写入忽略名单。请手工把「{term}」追加到 {path}，然后重新检查。',
  'proofread.alreadyIgnored': '「{term}」已在忽略名单中。',
  'proofread.ignoredTerm': '已忽略「{term}」。',
  'proofread.title': '校对',
  'proofread.close': '关闭校对面板',
  'proofread.intro': '标点、错别字、敏感词、重复与口癖。',
  'proofread.retry': '重试',
  'proofread.scope': '校对范围',
  'proofread.currentDoc': '当前文档',
  'proofread.wholeBook': '全书正文',
  'proofread.checking': '检查中…',
  'proofread.recheck': '重新检查',
  'proofread.kinds': '问题类型',
  'proofread.summary': '{hits} 处 · 已查 {files} 份文件',
  'proofread.truncated': '扫描已截断',
  'proofread.versionDiff': '打开后的文件版本与检查时不同。',
  'proofread.saveBeforeJump': '请先保存当前文档，再跳转或改当前稿。',
  'proofread.batchPunct': '批量应用全部标点建议（{count}）',
  'proofread.suggestion': '→ 建议 {text}',
  'proofread.remove': '删除',
  'proofread.apply': '应用建议',
  'proofread.ignoreSensitive': '忽略此敏感词',
  'proofread.habits': '口癖统计',
  'proofread.viewingHabit': '正在查看「{term}」',
  'proofread.word': '词语',
  'proofread.count': '次数',
  'proofread.editSummary': '校对：{message}',
  'proofread.batchSummary': '校对：批量应用 {count} 处标点建议',
  'proofread.skipped': '跳过 {count} 项',
  'proofread.kind.punctuation': '标点',
  'proofread.kind.typo': '错别字',
  'proofread.kind.sensitive': '敏感词',
  'proofread.kind.repeat': '重复',
  'proofread.kind.habit': '口癖',
  'proofread.kind.card': '设定对照',
  'command.proofreadDoc': '校对当前文档',
  'command.proofreadDocHint': 'Ctrl+Shift+L · 标点、错别字、敏感词、重复与口癖',
  'command.proofreadBook': '校对全书',
  'command.proofreadBookHint': '检查全部正文',
  'error.diskChanged': '磁盘上的文件已变化，请重新读取后再试。',
  'error.notFound': '未找到该文件。',
  'error.sessionMissing': '会话已失效，请重新打开作品。',
  'error.generic': '操作未能完成，请重试。',
} as const

export const en: Record<MessageKey, string> = {
  'common.clear': 'Clear',
  'proofread.openDocFirst': 'Open a document first.',
  'proofread.openDocBefore': 'Open a document before proofreading the current file.',
  'proofread.none': 'No issues to handle.',
  'proofread.staleLocate': 'The file changed, so the location may be off. Check again.',
  'proofread.mdOnly': 'Proofread suggestions can only be applied with confirmation on Markdown. Edit TXT by hand.',
  'proofread.saveBeforeApply': 'Save the current document before applying a suggestion.',
  'proofread.notUnique': 'The file changed or the original text is not unique. Check again.',
  'proofread.noPunctBatch': 'No punctuation suggestions can be merged, or the file changed.',
  'proofread.ignoreWriteFailed': 'Could not write the ignore list. Append “{term}” to {path} by hand, then check again.',
  'proofread.alreadyIgnored': '“{term}” is already on the ignore list.',
  'proofread.ignoredTerm': 'Ignored “{term}”.',
  'proofread.title': 'Proofread',
  'proofread.close': 'Close proofread panel',
  'proofread.intro': 'Punctuation, typos, sensitive terms, repeats, and habits.',
  'proofread.retry': 'Retry',
  'proofread.scope': 'Scope',
  'proofread.currentDoc': 'Current document',
  'proofread.wholeBook': 'Whole manuscript',
  'proofread.checking': 'Checking…',
  'proofread.recheck': 'Check again',
  'proofread.kinds': 'Issue type',
  'proofread.summary': '{hits} issues · scanned {files} files',
  'proofread.truncated': 'Scan truncated',
  'proofread.versionDiff': 'The open file version differs from the check.',
  'proofread.saveBeforeJump': 'Save the current document before jumping or editing this draft.',
  'proofread.batchPunct': 'Apply all punctuation suggestions ({count})',
  'proofread.suggestion': '→ Suggest {text}',
  'proofread.remove': 'Delete',
  'proofread.apply': 'Apply',
  'proofread.ignoreSensitive': 'Ignore this sensitive term',
  'proofread.habits': 'Habit stats',
  'proofread.viewingHabit': 'Viewing “{term}”',
  'proofread.word': 'Word',
  'proofread.count': 'Count',
  'proofread.editSummary': 'Proofread: {message}',
  'proofread.batchSummary': 'Proofread: apply {count} punctuation suggestions',
  'proofread.skipped': 'Skipped {count} items',
  'proofread.kind.punctuation': 'Punctuation',
  'proofread.kind.typo': 'Typo',
  'proofread.kind.sensitive': 'Sensitive',
  'proofread.kind.repeat': 'Repeat',
  'proofread.kind.habit': 'Habit',
  'proofread.kind.card': 'Card check',
  'command.proofreadDoc': 'Proofread current document',
  'command.proofreadDocHint': 'Ctrl+Shift+L · punctuation, typos, sensitive terms, repeats, and habits',
  'command.proofreadBook': 'Proofread whole book',
  'command.proofreadBookHint': 'Check all manuscript chapters',
  'error.diskChanged': 'The file on disk changed. Read it again, then retry.',
  'error.notFound': 'That file was not found.',
  'error.sessionMissing': 'The session is gone. Open the work again.',
  'error.generic': 'The action could not finish. Try again.',
}

const dictionaries: Record<ShellLocale, Record<MessageKey, string>> = { zh, en }

let currentLocale: ShellLocale = 'zh'

export function setProofreadLocale(locale: ShellLocale): void {
  currentLocale = locale === 'en' ? 'en' : 'zh'
}

export function getProofreadLocale(): ShellLocale {
  return currentLocale
}

export function intlLocale(locale: ShellLocale = currentLocale): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export function t(key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[currentLocale][key] || zh[key] || String(key)
  return interpolate(text, params)
}

export function message(locale: ShellLocale, key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[locale][key] || zh[key] || String(key)
  return interpolate(text, params)
}
