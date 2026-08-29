export const AUTHOR_PREFERENCES_LIMIT = 1_200

export function parseAuthorPreferences(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim().slice(0, AUTHOR_PREFERENCES_LIMIT)
}

export function withAuthorPreferences(system: string, preferences: string): string {
  return preferences ? `${system}\n\n【作者跨作品约定】\n${preferences}` : system
}
