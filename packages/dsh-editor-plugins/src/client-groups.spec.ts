import { describe, expect, it } from 'vitest'
import type { PluginCard } from './contracts.ts'
import {
  authorFacingDescription,
  authorPluginError,
  enabledState,
  FEATURE_GROUP_DEFS,
  groupOptionalFeatures,
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
      card({ entryId: 'include:zhihu', packageName: 'dsh-zhihu', title: '知乎资料' }),
      card({ entryId: 'include:zhihu-tools', packageName: 'dsh-zhihu', title: '知乎工具' }),
      card({ entryId: 'include:proofread', packageName: 'dsh-proofread', title: '校对' }),
      card({ entryId: 'include:editor-proofread-panel', packageName: 'dsh-editor-proofread-panel', title: '作品校对' }),
      card({ entryId: 'include:editor-overview-panel', packageName: 'dsh-editor-overview-panel', title: '作品概览' }),
      card({ entryId: 'include:editor-workbench-tools', packageName: 'dsh-editor-workbench', title: '作品概览工具' }),
      card({ entryId: 'include:manuscript-assist', packageName: 'dsh-manuscript', title: '补全服务' }),
      card({ entryId: 'include:editor-novel-kernel', packageName: 'dsh-editor-novel-kernel', title: '小说工具' }),
      card({ entryId: 'include:editor-cards', packageName: 'dsh-editor-cards', title: '人物卡与世界书', description: '卡片列表、frontmatter 编辑、引用导航与新建' }),
      card({ entryId: 'include:editor-memory-panel', packageName: 'dsh-editor-memory-panel', title: '记忆维护', description: '查看 AGENTS.md / 人物卡维护记录' }),
      card({ entryId: 'include:manuscript', packageName: 'dsh-manuscript', title: '稿纸', locked: true, group: 'core' }),
    ])
    expect(views.map((view) => view.id)).toEqual(['writing', 'proofread', 'overview', 'cards', 'memory', 'zhihu'])
    expect(views.find((view) => view.id === 'zhihu')?.cards.map((item) => item.entryId)).toEqual(['include:zhihu', 'include:zhihu-tools'])
    expect(views.find((view) => view.id === 'proofread')?.title).toBe('校对')
    expect(views.find((view) => view.id === 'overview')?.title).toBe('作品概览')
    expect(views.find((view) => view.id === 'writing')?.cards).toHaveLength(2)
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

  it('reports mixed enablement and skips locked cards when toggling', () => {
    const cards = [
      card({ entryId: 'a', packageName: 'p', title: 'A', enabled: true }),
      card({ entryId: 'b', packageName: 'p', title: 'B', enabled: false }),
      card({ entryId: 'c', packageName: 'p', title: 'C', locked: true, enabled: true }),
    ]
    expect(enabledState(cards)).toBe('mixed')
    expect(toggleableCards(cards).map((item) => item.entryId)).toEqual(['a', 'b'])
  })

  it('moves filesystem paths into expandable detail instead of the author message', () => {
    const wrapped = authorPluginError(
      "EPERM: operation not permitted, rename 'D:\\\\home\\\\cordis.patch.yml.1.tmp' -> 'D:\\\\home\\\\cordis.patch.yml'",
      '未能更新',
    )
    expect(wrapped.message).toBe('未能保存插件开关，请重试。')
    expect(wrapped.detail).toContain('EPERM')
    expect(FEATURE_GROUP_DEFS.some((def) => def.packages.includes('dsh-zhihu'))).toBe(true)
  })
})
