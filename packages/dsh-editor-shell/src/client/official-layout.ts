import type { ShellContext } from './shared.ts'
import { OFFICIAL_LAYOUT_EVENT } from '../model/official-surfaces.ts'

type ThemeSnapshot = { active: { colorScheme: 'light' | 'dark'; tokens: Record<string, string> }; fontSize: number; preference: string }
export type OfficialPresentation = { shown: boolean; track: boolean; fullscreen: boolean }
/** Editor is the layout owner; native plugins use the public layout contract. */
export function provideOfficialLayout(ctx: ShellContext): void {
  let panel = { activePanelId: null as string | null }
  const panelListeners = new Set<() => void>()
  let view: OfficialPresentation = { shown: false, track: false, fullscreen: false }
  const listeners = new Set<() => void>()
  const presentation = { getSnapshot: () => view, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const panelInfo = {
    getSnapshot: () => panel,
    subscribe: (listener: () => void) => { panelListeners.add(listener); return () => { panelListeners.delete(listener) } },
  }
  const publish = (next: OfficialPresentation) => {
    if (next.shown === view.shown && next.track === view.track && next.fullscreen === view.fullscreen) return
    view = next
    for (const listener of listeners) listener()
  }
  const publishPanel = (id: string | null) => {
    if (panel.activePanelId === id) return
    panel = { activePanelId: id }
    for (const listener of panelListeners) listener()
  }
  let navigation: AbortController | undefined
  ctx.provide('layout', {
    panelInfo, presentation,
    selectPanel(id: string | null) {
      if (id !== null && id !== 'plugins') throw new Error(`Editor has no main panel registered as ${id}`)
      publishPanel(id)
      if (id === null) navigation?.abort()
    },
    beginNavigation() { navigation?.abort(); navigation = new AbortController(); return navigation.signal },
    toggleSidebar() { globalThis.dispatchEvent(new CustomEvent(OFFICIAL_LAYOUT_EVENT, { detail: 'toggle-sidebar' })) },
    openRightbar(track: boolean, fullscreen: boolean) { publish({ shown: true, track, fullscreen }) },
    closeRightbar() { publish({ shown: false, track: false, fullscreen: false }) },
  })
  const slots = ctx.slots as unknown as { provideRoot(source: object): () => void }
  ctx.effect(() => slots.provideRoot({ hooks: { panelInfo } }))
  ctx.effect(() => () => { navigation?.abort(); listeners.clear(); panelListeners.clear() })
  ctx.effect(() => {
    const body = document.body
    const root = document.documentElement
    const priorDark = body.hasAttribute('data-ds-dark-theme')
    const priorScheme = root.style.colorScheme
    const priorSource = root.getAttribute('data-ds-theme-source')
    const priorFont = body.style.getPropertyValue('--dsh-content-font-size')
    const original = new Map<string, string>()
    let applied: string[] = []
    const present = (theme: ThemeSnapshot) => {
      root.style.colorScheme = theme.active.colorScheme
      root.setAttribute('data-ds-theme-source', theme.preference === 'system' ? 'system' : theme.active.colorScheme)
      body.toggleAttribute('data-ds-dark-theme', theme.active.colorScheme === 'dark')
      body.style.setProperty('--dsh-content-font-size', `${theme.fontSize}px`)
      for (const name of applied) {
        const value = original.get(name)
        if (value) body.style.setProperty(name, value)
        else body.style.removeProperty(name)
      }
      applied = Object.keys(theme.active.tokens)
      for (const [name, value] of Object.entries(theme.active.tokens)) {
        if (!original.has(name)) original.set(name, body.style.getPropertyValue(name))
        body.style.setProperty(name, value)
      }
    }
    present((ctx as unknown as { theme: { getTheme(): ThemeSnapshot } }).theme.getTheme())
    const off = ctx.on('theme/change' as never, present as never)
    return () => {
      off()
      for (const [name, value] of original) {
        if (value) body.style.setProperty(name, value)
        else body.style.removeProperty(name)
      }
      body.toggleAttribute('data-ds-dark-theme', priorDark)
      root.style.colorScheme = priorScheme
      if (priorSource === null) root.removeAttribute('data-ds-theme-source')
      else root.setAttribute('data-ds-theme-source', priorSource)
      if (priorFont) body.style.setProperty('--dsh-content-font-size', priorFont)
      else body.style.removeProperty('--dsh-content-font-size')
    }
  })
}
