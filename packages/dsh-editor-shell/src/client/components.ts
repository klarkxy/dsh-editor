import { Component, createElement as e, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { SessionFace } from '../dsh-compat.ts'
import {
  resizedPanelWidth,
  type ResizablePanelSide,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { Button, Dialog } from './ui/index.ts'
import { t } from '../i18n/index.ts'

export function DeepSeekWhaleMark() {
  return e('svg', {
    className: 'whale-mark',
    viewBox: '0 0 32 32',
    'aria-hidden': 'true',
    focusable: 'false',
  },
    e('path', {
      fill: 'currentColor',
      d: 'M3.4 12.2c1.2-3.6 4.2-5.4 7.6-5.2.6-2.6 2.8-4.6 5.8-5 3.2-.4 6 1.2 7.2 4.2 2.8.4 5 2.6 5.4 5.4.4 3-1.2 5.8-4 7.2-2 .9-4.4 1.3-7 1.3-3.4 0-6.4-.8-8.8-2.4C6 16.2 4.2 14.2 3.8 12c1.2.6 2.4 1 3.6 1.2-.4-1.2-.6-2.4-.4-3.6-1.4.4-2.6 1.2-3.6 2.6Z',
    }),
    e('circle', { cx: '21.2', cy: '11.6', r: '1.55', fill: '#fffdf6' }),
  )
}

export function PaperStage(props: { label: string; children?: ReactNode }) {
  return e('section', { className: 'empty-paper home-stage', 'aria-label': props.label },
    e('div', { className: 'home-card' },
      e('p', { className: 'home-eyebrow' }, 'DSH EDITOR'),
      e('h1', null, t('home.startWriting')),
      props.children,
    ),
  )
}

/** Image preview on host Dialog. `open` is internal wiring. */
export function ImagePreviewOverlay(props: { path: string; url: string; onClose(): void; open?: boolean }) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const last = useRef({ path: props.path, url: props.url })
  if (props.path && props.url) last.current = { path: props.path, url: props.url }
  const path = props.path || last.current.path
  const url = props.url || last.current.url
  const open = props.open ?? true
  const fileName = path.split(/[/\\]/).pop() || path
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next) props.onClose() },
    title: path ? t('preview.aria', { path: fileName }) : t('preview.close'),
    className: 'file-dialog image-preview-dialog',
    overlayClassName: 'file-dialog-overlay',
    initialFocusRef: closeRef,
  },
    url ? e('img', { src: url, alt: path }) : null,
    e(Button, {
      ref: closeRef,
      type: 'button',
      variant: 'icon',
      className: 'image-preview-close',
      'aria-label': t('preview.close'),
      onClick: props.onClose,
    }, '×'),
  )
}

export function PanelResizer(props: {
  side: ResizablePanelSide
  value: number
  minimum: number
  maximum: number
  defaultValue: number
  label: string
  onChange(value: number): void
}) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null)
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    props.onChange(resizedPanelWidth(props.side, active.startValue, event.clientX - active.startX, props.minimum, props.maximum))
  }
  return e('div', {
    className: `panel-resizer ${props.side}`,
    role: 'separator',
    tabIndex: 0,
    'aria-label': props.label,
    'aria-orientation': 'vertical',
    'aria-valuemin': props.minimum,
    'aria-valuemax': props.maximum,
    'aria-valuenow': props.value,
    title: t('resizer.aria', { label: props.label }),
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: props.value }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: move,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointerId === event.pointerId) drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onLostPointerCapture: () => { drag.current = null },
    onDoubleClick: () => props.onChange(props.defaultValue),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Home') { event.preventDefault(); props.onChange(props.defaultValue); return }
      if (event.key === 'End') { event.preventDefault(); props.onChange(props.maximum); return }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      props.onChange(resizedPanelWidth(props.side, props.value, event.key === 'ArrowRight' ? 12 : -12, props.minimum, props.maximum))
    },
  }, e('span', { 'aria-hidden': 'true' }))
}

export function isObservableSource(value: unknown): value is { getSnapshot(): unknown; subscribe(listener: () => void): () => void } {
  return Boolean(value && typeof value === 'object'
    && typeof (value as { getSnapshot?: unknown }).getSnapshot === 'function'
    && typeof (value as { subscribe?: unknown }).subscribe === 'function')
}

export function useObservable<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  return useSyncExternalStore(source.subscribe.bind(source), source.getSnapshot.bind(source), source.getSnapshot.bind(source))
}

export class ShellErrorBoundary extends Component<{ children?: ReactNode; fallback?: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (!this.state.error) return this.props.children ?? null
    return this.props.fallback ?? e('div', {
      role: 'alert',
      'data-testid': 'shell-error',
      className: 'warning pad',
    }, this.state.error)
  }
}

export function currentSession(ctx: ShellContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id ? ctx.sessions.binding(id)?.session : undefined
}

export { type RpcResult }
