import type { PluginGroup } from './contracts.ts'

/** Bundled product packages that may never be uninstalled. Keep in sync with apps/desktop/src/user-plugins.ts. */
export const PROTECTED_PACKAGES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-manuscript',
  'dsh-proofread',
  'dsh-editor-workbench',
  'dsh-editor-novel-kernel',
  'dsh-zhihu',
  'dsh-editor-shell',
  'dsh-editor-plugins',
] as const

export const CORE_ENTRY_IDS = ['manuscript', 'editor-workbench', 'editor-shell', 'editor-plugins'] as const

export const OPTIONAL_ENTRY_IDS = [
  'proofread',
  'manuscript-assist',
  'editor-workbench-tools',
  'editor-novel-kernel',
  'zhihu',
  'zhihu-tools',
] as const

const PROTECTED_PACKAGE_SET = new Set<string>(PROTECTED_PACKAGES)
const CORE_ENTRY_SET = new Set<string>(CORE_ENTRY_IDS)
const OPTIONAL_ENTRY_SET = new Set<string>(OPTIONAL_ENTRY_IDS)

export type CatalogEntry = {
  title: string
  description: string
  group: PluginGroup
}

export const ENTRY_CATALOG: Record<string, CatalogEntry> = {
  manuscript: { title: '稿纸', description: '正文读写、草稿与补全', group: 'core' },
  'editor-workbench': { title: '工作台', description: '作品目录、概览、卡片与快照', group: 'core' },
  'editor-shell': { title: '写作界面', description: '三栏稿纸与设置', group: 'core' },
  'editor-plugins': { title: '插件管理', description: '开关、搜索与安装插件', group: 'core' },
  proofread: { title: '校对', description: '独立文本校对面板', group: 'optional' },
  'manuscript-assist': { title: '补全服务', description: '行内补全与选段改写', group: 'optional' },
  'editor-workbench-tools': { title: '作品概览工具', description: '供写作搭档读取作品概览', group: 'optional' },
  'editor-novel-kernel': { title: '小说工具', description: '提案、知识卡与写作搭档工具', group: 'optional' },
  zhihu: { title: '知乎资料', description: '知乎搜索、知识库与用量', group: 'optional' },
  'zhihu-tools': { title: '知乎工具', description: '供写作搭档调用的知乎检索', group: 'optional' },
}

const ENTRY_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

export function isSafeEntryId(value: string): boolean {
  return ENTRY_ID_PATTERN.test(value) && value.length <= 80
}

export function isSafePackageName(value: string): boolean {
  return PACKAGE_NAME_PATTERN.test(value) && value.length <= 120 && !value.includes('..')
}

export function packageNameOf(moduleName: string): string {
  const trimmed = moduleName.trim()
  if (trimmed.startsWith('@')) {
    const parts = trimmed.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : trimmed
  }
  return trimmed.split('/')[0] ?? trimmed
}

export function isProtectedPackage(name: string): boolean {
  return PROTECTED_PACKAGE_SET.has(name) || name.startsWith('@deepseek-ai/')
}

export function isProtectedEntry(entryId: string, moduleName: string): boolean {
  if (CORE_ENTRY_SET.has(entryId)) return true
  if (OPTIONAL_ENTRY_SET.has(entryId)) return false
  return isProtectedPackage(packageNameOf(moduleName))
}

export function classifyEntry(entryId: string, moduleName: string): PluginGroup | 'hidden' {
  const catalog = ENTRY_CATALOG[entryId]
  if (catalog) return catalog.group
  if (moduleName.startsWith('@deepseek-ai/')) return 'hidden'
  if (isProtectedPackage(packageNameOf(moduleName))) return 'hidden'
  return 'community'
}

export function catalogFor(entryId: string, moduleName: string): CatalogEntry {
  const catalog = ENTRY_CATALOG[entryId]
  if (catalog) return catalog
  const short = packageNameOf(moduleName)
  return { title: short, description: moduleName, group: classifyEntry(entryId, moduleName) === 'community' ? 'community' : 'core' }
}
