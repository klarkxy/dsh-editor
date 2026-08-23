export const MANUSCRIPT_SLOT_NAME = 'shell.overlay'
export const MANUSCRIPT_SLOT_ID = 'manuscript'
export const MANUSCRIPT_SLOT = {
  name: MANUSCRIPT_SLOT_NAME,
  id: MANUSCRIPT_SLOT_ID,
  order: 100,
  label: '稿纸',
}

export type SlotHandle = {
  inject: (key: string, callback: () => unknown) => unknown
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => unknown
}

/**
 * Seat tree+editor as an additive overlay. Must not occupy `root` (that
 * shadows AppFrame and unloads official Chat) or `conversation.view`.
 */
export function registerManuscriptUi(slots: SlotHandle, render: unknown): () => void {
  const name: string = MANUSCRIPT_SLOT.name
  if (name === 'root' || name === 'conversation.view') {
    throw new Error('manuscript must not occupy root or conversation.view')
  }
  return slots.inject(name, () =>
    slots.register(
      { name, id: MANUSCRIPT_SLOT.id, order: MANUSCRIPT_SLOT.order, label: MANUSCRIPT_SLOT.label },
      render,
    ),
  ) as () => void
}
