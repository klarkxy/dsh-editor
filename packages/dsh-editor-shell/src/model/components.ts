import type { SessionFace } from '../dsh-compat.ts'
import type { ShellContext } from '../client/shared.ts'

export function isObservableSource(value: unknown): value is { getSnapshot(): unknown; subscribe(listener: () => void): () => void } {
  return Boolean(value && typeof value === 'object'
    && typeof (value as { getSnapshot?: unknown }).getSnapshot === 'function'
    && typeof (value as { subscribe?: unknown }).subscribe === 'function')
}

export function currentSession(ctx: ShellContext): SessionFace | undefined {
  return ctx.uiWorkspace.current.getSnapshot()
}
