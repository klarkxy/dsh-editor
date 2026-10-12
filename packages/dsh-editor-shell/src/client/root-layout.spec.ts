import { readFileSync } from 'node:fs'
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRootLayout } from './root-layout.ts'
import type { ShellContext } from './shared.ts'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: vi.fn(), useRef: vi.fn(), useEffect: vi.fn(), useCallback: vi.fn(),
}))
const viewport = vi.hoisted(() => ({ width: 1440 }))
vi.mock('./components.tsx', () => ({
  useMediaQuery: (query: string) => viewport.width <= (query.includes('1040') ? 1040 : 760),
}))

const widthKey = 'dsh-editor.layout.sidebar-width'
let storage: Map<string, string>
let frames: Map<number, FrameRequestCallback>
let frameId: number
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  viewport.width = 1440
  storage = new Map([[widthKey, '260'], ['dsh-editor.layout.sidebar-open', 'false']])
  frames = new Map()
  frameId = 0
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals() })

function nextFrame() {
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback(0)
}

/** Run the production hook's handlers/effects with a conditional Panel mount and rAF queue. */
function layoutHarness(props?: {
  ctx?: ShellContext
  fileSession?: Parameters<typeof useRootLayout>[0]['fileSession']
  openWorkspaceId?: Parameters<typeof useRootLayout>[0]['openWorkspaceId']
}) {
  dispose?.()
  type Effect = { deps?: readonly unknown[]; cleanup?: () => void }
  const state: unknown[] = []
  const effects: Effect[] = []
  let cursor = 0
  let dirty = false
  let pending: (() => void)[] = []
  let pixels: number | null = null
  let layout: ReturnType<typeof useRootLayout>
  const panel = {
    getSize: () => ({ inPixels: pixels ?? 0, asPercentage: 0 }),
    resize: vi.fn((size: string) => {
      pixels = Number.parseFloat(size)
      layout.sidebarWidthRef.current = pixels
    }),
  }
  vi.mocked(useState).mockImplementation(((initial: unknown) => {
    const slot = cursor++
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
    return [state[slot], (next: SetStateAction<unknown>) => {
      const value = typeof next === 'function' ? next(state[slot]) : next
      if (!Object.is(value, state[slot])) { state[slot] = value; dirty = true }
    }]
  }) as typeof useState)
  vi.mocked(useRef).mockImplementation(((initial: unknown) => {
    const slot = cursor++
    if (!(slot in state)) state[slot] = { current: initial }
    return state[slot]
  }) as typeof useRef)
  vi.mocked(useCallback).mockImplementation(((fn: unknown) => fn) as typeof useCallback)
  vi.mocked(useEffect).mockImplementation((create, deps) => {
    const slot = cursor++
    const previous = effects[slot]
    if (previous && deps && previous.deps?.length === deps.length
      && deps.every((dep, index) => Object.is(dep, previous.deps?.[index]))) return
    pending.push(() => {
      previous?.cleanup?.()
      effects[slot] = { deps, cleanup: create() || undefined }
    })
  })
  function render() {
    let commits = 0
    do {
      if (++commits > 20) throw new Error('Layout did not settle')
      cursor = 0
      dirty = false
      pending = []
      layout = useRootLayout({
        ctx: props?.ctx ?? {} as ShellContext,
        fileSession: props?.fileSession,
        openWorkspaceId: props?.openWorkspaceId,
        treeRevision: 0,
        assistantEnabled: true,
        officialPreviewOpen: false,
      })
      // Panel is absent while closed or in an overlay; mounting consumes its defaultSize.
      if (layout.sidebarInGrid) {
        if (pixels === null) pixels = layout.sidebarViewWidth
        layout.sidebarPanelRef.current = panel as unknown as NonNullable<typeof layout.sidebarPanelRef.current>
        layout.sidebarWidthRef.current = pixels
      } else {
        pixels = null
        layout.sidebarPanelRef.current = null
      }
      for (const effect of pending) effect()
    } while (dirty)
    return layout
  }
  dispose = () => { for (const effect of effects) effect?.cleanup?.() }
  return { render, pixels: () => pixels, panel, clamp: (width: number) => { pixels = width } }
}

describe('temporary sidebar reveal width', () => {
  it('opens a closed panel at 336px without changing the saved author width; reload uses 260px', () => {
    const view = layoutHarness()
    expect(view.render().sidebarPanelRef.current).toBeNull()
    view.render().revealSidebar()
    const revealed = view.render()
    expect(revealed.sidebarInGrid).toBe(true)
    expect(revealed.sidebarWidth).toBe(260)
    expect(view.pixels()).toBe(336)
    nextFrame(); nextFrame()
    expect(storage.get(widthKey)).toBe('260')
    const reloaded = layoutHarness()
    expect(reloaded.render().sidebarViewWidth).toBe(260)
    expect(reloaded.pixels()).toBe(260)
  })

  it('reasserts the revealed width after assistant breakpoint sync and sidebar remount', () => {
    const view = layoutHarness()
    view.render().revealSidebar()
    view.render()
    nextFrame(); nextFrame()
    view.clamp(200)
    viewport.width = 1024
    view.render()
    expect(view.pixels()).toBe(336)
    viewport.width = 760
    view.render()
    expect(view.pixels()).toBeNull()
    viewport.width = 1440
    view.render()
    nextFrame(); nextFrame()
    expect(view.pixels()).toBe(336)
    expect(storage.get(widthKey)).toBe('260')
  })

  it('retains a reveal made in the narrow overlay for the next grid mount', () => {
    viewport.width = 760
    const view = layoutHarness()
    view.render().revealSidebar()
    const overlay = view.render()
    expect(overlay.sidebarVisible).toBe(true)
    expect(overlay.sidebarViewWidth).toBe(336)
    expect(view.pixels()).toBeNull()
    viewport.width = 1440
    view.render()
    expect(view.pixels()).toBe(336)
    expect(storage.get(widthKey)).toBe('260')
  })

  it('retries a not-yet-ready mounted panel without discarding the reveal width', () => {
    storage.set('dsh-editor.layout.sidebar-open', 'true')
    const view = layoutHarness()
    view.render()
    view.panel.resize.mockImplementationOnce(() => { throw new Error('Layout not found') })
    view.render().revealSidebar()
    expect(() => view.render()).not.toThrow()
    expect(view.pixels()).toBe(260)
    nextFrame()
    expect(view.pixels()).toBe(336)
    expect(storage.get(widthKey)).toBe('260')
  })

  it('lets the author replace the reveal width, even with the previously saved width', () => {
    const view = layoutHarness()
    view.render().revealSidebar()
    const revealed = view.render()
    revealed.sidebarWidthRef.current = 260
    revealed.setSidebarWidth(revealed.sidebarWidthRef.current)
    expect(view.render().sidebarViewWidth).toBe(260)
    nextFrame(); nextFrame()
    expect(view.pixels()).toBe(260)
    view.render().setSidebarWidth(300)
    view.render()
    expect(storage.get(widthKey)).toBe('300')
    const reloaded = layoutHarness()
    expect(reloaded.render().sidebarViewWidth).toBe(300)
  })

  it('preserves wider author widths and cancels stale second-frame resize work', () => {
    storage.set(widthKey, '380')
    const view = layoutHarness()
    view.render().revealSidebar()
    expect(view.render().sidebarViewWidth).toBe(380)
    nextFrame() // The old sync has queued its second frame.
    view.render().setSidebarWidth(300)
    view.render()
    nextFrame(); nextFrame()
    expect(view.pixels()).toBe(300)
    expect(view.panel.resize.mock.calls.every(([size]) => size === '300px')).toBe(true)
    expect(storage.get(widthKey)).toBe('300')
  })

  it('wires the transient width into the production conditional Panel default', () => {
    const root = readFileSync(new URL('./root.tsx', import.meta.url), 'utf8')
    const sidebar = root.slice(root.indexOf('id="sidebar"'), root.indexOf('id="editor"'))
    expect(sidebar).toContain('defaultSize={sidebarViewWidth}')
    expect(root).toMatch(/if \(!meta\.isUserInteraction\) return\s+setSidebarWidth\(sidebarWidthRef\.current\)/)
  })
})

describe('author owns the persisted rail preference', () => {
  it('narrow mount keeps stored preferences; only the assistant rail stays yielded', () => {
    storage.set('dsh-editor.layout.sidebar-open', 'true')
    storage.set('dsh-editor.layout.assistant-open', 'true')
    viewport.width = 700
    const view = layoutHarness()
    const layout = view.render()
    // C31 divergence: the sidebar settle yields, but the openWorkspaceId reset
    // effect runs after it in mount order and restores the stored 'true', so the
    // sidebar ends open in the overlay. The assistant has no reset effect and
    // stays yielded closed. Persisted preferences are untouched either way.
    expect(layout.sidebarVisible).toBe(true)
    expect(layout.assistantVisible).toBe(false)
    expect(storage.get('dsh-editor.layout.sidebar-open')).toBe('true')
    expect(storage.get('dsh-editor.layout.assistant-open')).toBe('true')
  })

  it('author open claims the yielded assistant and persists, author close writes false', () => {
    storage.set('dsh-editor.layout.sidebar-open', 'true')
    storage.set('dsh-editor.layout.assistant-open', 'true')
    viewport.width = 700
    const view = layoutHarness()
    view.render().claimAssistant(true)
    view.render().setAssistantOpen(true)
    expect(view.render().assistantVisible).toBe(true)
    expect(view.render().assistantVisible).toBe(true)
    expect(storage.get('dsh-editor.layout.assistant-open')).toBe('true')
    view.render().claimAssistant(false)
    view.render().setAssistantOpen(false)
    view.render()
    expect(storage.get('dsh-editor.layout.assistant-open')).toBe('false')
  })

  it('narrow reload keeps stored preferences and widening back restores both rails', () => {
    storage.set('dsh-editor.layout.sidebar-open', 'true')
    storage.set('dsh-editor.layout.assistant-open', 'true')
    viewport.width = 700
    const view = layoutHarness()
    view.render()
    expect(storage.get('dsh-editor.layout.sidebar-open')).toBe('true')
    expect(storage.get('dsh-editor.layout.assistant-open')).toBe('true')
    viewport.width = 1440
    const layout = view.render()
    expect(layout.sidebarVisible).toBe(true)
    expect(layout.assistantVisible).toBe(true)
    expect(storage.get('dsh-editor.layout.sidebar-open')).toBe('true')
    expect(storage.get('dsh-editor.layout.assistant-open')).toBe('true')
  })

  it('at 900px only the assistant yields to overlay while the sidebar stays docked', () => {
    storage.set('dsh-editor.layout.sidebar-open', 'true')
    storage.set('dsh-editor.layout.assistant-open', 'true')
    viewport.width = 900
    const view = layoutHarness()
    const layout = view.render()
    expect(layout.sidebarVisible).toBe(true)
    expect(layout.sidebarInGrid).toBe(true)
    expect(layout.assistantVisible).toBe(false)
    expect(storage.get('dsh-editor.layout.sidebar-open')).toBe('true')
    expect(storage.get('dsh-editor.layout.assistant-open')).toBe('true')
  })

  it('single-manuscript auto-collapse closes the sidebar without mutating the stored preference', async () => {
    storage.set('dsh-editor.layout.sidebar-open', 'true')
    viewport.width = 1440
    const ctx = {
      connection: {
        rpc: {
          call: async () => ({ ok: true, value: { entries: [{ name: 'a.md', type: 'file' }] } }),
        },
      },
    } as unknown as ShellContext
    const view = layoutHarness({
      ctx,
      fileSession: { sessionId: 's1' } as Parameters<typeof useRootLayout>[0]['fileSession'],
    })
    view.render()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const layout = view.render()
    expect(layout.sidebarVisible).toBe(false)
    expect(storage.get('dsh-editor.layout.sidebar-open')).toBe('true')
  })
})
