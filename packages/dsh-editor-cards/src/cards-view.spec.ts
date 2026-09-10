import { describe, expect, it } from 'vitest'
import type { CardReferenceHit, CharacterCard, WorldbookCard } from './contracts.ts'
import {
  UNGROUPED_CATEGORY,
  UNGROUPED_ROLE,
  characterMatchTerms,
  collectCharacterRoles,
  collectTags,
  collectWorldbookCategories,
  filterCharacterCards,
  filterWorldbookCards,
  groupCharacterCards,
  groupReferencesByChapter,
  groupWorldbookCards,
  relationEdges,
  resolveRelationTarget,
  sortCharacterCards,
  sortWorldbookCards,
  toggleFilterValue,
  visibleCharacterCards,
  visibleWorldbookCards,
} from './cards-view.ts'

function character(path: string, extra: Partial<CharacterCard> = {}, frontmatter: CharacterCard['frontmatter'] = {}): CharacterCard {
  return {
    path,
    title: extra.title ?? path.replace(/^人物卡\//, '').replace(/\.md$/i, ''),
    frontmatter,
    summary: extra.summary ?? '',
    version: extra.version ?? '1',
    modifiedAt: extra.modifiedAt ?? null,
    ...extra,
  }
}

function worldbook(path: string, extra: Partial<WorldbookCard> = {}, frontmatter: WorldbookCard['frontmatter'] = {}): WorldbookCard {
  return {
    path,
    title: extra.title ?? path.replace(/^世界书\//, '').replace(/\.md$/i, ''),
    frontmatter: { enabled: true, priority: 0, ...frontmatter },
    summary: extra.summary ?? '',
    version: extra.version ?? '1',
    modifiedAt: extra.modifiedAt ?? null,
    ...extra,
  }
}

function hit(path: string, start: number, extra: Partial<CardReferenceHit> = {}): CardReferenceHit {
  return { path, line: 1, column: start + 1, start, end: start + 2, excerpt: '摘录', ...extra }
}

describe('cards view helpers', () => {
  it('groups characters by role and worldbook by category, with empty keys last', () => {
    const grouped = groupCharacterCards([
      character('人物卡/丙.md', { title: '丙' }, { role: '配角' }),
      character('人物卡/甲.md', { title: '甲' }),
      character('人物卡/乙.md', { title: '乙' }, { role: '主角' }),
    ])
    expect(grouped.map((group) => group.key)).toEqual(['配角', '主角', UNGROUPED_ROLE])
    expect(grouped.at(-1)?.cards.map((card) => card.title)).toEqual(['甲'])

    const settings = groupWorldbookCards([
      worldbook('世界书/港.md', { title: '港' }, { category: '地点' }),
      worldbook('世界书/律.md', { title: '律' }),
      worldbook('世界书/刀.md', { title: '刀' }, { category: '物品' }),
    ])
    expect(settings.map((group) => group.key)).toEqual(['地点', '物品', UNGROUPED_CATEGORY])
  })

  it('filters by text, role/category chips, and tags', () => {
    const people = [
      character('人物卡/林见.md', { title: '林见', summary: '北城巡卫' }, { role: '主角', faction: '巡卫', tags: ['刀客'] }),
      character('人物卡/阿秀.md', { title: '阿秀' }, { role: '配角', aliases: ['秀姐'], tags: ['医者'] }),
    ]
    expect(filterCharacterCards(people, { text: '巡卫', roles: [], tags: [] }).map((card) => card.title)).toEqual(['林见'])
    expect(filterCharacterCards(people, { text: '秀姐', roles: [], tags: [] }).map((card) => card.title)).toEqual(['阿秀'])
    expect(filterCharacterCards(people, { text: '', roles: ['主角'], tags: [] }).map((card) => card.title)).toEqual(['林见'])
    expect(filterCharacterCards(people, { text: '', roles: [UNGROUPED_ROLE], tags: [] })).toEqual([])
    expect(filterCharacterCards(people, { text: '', roles: [], tags: ['医者'] }).map((card) => card.title)).toEqual(['阿秀'])

    const entries = [
      worldbook('世界书/港口.md', { title: '港口' }, { category: '地点', tags: ['水路'], triggers: ['海关'] }),
      worldbook('世界书/禁咒.md', { title: '禁咒' }, { category: '规则', tags: ['法术'] }),
    ]
    expect(filterWorldbookCards(entries, { text: '海关', categories: [], tags: [] }).map((card) => card.title)).toEqual(['港口'])
    expect(filterWorldbookCards(entries, { text: '', categories: ['规则'], tags: [] }).map((card) => card.title)).toEqual(['禁咒'])
    expect(filterWorldbookCards(entries, { text: '', categories: [], tags: ['水路'] }).map((card) => card.title)).toEqual(['港口'])
    expect(collectCharacterRoles(people)).toEqual(['配角', '主角'])
    expect(collectWorldbookCategories(entries)).toEqual(['地点', '规则'])
    expect(collectTags(people)).toEqual(['刀客', '医者'])
    expect(toggleFilterValue(['主角'], '配角')).toEqual(['主角', '配角'])
    expect(toggleFilterValue(['主角'], '主角')).toEqual([])
  })

  it('sorts by title, role/category, and modified time', () => {
    const people = [
      character('人物卡/乙.md', { title: '乙', modifiedAt: '2026-01-01T00:00:00.000Z' }, { role: '配角' }),
      character('人物卡/甲.md', { title: '甲', modifiedAt: '2026-02-01T00:00:00.000Z' }, { role: '主角' }),
    ]
    expect(sortCharacterCards(people, 'title').map((card) => card.title)).toEqual(['甲', '乙'])
    expect(sortCharacterCards(people, 'role').map((card) => card.title)).toEqual(['乙', '甲'])
    expect(sortCharacterCards(people, 'modified').map((card) => card.title)).toEqual(['甲', '乙'])
    expect(visibleCharacterCards(people, { text: '', roles: ['主角'], tags: [], sort: 'title' }).map((card) => card.title)).toEqual(['甲'])

    const entries = [
      worldbook('世界书/刀.md', { title: '刀', modifiedAt: '2026-01-01T00:00:00.000Z' }, { category: '物品' }),
      worldbook('世界书/城.md', { title: '城', modifiedAt: '2026-03-01T00:00:00.000Z' }, { category: '地点' }),
    ]
    expect(sortWorldbookCards(entries, 'title').map((card) => card.title)).toEqual(
      [...entries].sort((left, right) => left.title.localeCompare(right.title, 'zh-CN', { numeric: true, sensitivity: 'base' })).map((card) => card.title),
    )
    expect(sortWorldbookCards(entries, 'category').map((card) => `${card.frontmatter.category}:${card.title}`)).toEqual(['地点:城', '物品:刀'])
    expect(sortWorldbookCards(entries, 'modified').map((card) => card.title)).toEqual(['城', '刀'])
    expect(visibleWorldbookCards(entries, { text: '', categories: ['地点'], tags: [] }).map((card) => card.title)).toEqual(['城'])
  })

  it('resolves relation links by name, alias, or title and flattens edges', () => {
    const people = [
      character('人物卡/林见.md', { title: '林见' }, { name: '林见', aliases: ['巡卫林'] }),
      character('人物卡/阿秀.md', { title: '阿秀' }, {
        name: '陈秀',
        relations: [{ to: '巡卫林', kind: '旧识' }, { to: '不存在', kind: '传闻' }],
      }),
    ]
    expect(characterMatchTerms(people[0]!)).toEqual(['林见', '巡卫林'])
    expect(resolveRelationTarget('巡卫林', people)?.path).toBe('人物卡/林见.md')
    expect(resolveRelationTarget('陈秀', people)?.path).toBe('人物卡/阿秀.md')
    expect(resolveRelationTarget('阿秀', people)?.path).toBe('人物卡/阿秀.md')
    expect(resolveRelationTarget('没有', people)).toBeUndefined()
    expect(relationEdges(people)).toEqual([
      { fromPath: '人物卡/阿秀.md', fromTitle: '阿秀', to: '巡卫林', kind: '旧识', targetPath: '人物卡/林见.md', targetTitle: '林见' },
      { fromPath: '人物卡/阿秀.md', fromTitle: '阿秀', to: '不存在', kind: '传闻', targetPath: null, targetTitle: null },
    ])
  })

  it('groups reference hits by chapter path and keeps hit order inside each file', () => {
    expect(groupReferencesByChapter([
      hit('正文/第二卷/002.md', 40, { line: 8 }),
      hit('正文/001.md', 12, { line: 3 }),
      hit('正文/001.md', 4, { line: 1 }),
    ])).toEqual([
      {
        path: '正文/001.md',
        title: '001',
        hits: [
          hit('正文/001.md', 4, { line: 1 }),
          hit('正文/001.md', 12, { line: 3 }),
        ],
      },
      {
        path: '正文/第二卷/002.md',
        title: '第二卷/002',
        hits: [hit('正文/第二卷/002.md', 40, { line: 8 })],
      },
    ])
  })
})
