/** IME composition keyCode used by Chromium/WebKit while composing. */
export const IME_KEYCODE = 229

export function isImeEvent(input: { isComposing?: boolean; keyCode?: number }): boolean {
  return Boolean(input.isComposing) || input.keyCode === IME_KEYCODE
}
