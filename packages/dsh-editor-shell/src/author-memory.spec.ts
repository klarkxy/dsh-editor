import { describe, expect, it } from 'vitest'
import { AUTHOR_MEMORY_AUTO_MARKER, appendAuthorMemory } from './author-memory.ts'

describe('appendAuthorMemory', () => {
  it('appends the first entry under the auto marker, keeping legacy text as handwritten head', () => {
    const next = appendAuthorMemory('留白优先\n不写直接心理', '偏好短句', 2_000)
    expect(next).toBe(`留白优先\n不写直接心理\n${AUTHOR_MEMORY_AUTO_MARKER}\n偏好短句`)
  })

  it('starts from an empty value without a handwritten head', () => {
    expect(appendAuthorMemory('', '偏好短句', 2_000)).toBe(`${AUTHOR_MEMORY_AUTO_MARKER}\n偏好短句`)
  })

  it('appends later entries after earlier ones', () => {
    const first = appendAuthorMemory('', '留白优先', 2_000)!
    const second = appendAuthorMemory(first, '雷点：误会拖过三章', 2_000)
    expect(second).toBe(`${AUTHOR_MEMORY_AUTO_MARKER}\n留白优先\n雷点：误会拖过三章`)
  })

  it('collapses newlines inside one observation into a single line', () => {
    const next = appendAuthorMemory('', '留白优先\n\n不写直接心理', 2_000)
    expect(next).toBe(`${AUTHOR_MEMORY_AUTO_MARKER}\n留白优先 不写直接心理`)
  })

  it('ignores empty observations and exact duplicates', () => {
    expect(appendAuthorMemory('', '   ', 2_000)).toBeUndefined()
    const first = appendAuthorMemory('', '留白优先', 2_000)!
    expect(appendAuthorMemory(first, '留白优先', 2_000)).toBeUndefined()
  })

  it('evicts the oldest auto entries first when over capacity', () => {
    const head = '手写内容'
    const first = appendAuthorMemory(head, '第一条', 2_000)!
    const second = appendAuthorMemory(first, '第二条', 2_000)!
    const cap = `${head}\n${AUTHOR_MEMORY_AUTO_MARKER}\n第二条\n第三条`.length
    const third = appendAuthorMemory(second, '第三条', cap)
    expect(third).toBe(`${head}\n${AUTHOR_MEMORY_AUTO_MARKER}\n第二条\n第三条`)
  })

  it('never touches the handwritten head, even when it alone nearly reaches the cap', () => {
    const head = 'x'.repeat(1_965)
    const first = appendAuthorMemory(head, '第一条', 2_000)!
    expect(first).toBe(`${head}\n${AUTHOR_MEMORY_AUTO_MARKER}\n第一条`)
    const second = appendAuthorMemory(first, '第二条', 2_000)
    expect(second).toBe(`${head}\n${AUTHOR_MEMORY_AUTO_MARKER}\n第二条`)
    const third = appendAuthorMemory(second, '第三条', 2_000)
    expect(third).toBe(`${head}\n${AUTHOR_MEMORY_AUTO_MARKER}\n第三条`)
  })

  it('drops the new entry when even an empty auto section cannot fit it', () => {
    const head = 'x'.repeat(2_000)
    expect(appendAuthorMemory(head, '放不下', 2_000)).toBe(head)
  })
})
