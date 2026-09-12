import { describe, expect, it } from 'vitest'
import { apply } from './client.ts'
import {
  dockEscapeKeyDown,
  guardImeEnter,
  hostComponentsFromRenderProps,
  IME_KEYCODE,
  zhihuQueryKeyDown,
} from './client-host-ui.ts'

function MockSelect() { return null }
function MockDialog() { return null }

function reactKey(partial: {
  key?: string
  isComposing?: boolean
  keyCode?: number
  nativeIsComposing?: boolean
  nativeKeyCode?: number
}) {
  const prevented: string[] = []
  return {
    key: partial.key,
    isComposing: partial.isComposing,
    keyCode: partial.keyCode,
    nativeEvent: { isComposing: partial.nativeIsComposing, keyCode: partial.nativeKeyCode },
    preventDefault() { prevented.push('default') },
    stopPropagation() { prevented.push('stop') },
    prevented,
  }
}

describe('public zhihu host compatibility', () => {
  it('extracts structural Select/Dialog from the slot owner without private imports', () => {
    expect(hostComponentsFromRenderProps({ Select: MockSelect, Dialog: MockDialog })).toEqual({
      Select: MockSelect,
      Dialog: MockDialog,
    })
    expect(hostComponentsFromRenderProps({ owner: { Select: MockSelect, Dialog: MockDialog } })).toEqual({
      Select: MockSelect,
      Dialog: MockDialog,
    })
  })

  it('query consumer ignores synthetic isComposing and blocks native IME Enter/229', () => {
    const searches: string[] = []
    const lying = reactKey({ key: 'Enter', isComposing: true, keyCode: 13, nativeIsComposing: false, nativeKeyCode: 13 })
    zhihuQueryKeyDown(lying, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go'])

    const composing = reactKey({ key: 'Enter', nativeIsComposing: true, nativeKeyCode: 13 })
    zhihuQueryKeyDown(composing, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go'])
    expect(composing.prevented).toContain('default')

    const ime229 = reactKey({ key: 'Enter', nativeKeyCode: IME_KEYCODE })
    zhihuQueryKeyDown(ime229, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go'])
    expect(guardImeEnter(ime229)).toBe(true)

    const normal = reactKey({ key: 'Enter', nativeIsComposing: false, nativeKeyCode: 13 })
    zhihuQueryKeyDown(normal, { disabled: false, search: () => searches.push('go') })
    expect(searches).toEqual(['go', 'go'])
  })

  it('standalone Escape does not close while loading', () => {
    const closes: string[] = []
    dockEscapeKeyDown(reactKey({ key: 'Escape' }), { loading: true, close: () => closes.push('x') })
    expect(closes).toEqual([])
    dockEscapeKeyDown(reactKey({ key: 'Escape' }), { loading: false, close: () => closes.push('x') })
    expect(closes).toEqual(['x'])
  })

  it('the overlay renderer accepts host refs and remains self-contained without them', () => {
    const renders: Array<(props: unknown) => { props: Record<string, unknown> }> = []
    const injected: string[] = []
    const credentials = {
      describe: async () => ({ ok: true as const, value: {} }),
      set: async () => ({ ok: true as const, value: undefined }),
      unset: async () => ({ ok: true as const, value: undefined }),
    }
    const ctx = {
      effect(fn: () => (() => void) | void) { fn() },
      slots: {
        inject(key: string, callback: () => unknown) {
          injected.push(key)
          callback()
          return () => {}
        },
        register(_spec: unknown, render: unknown) {
          renders.push(render as (typeof renders)[number])
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({}) } },
      remote: { credentials },
    }
    apply(ctx as never)
    expect(injected).toEqual(['shell.overlay', 'dsh-editor.settings.zhihu'])
    expect(injected).not.toContain('dsh-editor.extensions')
    expect(renders.length).toBe(2)
    const standalone = renders[0]!({})
    expect(standalone.props.surface).toBe('overlay')
    expect(standalone.props.Select).toBeUndefined()
    expect(standalone.props.Dialog).toBeUndefined()
    const hosted = renders[0]!({ Select: MockSelect, Dialog: MockDialog })
    expect(hosted.props.Select).toBe(MockSelect)
    expect(hosted.props.Dialog).toBe(MockDialog)
    const settings = renders[1]!({ Select: MockSelect, Dialog: MockDialog })
    expect(settings.props.surface).toBe('settings')
    expect(settings.props.Select).toBe(MockSelect)
    expect(settings.props.Dialog).toBeUndefined()
  })
})
