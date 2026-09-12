import {
  runClipboardCopy,
  runClipboardCut,
  runClipboardPaste,
  type ClipboardCommandResult,
  type EditorCommandState,
  type EditorCoreHandle,
  type EditorTargetSnapshot,
} from 'dsh-manuscript/client/editor-core'
import { t } from '../i18n/index.ts'
import { windowBridge } from './window-controls.tsx'

export type EditorClipboardBridge = {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

function nativeClipboard(): EditorClipboardBridge | undefined {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard?.readText || !clipboard.writeText) return undefined
  return {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  }
}

export function editorClipboardBridge(): EditorClipboardBridge | undefined {
  return windowBridge()?.clipboard ?? nativeClipboard()
}

export function clipboardResultMessage(result: ClipboardCommandResult): string | null {
  if (result === 'ok') return null
  if (result === 'write-failed') return t('editor.clipboardWriteFailed')
  if (result === 'read-failed' || result === 'unavailable') return t('editor.clipboardUnavailable')
  if (result === 'expired') return t('editor.clipboardExpired')
  if (result === 'blocked') return t('editor.needSelection')
  return t('editor.clipboardUnavailable')
}

export async function copyEditorSelection(input: {
  handle: EditorCoreHandle
  state: EditorCommandState
  target: EditorTargetSnapshot | null
  writeText(text: string): Promise<void>
}): Promise<ClipboardCommandResult> {
  const target = input.target
  if (!target) return 'blocked'
  if (!input.handle.isTargetCurrent(target)) return 'expired'
  return runClipboardCopy({
    allowed: input.state.loaded && target.start < target.end,
    text: target.selectedText,
    writeText: input.writeText,
  })
}

export async function cutEditorSelection(input: {
  handle: EditorCoreHandle
  state: EditorCommandState
  target: EditorTargetSnapshot | null
  writeText(text: string): Promise<void>
}): Promise<ClipboardCommandResult> {
  const target = input.target
  if (!target) return 'blocked'
  if (!input.handle.isTargetCurrent(target)) return 'expired'
  return runClipboardCut({
    allowed: input.state.loaded && target.start < target.end,
    text: target.selectedText,
    writeText: input.writeText,
    stillCurrent: () => input.handle.isTargetCurrent(target),
    deleteSelection: () => input.handle.replaceSelection('', target),
  })
}

export async function pasteEditorSelection(input: {
  handle: EditorCoreHandle
  state: EditorCommandState
  target: EditorTargetSnapshot | null
  readText(): Promise<string>
}): Promise<ClipboardCommandResult> {
  const target = input.target
  if (!target) return 'blocked'
  if (!input.handle.isTargetCurrent(target)) return 'expired'
  return runClipboardPaste({
    allowed: input.state.canPaste,
    readText: input.readText,
    stillCurrent: () => input.handle.isTargetCurrent(target),
    replaceSelection: (text) => input.handle.replaceSelection(text, target),
  })
}
