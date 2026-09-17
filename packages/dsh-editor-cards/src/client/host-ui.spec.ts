import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest'
import { cardsPromptKeyDown } from './dialog.tsx'
import { guardImeEnter, renderInput, renderSelect, IME_KEYCODE } from './host-ui.tsx'
import type { ShellInputProps, ShellSelectProps } from 'dsh-editor-seats'

function MockSelect(props: ShellSelectProps) {
  return createElement('div', { 'data-host': 'select', 'aria-label': props['aria-label'] }, props.value)
}

function MockInput(props: ShellInputProps) {
  return createElement('div', { 'data-host': 'input', 'aria-label': props['aria-label'] }, props.value)
}

function asElement(node: unknown): ReactElement<{ children?: unknown; 'aria-label'?: string; value?: string; disabled?: boolean; placeholder?: string }> {
  return node as ReactElement<{ children?: unknown; 'aria-label'?: string; value?: string; disabled?: boolean; placeholder?: string }>
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
    const options = (Array.isArray(native.props.children) ? native.props.children : [native.props.children])
      .flat()
      .filter(Boolean) as ReactElement<{ value?: string }>[]
    expect(options.map((item) => item.props.value)).toEqual(['title', 'modified'])
  })

  it('uses the host Input when provided and a native input otherwise', () => {
    const props: ShellInputProps = {
      value: '港口',
      onChange() {},
      'aria-label': '筛选',
      placeholder: '按名称',
    }
    const hosted = asElement(renderInput(MockInput, props))
    expect(hosted.type).toBe(MockInput)
    expect(hosted.props['aria-label']).toBe('筛选')
    expect(hosted.props.value).toBe('港口')

    const native = asElement(renderInput(undefined, props))
    expect(native.type).toBe('input')
    expect(native.props['aria-label']).toBe('筛选')
    expect(native.props.value).toBe('港口')
    expect(native.props.placeholder).toBe('按名称')
  })
})
