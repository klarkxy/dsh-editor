export const AUTHOR_PREFERENCES_LIMIT = 1_200
export const CHAPTER_CONTEXT_LIMIT = 1_200
export const INSTRUCTION_LIMIT = 400

export const CHAPTER_CONTEXT_GUIDANCE =
  '工作笔记中的节拍是作者对本章的计划，上一章状态是作者维护的事实基线；续写须与之一致，但不要复述它们。'

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/g

export function parseAuthorPreferences(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim().slice(0, AUTHOR_PREFERENCES_LIMIT)
}

/** Untrusted prompt text: keep newlines, drop other controls, then trim and bound. */
export function parseBoundedPromptText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, '').trim().slice(0, limit)
}

export function parseChapterContext(value: unknown): string {
  return parseBoundedPromptText(value, CHAPTER_CONTEXT_LIMIT)
}

export function parseInstruction(value: unknown): string {
  return parseBoundedPromptText(value, INSTRUCTION_LIMIT)
}

export function withAuthorPreferences(system: string, preferences: string): string {
  return preferences ? `${system}\n\n【作者跨作品约定】\n${preferences}` : system
}

export function withChapterContextGuidance(system: string, chapterContext: string): string {
  return chapterContext ? `${system}\n\n${CHAPTER_CONTEXT_GUIDANCE}` : system
}

export function chapterContextUserPrefix(chapterContext: string): string {
  return chapterContext ? `【本章工作笔记】\n${chapterContext}\n\n` : ''
}
