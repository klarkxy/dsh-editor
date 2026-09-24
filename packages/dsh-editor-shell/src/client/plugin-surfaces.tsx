import { Component, useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { CHAT_EVENTS_SLOT, MODEL_SETTINGS_SLOT } from '../seats.ts'
import type { SettingsRenderSlot } from './settings-plugins.tsx'

type SlotEntry = { options?: { id?: string; order?: number } }
type Ledger = {
  entries(key: string): readonly SlotEntry[]
  getVersion(key: string): number
  subscribe(key: string, listener: () => void): () => void
}

function slotLedger(ctx: unknown): Ledger | undefined {
  try {
    const slots = (ctx as { slots?: Partial<Ledger> })?.slots
    return slots && typeof slots.entries === 'function' && typeof slots.getVersion === 'function'
      && typeof slots.subscribe === 'function' ? slots as Ledger : undefined
  } catch { return undefined }
}

/** Stable selection prevents competing provider editors from rendering together. */
export function firstSurfaceEntry(entries: readonly SlotEntry[]): string | undefined {
  return entries.filter(entry => typeof entry.options?.id === 'string' && entry.options.id.trim())
    .map((entry, index) => ({ id: entry.options!.id!, order: entry.options?.order ?? 0, index }))
    .sort((left, right) => left.order - right.order || left.index - right.index)[0]?.id
}

function useSurface(ctx: unknown, key: string) {
  const slots = slotLedger(ctx)
  const subscribe = useCallback((listener: () => void) => slots?.subscribe(key, listener) ?? (() => {}), [slots, key])
  const snapshot = useCallback(() => slots?.getVersion(key) ?? 0, [slots, key])
  const version = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { entries: slots?.entries(key) ?? [], version }
}

class SurfaceBoundary extends Component<{
  identity: string; fallback?: ReactNode; children?: ReactNode
}, { identity: string; failed: boolean }> {
  state = { identity: this.props.identity, failed: false }
  static getDerivedStateFromProps(props: { identity: string }, state: { identity: string }) {
    return props.identity === state.identity ? null : { identity: props.identity, failed: false }
  }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children }
}

function Outlet(props: { renderSlot: SettingsRenderSlot; slot: string; owner: object; only?: string }) {
  return props.renderSlot(props.slot, props.owner, props.only ? { only: props.only } : undefined) ?? null
}

export function PluginChatEvents(props: {
  ctx: unknown; renderSlot?: SettingsRenderSlot; sessionId: string; locale: 'zh' | 'en'; hidden?: boolean
  /** Refresh/navigation only; the plugin Host must already have confirmed its write. */
  onApplied?(path: string): void
}) {
  const { entries, version } = useSurface(props.ctx, CHAT_EVENTS_SLOT)
  if (!props.renderSlot || !entries.length) return null
  return <SurfaceBoundary identity={props.sessionId + ':' + version}>
    <div data-dsh-plugin-surface="" style={{ display: 'contents' }}><Outlet renderSlot={props.renderSlot} slot={CHAT_EVENTS_SLOT}
      owner={{ sessionId: props.sessionId, locale: props.locale, hidden: Boolean(props.hidden), ...(props.onApplied ? { onApplied: props.onApplied } : {}) }} /></div>
  </SurfaceBoundary>
}

export function ModelSettingsSurface(props: {
  ctx: unknown
  renderSlot?: SettingsRenderSlot
  sessionId?: string
  locale: 'zh' | 'en'
  renderProviders(options?: { includeWritingRoutes?: boolean }): ReactNode
  renderChatModel(): ReactNode
}) {
  const { entries, version } = useSurface(props.ctx, MODEL_SETTINGS_SLOT)
  const id = firstSurfaceEntry(entries)
  if (!props.renderSlot || !id) return props.renderProviders()
  return <SurfaceBoundary identity={id + ':' + version} fallback={props.renderProviders()}>
    <div data-dsh-plugin-surface="" style={{ display: 'contents' }}><Outlet renderSlot={props.renderSlot} slot={MODEL_SETTINGS_SLOT} only={id}
      owner={{ sessionId: props.sessionId, locale: props.locale, renderProviders: props.renderProviders, renderChatModel: props.renderChatModel }} /></div>
  </SurfaceBoundary>
}
