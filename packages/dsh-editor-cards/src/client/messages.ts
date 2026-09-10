import type { ShellLocale } from 'dsh-editor-seats'

export type MessageKey = keyof typeof zh
export type MessageParams = Record<string, string | number>

export const zh = {
  'cards.truncated': '卡片较多，列表已截断。',
  'cards.characters': '人物卡',
  'cards.worldbook': '世界书',
  'cards.kind': '卡片类型',
  'cards.person': '人物',
  'cards.setting': '设定',
  'cards.filterPeople': '筛选姓名、别名或标签',
  'cards.filterWorld': '筛选标题、触发词或标签',
  'cards.filter': '筛选卡片',
  'cards.sort': '排序',
  'cards.sortName': '按名称',
  'cards.sortModified': '按修改',
  'cards.sortRole': '按身份',
  'cards.sortCategory': '按分类',
  'cards.newPerson': '新建人物卡',
  'cards.newSetting': '新建设定',
  'cards.role': '身份',
  'cards.category': '分类',
  'cards.tags': '标签',
  'cards.loading': '正在读取卡片…',
  'cards.noPeople': '还没有人物卡。',
  'cards.noWorld': '还没有世界书条目。',
  'cards.title': '卡片标题',
  'cards.refCount': '{count} 处引用',
  'cards.refsEllipsis': '引用…',
  'cards.refs': '引用',
  'cards.noRefs': '正文中还没有引用。',
  'cards.refsCapped': '引用结果已达上限。',
  'cards.refLine': '第 {line} 行 · {excerpt}',
  'cards.staleReread': '磁盘文件已经变化，已重新读取。',
  'cards.saved': '卡片字段已保存。',
  'cards.personDetail': '人物卡详情',
  'cards.worldDetail': '世界书详情',
  'cards.closeDetail': '关闭卡片详情',
  'cards.name': '姓名',
  'cards.aliases': '别名',
  'cards.commaSep': '逗号分隔',
  'cards.gender': '性别',
  'cards.age': '年龄',
  'cards.faction': '势力',
  'cards.status': '状态',
  'cards.relations': '关系',
  'cards.relationTo': '对象',
  'cards.relationToAria': '关系对象 {n}',
  'cards.relationKindAria': '关系类型 {n}',
  'cards.removeShort': '删',
  'cards.addRelation': '添加关系',
  'cards.summary': '摘要',
  'cards.categoryAria': '世界书分类',
  'cards.uncategorized': '未分类',
  'cards.customCategory': '自定义分类',
  'cards.openDoc': '打开正文',
  'cards.saveBeforeRef': '请先保存当前文档，再跳转引用。',
  'cards.ungrouped': '未分组',
  'cards.other': '其他',
  'cards.category.place': '地点',
  'cards.category.faction': '势力',
  'cards.category.item': '物品',
  'cards.category.rule': '规则',
  'cards.category.history': '历史',
  'cards.category.other': '其他',
  'command.cardsCharacter': '人物卡',
  'command.cardsCharacterHint': 'Ctrl+Shift+C · 人物列表与字段',
  'command.cardsWorldbook': '世界书',
  'command.cardsWorldbookHint': 'Ctrl+Shift+W · 设定列表与字段',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.create': '创建',
  'common.save': '保存',
  'common.saving': '保存中…',
  'common.custom': '自定义',
  'pin.beside': '钉在旁边',
  'pin.unpin': '取消钉住',
  'error.diskChanged': '磁盘上的文件已变化，请重新读取后再试。',
  'error.notFound': '未找到该文件。',
  'error.sessionMissing': '会话已失效，请重新打开作品。',
  'error.generic': '操作未能完成，请重试。',
} as const

export const en: Record<MessageKey, string> = {
  'cards.truncated': 'There are many cards, so the list was truncated.',
  'cards.characters': 'Characters',
  'cards.worldbook': 'Worldbook',
  'cards.kind': 'Card type',
  'cards.person': 'Character',
  'cards.setting': 'Lore',
  'cards.filterPeople': 'Filter by name, alias, or tag',
  'cards.filterWorld': 'Filter by title, trigger, or tag',
  'cards.filter': 'Filter cards',
  'cards.sort': 'Sort',
  'cards.sortName': 'By name',
  'cards.sortModified': 'By modified',
  'cards.sortRole': 'By role',
  'cards.sortCategory': 'By category',
  'cards.newPerson': 'New character',
  'cards.newSetting': 'New lore card',
  'cards.role': 'Role',
  'cards.category': 'Category',
  'cards.tags': 'Tags',
  'cards.loading': 'Loading cards…',
  'cards.noPeople': 'No character cards yet.',
  'cards.noWorld': 'No worldbook entries yet.',
  'cards.title': 'Card title',
  'cards.refCount': '{count} references',
  'cards.refsEllipsis': 'Refs…',
  'cards.refs': 'References',
  'cards.noRefs': 'No references in the manuscript yet.',
  'cards.refsCapped': 'Reference results hit the cap.',
  'cards.refLine': 'Line {line} · {excerpt}',
  'cards.staleReread': 'The file on disk changed and was reloaded.',
  'cards.saved': 'Card fields saved.',
  'cards.personDetail': 'Character details',
  'cards.worldDetail': 'Worldbook details',
  'cards.closeDetail': 'Close card details',
  'cards.name': 'Name',
  'cards.aliases': 'Aliases',
  'cards.commaSep': 'Comma-separated',
  'cards.gender': 'Gender',
  'cards.age': 'Age',
  'cards.faction': 'Faction',
  'cards.status': 'Status',
  'cards.relations': 'Relations',
  'cards.relationTo': 'Target',
  'cards.relationToAria': 'Relation target {n}',
  'cards.relationKindAria': 'Relation type {n}',
  'cards.removeShort': 'Del',
  'cards.addRelation': 'Add relation',
  'cards.summary': 'Summary',
  'cards.categoryAria': 'Worldbook category',
  'cards.uncategorized': 'Uncategorized',
  'cards.customCategory': 'Custom category',
  'cards.openDoc': 'Open document',
  'cards.saveBeforeRef': 'Save the current document before jumping to a reference.',
  'cards.ungrouped': 'Ungrouped',
  'cards.other': 'Other',
  'cards.category.place': 'Place',
  'cards.category.faction': 'Faction',
  'cards.category.item': 'Item',
  'cards.category.rule': 'Rule',
  'cards.category.history': 'History',
  'cards.category.other': 'Other',
  'command.cardsCharacter': 'Characters',
  'command.cardsCharacterHint': 'Ctrl+Shift+C · character list and fields',
  'command.cardsWorldbook': 'Worldbook',
  'command.cardsWorldbookHint': 'Ctrl+Shift+W · lore list and fields',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.create': 'Create',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.custom': 'Custom',
  'pin.beside': 'Pin beside',
  'pin.unpin': 'Unpin',
  'error.diskChanged': 'The file on disk changed. Read it again, then retry.',
  'error.notFound': 'That file was not found.',
  'error.sessionMissing': 'The session is gone. Open the work again.',
  'error.generic': 'The action could not finish. Try again.',
}

const dictionaries: Record<ShellLocale, Record<MessageKey, string>> = { zh, en }

let currentLocale: ShellLocale = 'zh'

export function setCardsLocale(locale: ShellLocale): void {
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
