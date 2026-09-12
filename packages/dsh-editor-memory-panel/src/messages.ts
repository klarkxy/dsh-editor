import type { ShellLocale } from 'dsh-editor-seats'

export type MessageKey = keyof typeof zh
export type MessageParams = Record<string, string | number>

export const zh = {
  'memory.title': '记忆更新',
  'memory.close': '关闭记忆面板',
  'memory.back': '返回列表',
  'memory.filter': '按状态筛选',
  'memory.retryList': '重试',
  'memory.noMatch': '没有符合筛选的记录。',
  'memory.intro': '确认或撤销写作搭档提出的维护记录。',
  'memory.loading': '正在读取记忆更新…',
  'memory.empty': '还没有记忆更新记录。',
  'memory.retry': '重试',
  'memory.confirm': '确认写入',
  'memory.undo': '撤销写入',
  'memory.applying': '正在写入…',
  'memory.undoing': '正在撤销…',
  'memory.applied': '已写入。',
  'memory.undone': '已撤销。',
  'memory.staleUndoPending': '文件在写入后又有变化，撤销已转为一条新的待确认更新。',
  'memory.before': '写入前',
  'memory.after': '写入后',
  'memory.newContent': '新内容',
  'memory.evidence': '依据',
  'memory.evidenceUser': '来自对话',
  'memory.category.rule': '规则',
  'memory.category.fact': '事实',
  'memory.certainty.explicit': '明确',
  'memory.certainty.uncertain': '不确定',
  'memory.status.pending': '待确认',
  'memory.status.applied': '已应用',
  'memory.status.stale': '已过期',
  'memory.status.failed': '失败',
  'memory.status.undone': '已撤销',
  'command.memoryOpen': '记忆维护',
  'command.memoryOpenHint': '查看、应用与撤销写作搭档提出的维护记录',
  'error.diskChanged': '磁盘上的文件已变化，请重新读取后再试。',
  'error.notFound': '未找到该文件。',
  'error.sessionMissing': '会话已失效，请重新打开作品。',
  'error.generic': '操作未能完成，请重试。',
} as const

export const en: Record<MessageKey, string> = {
  'memory.title': 'Memory updates',
  'memory.close': 'Close memory panel',
  'memory.back': 'Back to list',
  'memory.filter': 'Filter by status',
  'memory.retryList': 'Retry',
  'memory.noMatch': 'No records match the filter.',
  'memory.intro': 'Confirm or undo partner memory updates.',
  'memory.loading': 'Loading memory updates…',
  'memory.empty': 'No memory updates yet.',
  'memory.retry': 'Retry',
  'memory.confirm': 'Confirm write',
  'memory.undo': 'Undo write',
  'memory.applying': 'Writing…',
  'memory.undoing': 'Undoing…',
  'memory.applied': 'Written.',
  'memory.undone': 'Undone.',
  'memory.staleUndoPending': 'The file changed after the write, so the undo became a new pending update.',
  'memory.before': 'Before',
  'memory.after': 'After',
  'memory.newContent': 'New content',
  'memory.evidence': 'Evidence',
  'memory.evidenceUser': 'From conversation',
  'memory.category.rule': 'Rule',
  'memory.category.fact': 'Fact',
  'memory.certainty.explicit': 'Explicit',
  'memory.certainty.uncertain': 'Uncertain',
  'memory.status.pending': 'Pending',
  'memory.status.applied': 'Applied',
  'memory.status.stale': 'Stale',
  'memory.status.failed': 'Failed',
  'memory.status.undone': 'Undone',
  'command.memoryOpen': 'Memory maintenance',
  'command.memoryOpenHint': 'Review, apply, or undo partner memory updates',
  'error.diskChanged': 'The file on disk changed. Read it again, then retry.',
  'error.notFound': 'That file was not found.',
  'error.sessionMissing': 'The session is gone. Open the work again.',
  'error.generic': 'The action could not finish. Try again.',
}

const dictionaries: Record<ShellLocale, Record<MessageKey, string>> = { zh, en }

let currentLocale: ShellLocale = 'zh'

export function setMemoryLocale(locale: ShellLocale): void {
  currentLocale = locale === 'en' ? 'en' : 'zh'
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
