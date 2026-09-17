import {
  Component,
  useRef,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { SessionFace } from '../dsh-compat.ts'
import type { RpcResult, ShellContext } from './shared.ts'
import { Box, Card, Flex, Heading } from '@radix-ui/themes'
import { Button, Dialog } from './ui/index.ts'
import { t } from '../i18n/index.ts'

export function DeepSeekWhaleMark() {
  return (
    <svg
      className="whale-mark"
      viewBox="2 1 28 21"
      width={16}
      height={16}
      aria-hidden="true"
      focusable="false"
      style={{ width: 16, height: 16, color: 'var(--accent-9)' }}>
      <path
        fill="currentColor"
        d="M3.4 12.2c1.2-3.6 4.2-5.4 7.6-5.2.6-2.6 2.8-4.6 5.8-5 3.2-.4 6 1.2 7.2 4.2 2.8.4 5 2.6 5.4 5.4.4 3-1.2 5.8-4 7.2-2 .9-4.4 1.3-7 1.3-3.4 0-6.4-.8-8.8-2.4C6 16.2 4.2 14.2 3.8 12c1.2.6 2.4 1 3.6 1.2-.4-1.2-.6-2.4-.4-3.6-1.4.4-2.6 1.2-3.6 2.6Z" />
      <circle cx="21.2" cy="11.6" r="1.55" fill="var(--accent-contrast)" />
    </svg>
  );
}

export function PaperStage(props: { label: string; heading?: string; children?: ReactNode }) {
  return (
    <Flex
      className="empty-paper home-stage"
      role="region"
      aria-label={props.label}
      direction="column"
      align="center"
      justify="center"
      width="100%"
      height="100%"
      minWidth="0"
      minHeight="0"
      p="6">
      <Card className="home-card" size="3" style={{ width: 'min(720px, 100%)' }}>
        <Flex direction="column" gap="4">
          {props.heading ? <Heading as="h1" size="6">
            {props.heading}
          </Heading> : null}
          {props.children}
        </Flex>
      </Card>
    </Flex>
  );
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next) props.onClose() }}
      title={path ? t('preview.aria', { path: fileName }) : t('preview.close')}
      className="file-dialog image-preview-dialog"
      overlayClassName="file-dialog-overlay"
      initialFocusRef={closeRef}>
      {url ? <Box>
        <img src={url} alt={path} />
      </Box> : null}
      <Button
        ref={closeRef}
        type="button"
        variant="icon"
        className="image-preview-close"
        aria-label={t('preview.close')}
        onClick={props.onClose}>
        ×
      </Button>
    </Dialog>
  );
}

export function isObservableSource(value: unknown): value is { getSnapshot(): unknown; subscribe(listener: () => void): () => void } {
  return Boolean(value && typeof value === 'object'
    && typeof (value as { getSnapshot?: unknown }).getSnapshot === 'function'
    && typeof (value as { subscribe?: unknown }).subscribe === 'function')
}

export function useObservable<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  return useSyncExternalStore(source.subscribe.bind(source), source.getSnapshot.bind(source), source.getSnapshot.bind(source))
}

/** Viewport queries for the shell breakpoints. Server / test snapshot is false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = globalThis.matchMedia?.(query)
      if (!mq) return () => {}
      mq.addEventListener('change', onStoreChange)
      return () => mq.removeEventListener('change', onStoreChange)
    },
    () => Boolean(globalThis.matchMedia?.(query)?.matches),
    () => false,
  )
}

export class ShellErrorBoundary extends Component<{ children?: ReactNode; fallback?: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (!this.state.error) return this.props.children ?? null
    return this.props.fallback ?? <div role="alert" data-testid="shell-error" className="warning pad">
      {this.state.error}
    </div>;
  }
}

export function currentSession(ctx: ShellContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id ? ctx.sessions.binding(id)?.session : undefined
}

export { type RpcResult }
