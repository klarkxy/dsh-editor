import type { FimPayloadInput } from './editor-contracts.ts'

export function extractText(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) {
    const raw = (value as { text: unknown }).text
    return typeof raw === 'string' ? raw : ''
  }
  return ''

}
function optionalPayloadField(value: string | undefined): string | undefined {
  return value ? value : undefined
}

export function defaultFimPayload(input: FimPayloadInput): Record<string, unknown> {
  return {
    sessionId: input.sessionId,
    path: input.path,
    prefix: input.prefix,
    suffix: input.suffix,
    ...(optionalPayloadField(input.authorPreferences) ? { authorPreferences: input.authorPreferences } : {}),
    ...(optionalPayloadField(input.chapterContext) ? { chapterContext: input.chapterContext } : {}),
  }
}
