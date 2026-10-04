import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import { bindTextareaInsertion } from './official-input-selection.ts'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, useSyncExternalStore } from 'react'
import type { ShellContext } from './shared.ts'
import type { SettingsRenderSlot } from './settings-plugins.tsx'

export const OFFICIAL_INPUT_SLOT = 'dsh-editor.official-input'
export const PLUGIN_NAVIGATION_EVENT = 'dsh-editor:plugin-navigation'
export const OFFICIAL_LAYOUT_EVENT = 'dsh-editor:official-layout'

export type OfficialInputActions = {
  setDraft(text: string): void
  captureInsertion(): { draftRev: number; start: number; end: number }
  insertText(text: string, span: unknown): boolean
}
type SessionProvider = ComponentType<{ session: unknown; children?: ReactNode }>
export type OfficialRootProps = { shortcuts?: Shortcuts; renderSlot?: SettingsRenderSlot; SessionProvider?: SessionProvider }
const OfficialRoot = createContext<OfficialRootProps>({})
export function OfficialSurfaceProvider({ value, children }: { value: OfficialRootProps; children: ReactNode }) {
  return <OfficialRoot.Provider value={value}>{children}</OfficialRoot.Provider>
}

const noCatalog = Object.freeze([])
const emptyCatalog = { subscribe: () => () => {}, getSnapshot: () => noCatalog }
export function useOfficialShortcut(id: string): string | undefined {
  const { shortcuts } = useContext(OfficialRoot)
  const source = shortcuts?.catalog ?? emptyCatalog
  const catalog = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  return catalog.find(entry => entry.id === id)?.keys.join('')
}

type InputOwner = {
  getSelection(): { start: number; end: number; length: number }
  locked: boolean
  /** The plugin reports an expanded capture row; the shell only repositions the slot. */
  expanded: boolean
  onActiveChange(active: boolean): void
  onDraft(text: string): void
  onBind(actions: OfficialInputActions | null): void
}
/** Reads the native session input projection; it never owns a second draft. */
function NativeInputSurface(props: InputOwner & {
  useInput<T>(select: (state: { draft: string }) => T): T | undefined
  inputActions: OfficialInputActions
  renderSlot: SettingsRenderSlot
}) {
  const draft = props.useInput(state => state.draft)
  const selection = useRef(props.getSelection)
  selection.current = props.getSelection
  useLayoutEffect(() => bindTextareaInsertion(props.inputActions, () => selection.current()), [props.inputActions])
  useLayoutEffect(() => {
    props.onBind(props.inputActions)
    return () => props.onBind(null)
  }, [props.inputActions, props.onBind])
  useLayoutEffect(() => { if (draft !== undefined) props.onDraft(draft) }, [draft, props.onDraft])
  /* One mount point, two placements: the idle trigger is a compact item in the composer
   * toolbar, while an active capture claims the full width above it. Reparenting would
   * remount the plugin and drop a running recording, so only the class changes. The
   * shell owns the layout box; the plugin keeps its own surface and internals. */
  return <div className={props.expanded ? 'composer-voice composer-voice-expanded' : 'composer-voice'}>
    <div data-dsh-plugin-surface="" style={{ display: 'contents' }}>{props.renderSlot('conversation.input.activity', {
      locked: props.locked, onActiveChange: props.onActiveChange,
    })}</div>
  </div>
}

/** The renderer supplies SessionProvider; its scope owns the official input actions. */
export function OfficialInputActivity(props: InputOwner & { ctx: ShellContext; sessionId: string }) {
  const { SessionProvider, renderSlot } = useContext(OfficialRoot)
  const [reference, setReference] = useState<ReturnType<ShellContext['sessions']['retain']> | null>(null)
  useEffect(() => {
    const next = props.ctx.sessions.retain(props.sessionId, { source: 'workspaceOperation' })
    setReference(next)
    return () => { next.release() }
  }, [props.ctx, props.sessionId])
  if (!SessionProvider || !renderSlot || reference?.sessionId !== props.sessionId) return null
  return <SessionProvider session={reference}>{renderSlot(OFFICIAL_INPUT_SLOT, props)}</SessionProvider>
}

export function OfficialOverlays({ renderSlot }: OfficialRootProps) {
  return <div data-dsh-plugin-surface="">{renderSlot?.('shell.overlay', {}, { only: 'shortcuts' })}</div>
}

/** Implement the official navigation face using the Editor's existing plugin page. */
export function provideOfficialSurfaces(ctx: ShellContext): void {
  ctx.provide('pluginNavigation', {
    openBundle(packageName: string) {
      globalThis.dispatchEvent(new CustomEvent(PLUGIN_NAVIGATION_EVENT, { detail: packageName }))
    },
  })
  const slots = ctx.slots as unknown as { inject(key: string, effect: () => unknown): unknown; register(spec: object, component: unknown): unknown }
  slots.inject(OFFICIAL_INPUT_SLOT, () => slots.register({
    name: OFFICIAL_INPUT_SLOT,
    children: { 'conversation.input.activity': { kind: 'single', scope: 'session' } },
  }, NativeInputSurface))
}
