import { describe, expect, it } from 'vitest'
import { createLessonInjectionMessage, injectLessonMessages, isSelfImprovementLessonMessage, lessonInjectPayload } from './inject.ts'
import { lesson } from './fakes.ts'
import { LESSON_INJECTION_SECTION, SELF_IMPROVEMENT_PLUGIN } from './contracts.ts'

const active = lesson({ id: 'a', title: 'here', content: 'keep paths relative', status: 'active', scope: { kind: 'project', projectId: '/a' } })

describe('injection marking', () => {
  it('drops our snapshot when there is nothing injectable and keeps startsRequestSeries', () => {
    const marked = injectLessonMessages({ kind: 'enter', messages: [], startsRequestSeries: true }, [active])
    const cleared = injectLessonMessages(marked, [])
    expect(cleared.kind).toBe('enter')
    if (cleared.kind !== 'enter') return
    expect(cleared.startsRequestSeries).toBe(true)
    expect(cleared.messages).toEqual([])
  })

  it('creates a frozen native user message with a unique id and snapshot section', () => {
    const first = createLessonInjectionMessage([active]) as {
      id: string; role: string; content: Array<{ type: string; text: string }>
      source: { kind: string; plugin: string; form: string; sections: Array<{ name: string; text: string }> }
    }
    const second = createLessonInjectionMessage([active]) as { id: string }
    expect(first.role).toBe('user')
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(second.id).not.toBe(first.id)
    expect(first.source).toEqual(lessonInjectPayload([active]).source)
    expect(first.source.kind).toBe('plugin:@klarkxy/dsh-self-improvement')
    expect(first.source.plugin).toBe(SELF_IMPROVEMENT_PLUGIN)
    expect(isSelfImprovementLessonMessage({ ...first, source: { ...first.source, kind: 'plugin' } })).toBe(false)
    expect(first.source.form).toBe('snapshot')
    expect(first.source.sections[0]?.name).toBe(LESSON_INJECTION_SECTION)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.content)).toBe(true)
    expect(Object.isFrozen(first.source)).toBe(true)
    expect(isSelfImprovementLessonMessage(first)).toBe(true)
    expect(() => { (first as { role: string }).role = 'assistant' }).toThrow()
  })
})
