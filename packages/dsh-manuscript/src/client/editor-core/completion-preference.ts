// Unified completion preference helpers. Behaviour matches the shell's
// previous stand-alone module: the only valid stored value is 'pause' and
// automatic FIM is gated on a fresh focused edit on a manuscript path with a
// non-trivial prefix and no in-flight suggestion.

export type CompletionPreference = 'manual' | 'pause'

export const COMPLETION_PREFERENCE_KEY = 'dsh-editor.writing.completion'

export function readCompletionPreference(storage: Pick<Storage, 'getItem'> | undefined): CompletionPreference {
  try {
    return storage?.getItem(COMPLETION_PREFERENCE_KEY) === 'pause' ? 'pause' : 'manual'
  } catch {
    return 'manual'
  }
}

export function automaticCompletionReady(input: {
  preference: CompletionPreference
  manuscript: boolean
  userEditRevision: number
  requestedRevision: number
  focused: boolean
  collapsedSelection: boolean
  prefix: string
  busy: boolean
  blocked: boolean
}): boolean {
  return input.preference === 'pause'
    && input.manuscript
    && input.userEditRevision > input.requestedRevision
    && input.focused
    && input.collapsedSelection
    && input.prefix.trim().length >= 8
    && !input.busy
    && !input.blocked
}
