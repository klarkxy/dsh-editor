import { createElement as e, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { cardsPromptKeyDown } from './dialog.ts'
import { guardImeEnter, renderSelect, IME_KEYCODE } from './host-ui.ts'
import type { ShellSelectProps } from 'dsh-editor-seats'

function MockSelect(props: ShellSelectProps) {
  return e('div', { 'data-host': 'select', 'aria-label': props['aria-label'] }, props.value)
}

function asElement(node: unknown): ReactElement<{ children?: unknown; 'aria-label'?: string; value?: string; disabled?: boolean }> {
  return node as ReactElement<{ children?: unknown; 'aria-label'?: string; value?: string; disabled?: boolean }>
}

describe('cards host UI helpers', () => {
  it('treats composing and keyCode 229 as IME, so Enter must not submit', () => {
    const prevented: string[] = []
    const preventDefault = () => { prevented.push('default') }
    expect(guardImeEnter({ key: 'Enter', preventDefault, nativeEvent: { isComposing: true, keyCode: 13 } })).toBe(true)
    expect(guardImeEnter({ key: 'Enter', preventDefault, nativeEvent: { isComposing: false, keyCode: IME_KEYCODE } })).toBe(true)
    expect(guardImeEnter({ key: 'Enter', preventDefault, nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false)
    expect(guardImeEnter({
      key: 'Enter',
      preventDefault,
      nativeEvent: { isComposing: false, keyCode: 13 },
    })).toBe(false)

    const consumerPrevented: string[] = []
    const consumer = {
      key: 'Enter',
      preventDefault() { consumerPrevented.push('default') },
      nativeEvent: { isComposing: true, keyCode: 13 },
    }
    expect(cardsPromptKeyDown(consumer)).toBe(true)
    expect(consumerPrevented).toEqual(['default'])
    expect(cardsPromptKeyDown({
      key: 'Enter',
      preventDefault() {},
      nativeEvent: { isComposing: false, keyCode: 13 },
    })).toBe(false)
  })

  it('uses the host Select when provided and a native select otherwise', () => {
    const props: ShellSelectProps = {
      value: 'title',
      options: [{ value: 'title', label: '按名称' }, { value: 'modified', label: '按修改' }],
      onChange() {},
      'aria-label': '排序',
    }
    const hosted = asElement(renderSelect(MockSelect, props))
    expect(hosted.type).toBe(MockSelect)
    expect(hosted.props['aria-label']).toBe('排序')
    expect(hosted.props.value).toBe('title')

    const native = asElement(renderSelect(undefined, props))
    expect(native.type).toBe('select')
    expect(native.props['aria-label']).toBe('排序')
    expect(native.props.value).toBe('title')
    const options = native.props.children as ReactElement[]
    expect(options.filter(Boolean).map((item) => item.props.value)).toEqual(['title', 'modified'])
  })
})
