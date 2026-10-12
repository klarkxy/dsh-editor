export const OFFICIAL_INPUT_SLOT = 'dsh-editor.official-input'
export const PLUGIN_NAVIGATION_EVENT = 'dsh-editor:plugin-navigation'
export const OFFICIAL_LAYOUT_EVENT = 'dsh-editor:official-layout'

export type OfficialInputActions = {
  setDraft(text: string): void
  captureInsertion(): { draftRev: number; start: number; end: number }
  insertText(text: string, span: unknown): boolean
}
