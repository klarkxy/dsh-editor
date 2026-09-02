import { createElement as e, useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import {
  resizedPanelWidth,
  type ResizablePanelSide,
  type RpcResult,
  type ShellContext,
} from './shared.ts'

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
      e('h1', null, '开始写作'),
      props.children,
    ),
  )
}

/** 图像预览 lightbox:点遮罩或 Esc 关闭。 */
export function ImagePreviewOverlay(props: { path: string; url: string; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); props.onClose() }
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [props.path])
  return e('div', {
    className: 'image-preview',
    role: 'dialog',
    'aria-modal': true,
    'aria-label': `预览 ${props.path}`,
    onClick: (event: ReactPointerEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) props.onClose() },
  },
    e('img', { src: props.url, alt: props.path }),
    e('button', { ref: closeRef, type: 'button', className: 'icon-button image-preview-close', 'aria-label': '关闭预览', onClick: props.onClose }, '×'),
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
    title: `${props.label}（可拖动或使用方向键）`,
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

export function useObservable<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  return useSyncExternalStore(source.subscribe.bind(source), source.getSnapshot.bind(source), source.getSnapshot.bind(source))
}

export function currentSession(ctx: ShellContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id ? ctx.sessions.binding(id)?.session : undefined
}

export { type RpcResult }
