function fileTitle(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.(md|txt)$/i, '')
}

export function readableDocumentTitle(path: string, text: string): string {
  const paper = text.replace(/^\uFEFF/, '')
  const closed = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(paper)
  const body = closed ? paper.slice(closed[0].length) : paper
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*$/m.exec(body)
  const name = heading?.[1]?.replace(/\s+/g, ' ').trim()
  return name || fileTitle(path)
}

export function rewriteSelectionExcerpt(text: string, limit = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit).trimEnd()}…`
}

export type WrapUpHandle = {
  isComposing(): boolean
  getCommandState(): { loaded: boolean; conflict: boolean }
  getDocument(): { sessionId: string; path: string; version: string; text: string } | null
  getText(): string
  save(): Promise<boolean>
}

/* 离场/切章前的通用保存：不限制章节路径与正文非空，只保证"保存成功才继续"。
   组字中、冲突、保存失败、保存期间又有新输入、文档身份变化都返回失败原因，调用方留在原处。 */
export type EditorSaveBlockReason = 'composing' | 'conflict' | 'save' | 'identity' | 'typing'

export async function saveOpenEditor(
  handle: WrapUpHandle,
  expected: { sessionId: string; path: string },
): Promise<{ ok: true } | { ok: false; reason: EditorSaveBlockReason }> {
  const live = handle.getCommandState()
  if (!live.loaded) return { ok: false, reason: 'identity' }
  if (handle.isComposing()) return { ok: false, reason: 'composing' }
  if (live.conflict) return { ok: false, reason: 'conflict' }
  const before = handle.getDocument()
  if (!before || before.path !== expected.path || before.sessionId !== expected.sessionId) return { ok: false, reason: 'identity' }
  const saved = handle.getText() === before.text || await handle.save()
  if (!saved) return { ok: false, reason: 'save' }
  /* 保存是异步的：await 之后重新核对组字/冲突/身份/实时缓冲区，快输入与新组字都不能绕过。 */
  const afterLive = handle.getCommandState()
  if (!afterLive.loaded) return { ok: false, reason: 'identity' }
  if (handle.isComposing()) return { ok: false, reason: 'composing' }
  if (afterLive.conflict) return { ok: false, reason: 'conflict' }
  const after = handle.getDocument()
  if (!after || after.path !== before.path || after.sessionId !== before.sessionId) return { ok: false, reason: 'identity' }
  /* 保存飞行期间继续键入：新字还没落盘，留在原处，避免静默丢失。 */
  if (handle.getText() !== after.text) return { ok: false, reason: 'typing' }
  return { ok: true }
}
