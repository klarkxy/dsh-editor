import { describe, expect, it } from 'vitest'
import { apply } from './client.ts'
import {
  dockEscapeKeyDown,
  guardImeEnter,
  hostComponentsFromRenderProps,
  IME_KEYCODE,
  nativeKeyFlags,
  proofreadInputKeyDown,
} from './client-host-ui.ts'

function MockSelect() { return null }
function MockDialog() { return null }

function reactKey(partial: {
  key?: string
  ctrlKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
  keyCode?: number
  nativeIsComposing?: boolean
  nativeKeyCode?: number
}) {
  const prevented: string[] = []
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey,
    metaKey: partial.metaKey,
    isComposing: partial.isComposing,
    keyCode: partial.keyCode,
    nativeEvent: { isComposing: partial.nativeIsComposing, keyCode: partial.nativeKeyCode },
    preventDefault() { prevented.push('default') },
    stopPropagation() { prevented.push('stop') },
    prevented,
  }
}

describe('public proofread host compatibility', () => {
  it('extracts structural Select/Dialog from the slot owner without private imports', () => {
    expect(hostComponentsFromRenderProps({ owner: { Select: MockSelect, Dialog: MockDialog } })).toEqual({
      Select: MockSelect,
      Dialog: MockDialog,
    })
  })

  it('reads composing and keyCode from nativeEvent, not the synthetic event', () => {
    expect(nativeKeyFlags({ nativeEvent: { isComposing: true, keyCode: 13 } })).toEqual({ isComposing: true, keyCode: 13 })
    const lyingSynthetic = reactKey({
      key: 'Enter',
      isComposing: true,
      keyCode: 13,
      nativeIsComposing: false,
      nativeKeyCode: 13,
    })
    expect(guardImeEnter(lyingSynthetic)).toBe(false)
    expect(lyingSynthetic.prevented).toEqual([])
  })

  it('proofread input consumer blocks IME Enter/229 and still runs Ctrl+Enter', () => {
    const runs: string[] = []
    const composingEnter = reactKey({ key: 'Enter', nativeIsComposing: true, nativeKeyCode: 13, ctrlKey: true })
    proofreadInputKeyDown(composingEnter, { disabled: false, runCheck: () => runs.push('check') })
    expect(runs).toEqual([])
    expect(composingEnter.prevented).toContain('default')

    const ime229 = reactKey({ key: 'Enter', nativeIsComposing: false, nativeKeyCode: IME_KEYCODE, ctrlKey: true })
    proofreadInputKeyDown(ime229, { disabled: false, runCheck: () => runs.push('check') })
    expect(runs).toEqual([])
    expect(ime229.prevented).toContain('default')

    const ctrlEnter = reactKey({ key: 'Enter', ctrlKey: true, nativeIsComposing: false, nativeKeyCode: 13 })
    proofreadInputKeyDown(ctrlEnter, { disabled: false, runCheck: () => runs.push('check') })
    expect(runs).toEqual(['check'])
  })

  it('standalone Escape is ignored while loading, then closes after cancel returns idle', () => {
    const closes: string[] = []
    const loading = reactKey({ key: 'Escape' })
    dockEscapeKeyDown(loading, { loading: true, close: () => closes.push('close') })
    expect(closes).toEqual([])
    const idle = reactKey({ key: 'Escape' })
    dockEscapeKeyDown(idle, { loading: false, close: () => closes.push('close') })
    expect(closes).toEqual(['close'])
  })

  it('the overlay renderer accepts host Dialog and stays callable without host refs', () => {
    const renders: Array<(props: unknown) => { props: Record<string, unknown> }> = []
    const injected: string[] = []
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
    }
    apply(ctx as never)
    expect(injected).toEqual(['shell.overlay'])
    expect(injected).not.toContain('dsh-editor.extensions')
    expect(renders.length).toBeGreaterThan(0)
    const standalone = renders[0]!({})
    expect(standalone.props.Dialog).toBeUndefined()
    const hosted = renders[0]!({ owner: { Select: MockSelect, Dialog: MockDialog } })
    expect(hosted.props.Dialog).toBe(MockDialog)
    expect(hosted.props.Select).toBeUndefined()
  })
})
