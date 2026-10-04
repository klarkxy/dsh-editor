import { describe, expect, it } from 'vitest'
import type { PluginCard } from './contracts.ts'
import {
  authorFacingDescription,
  authorPluginError,
  enabledState,
  FEATURE_GROUP_DEFS,
  groupOptionalFeatures,
  isBuiltinCard,
  PLUGIN_LOCK_LABELS,
  pluginLockKind,
  toggleableCards,
} from './client-groups.ts'

function card(partial: Partial<PluginCard> & Pick<PluginCard, 'entryId' | 'packageName' | 'title'>): PluginCard {
  return {
    moduleName: partial.packageName,
    description: partial.description ?? partial.title,
    group: partial.group ?? 'optional',
    enabled: partial.enabled ?? true,
    locked: partial.locked ?? false,
    fiberPhase: partial.fiberPhase ?? 'active',
    origin: partial.origin ?? 'bundled',
    ...partial,
  }
}

describe('plugin feature grouping', () => {
  it('groups by author purpose instead of package name', () => {
    const views = groupOptionalFeatures([
      card({ entryId: 'include:zhihu', packageName: '@klarkxy/dsh-zhihu', title: '知乎资料' }),
      card({ entryId: 'include:zhihu-tools', packageName: '@klarkxy/dsh-zhihu', title: '知乎工具' }),
      card({ entryId: 'include:proofread', packageName: 'dsh-proofread', title: '校对', locked: true, group: 'core', managedBy: 'feature' }),
      card({ entryId: 'include:editor-proofread-panel', packageName: 'dsh-editor-proofread-panel', title: '作品校对' }),
      card({ entryId: 'include:editor-overview-panel', packageName: 'dsh-editor-overview-panel', title: '作品概览' }),
      card({ entryId: 'include:editor-workbench-tools', packageName: 'dsh-editor-workbench', title: '作品概览工具', locked: true, group: 'core' }),
      card({ entryId: 'include:manuscript-assist', packageName: 'dsh-manuscript', title: '补全服务' }),
      card({ entryId: 'include:editor-novel-kernel', packageName: 'dsh-editor-novel-kernel', title: '小说工具', locked: true, group: 'core', managedBy: 'session' }),
      card({ entryId: 'include:editor-cards', packageName: 'dsh-editor-cards', title: '人物卡与世界书', description: '卡片列表、frontmatter 编辑、引用导航与新建' }),
      card({ entryId: 'include:editor-memory-panel', packageName: 'dsh-editor-memory-panel', title: '记忆维护', description: '查看 AGENTS.md / 人物卡维护记录' }),
      card({ entryId: 'include:manuscript', packageName: 'dsh-manuscript', title: '稿纸', locked: true, group: 'core' }),
    ])
    expect(views.map((view) => view.id)).toEqual(['writing', 'proofread', 'overview', 'cards', 'memory', 'zhihu'])
    expect(views.find((view) => view.id === 'zhihu')?.cards.map((item) => item.entryId)).toEqual(['include:zhihu', 'include:zhihu-tools'])
    expect(views.find((view) => view.id === 'proofread')?.title).toBe('校对')
    expect(views.find((view) => view.id === 'overview')?.title).toBe('文档概览')
    expect(views.find((view) => view.id === 'writing')?.cards.map((item) => item.packageName)).toEqual(['dsh-manuscript'])
    expect(views.find((view) => view.id === 'proofread')?.cards.map((item) => item.packageName)).toEqual(['dsh-editor-proofread-panel'])
    expect(views.find((view) => view.id === 'overview')?.cards.map((item) => item.packageName)).toEqual(['dsh-editor-overview-panel'])
    expect(views.some((view) => view.cards.some((item) => item.packageName === 'dsh-editor-workbench' || item.packageName === 'dsh-editor-novel-kernel'))).toBe(false)
    expect(views.some((view) => view.cards.some((item) => item.locked))).toBe(false)
    expect(views.find((view) => view.id === 'memory')?.description).not.toMatch(/AGENTS\.md/)
    expect(views.find((view) => view.id === 'cards')?.description).not.toMatch(/frontmatter/i)
  })

  it('keeps community leftovers grouped by package', () => {
    const views = groupOptionalFeatures([
      card({ entryId: 'theme-a', packageName: 'community-theme', title: '纸', group: 'community', origin: 'installed' }),
      card({ entryId: 'theme-b', packageName: 'community-theme', title: '墨', group: 'community', origin: 'installed' }),
    ])
    expect(views).toHaveLength(1)
    expect(views[0]?.cards).toHaveLength(2)
  })

  it('strips internal terms from leftover descriptions', () => {
    expect(authorFacingDescription('卡片列表、frontmatter 编辑、引用导航')).toBe('卡片列表、编辑、引用导航')
    expect(authorFacingDescription('查看、应用 AGENTS.md / 人物卡')).toBe('查看、应用 人物卡')
  })

  it('is on only when every unlocked card is enabled, and skips locked cards when toggling', () => {
    const cards = [
      card({ entryId: 'a', packageName: 'p', title: 'A', enabled: true }),
      card({ entryId: 'b', packageName: 'p', title: 'B', enabled: false }),
      card({ entryId: 'c', packageName: 'p', title: 'C', locked: true, enabled: true }),
    ]
    expect(enabledState(cards)).toBe(false)
    expect(enabledState(cards.filter((item) => item.enabled))).toBe(true)
    expect(toggleableCards(cards).map((item) => item.entryId)).toEqual(['a', 'b'])
  })

  it('moves filesystem paths into expandable detail instead of the author message', () => {
    const wrapped = authorPluginError(
      "EPERM: operation not permitted, rename 'D:\\\\home\\\\cordis.patch.yml.1.tmp' -> 'D:\\\\home\\\\cordis.patch.yml'",
      '未能更新',
    )
    expect(wrapped.message).toBe('未能保存插件开关，请重试。')
    expect(wrapped.detail).toContain('EPERM')
    expect(FEATURE_GROUP_DEFS.some((def) => def.packages.includes('@klarkxy/dsh-zhihu'))).toBe(true)
  })
})

describe('builtin attribution and lock labels', () => {
  it('trusts only the exact builtin flag, never package name prefixes', () => {
    expect(isBuiltinCard(card({ entryId: 'a', packageName: 'dsh-editor-shell', title: 'A', builtin: true }))).toBe(true)
    expect(isBuiltinCard(card({ entryId: 'b', packageName: 'dsh-editor-counterfeit', title: 'B' }))).toBe(false)
    expect(isBuiltinCard(card({ entryId: 'c', packageName: 'dsh-editor-shell', title: 'C', builtin: false }))).toBe(false)
    expect(isBuiltinCard(card({ entryId: 'd', packageName: '@klarkxy/dsh-zhihu', title: 'D' }))).toBe(false)
  })

  it('labels session, feature, and plain required locks honestly', () => {
    expect(PLUGIN_LOCK_LABELS.session).toBe('由会话控制')
    expect(PLUGIN_LOCK_LABELS.feature).toBe('由校对功能管理')
    expect(PLUGIN_LOCK_LABELS.required).toBe('必需')
    expect(pluginLockKind(card({ entryId: 's', packageName: 'p', title: 'S', locked: true, managedBy: 'session' }))).toBe('session')
    expect(pluginLockKind(card({ entryId: 'f', packageName: 'p', title: 'F', locked: true, managedBy: 'feature' }))).toBe('feature')
    expect(pluginLockKind(card({ entryId: 'r', packageName: 'p', title: 'R', locked: true }))).toBe('required')
    expect(pluginLockKind(card({ entryId: 'u', packageName: 'p', title: 'U', managedBy: 'session' }))).toBe('session')
  })
})
