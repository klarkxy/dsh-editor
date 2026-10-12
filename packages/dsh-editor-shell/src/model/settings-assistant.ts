export type AuthorDraft = { value: string; saved: string; conflicted: boolean }

/** A Host update replaces a clean draft, but cannot silently replace local edits. */
export function reconcileAuthorDraft(draft: AuthorDraft, saved: string): AuthorDraft {
  if (draft.value === saved) return { value: saved, saved, conflicted: false }
  if (draft.saved === saved) return draft
  if (draft.value === draft.saved) return { value: saved, saved, conflicted: false }
  return { ...draft, saved, conflicted: true }
}

/** An older save may finish after the author has started a newer draft. */
export function completeAuthorDraftSave(draft: AuthorDraft, submitted: string, saved: string): AuthorDraft {
  if (draft.value === submitted || draft.value === saved) return { value: saved, saved, conflicted: false }
  return { value: draft.value, saved, conflicted: false }
}
