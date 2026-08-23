export const OFFICIAL_DEEPSEEK_PROVIDER = 'deepseek-official'
export const OFFICIAL_DEEPSEEK_ORIGIN = 'https://api.deepseek.com'

export function isOfficialDeepSeekProvider(provider: string, baseURL = ''): boolean {
  if (provider === OFFICIAL_DEEPSEEK_PROVIDER) return true
  try {
    return new URL(baseURL).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

export function officialFimUrl(baseURL = OFFICIAL_DEEPSEEK_ORIGIN): string {
  let origin = OFFICIAL_DEEPSEEK_ORIGIN
  try {
    if (baseURL) origin = new URL(baseURL).origin
  } catch {
    /* keep default */
  }
  return `${origin.replace(/\/+$/, '')}/beta/completions`
}

/** Protocol gaps (no FIM/suffix) may fall back to chat. Auth/quota/5xx must not. */
export function shouldFallbackBeta(status: number | undefined, message: string): boolean {
  if (status === 400 || status === 404) return true
  return /不支持|unsupported|beta/i.test(message)
}

export function extractFimText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const choices = (body as { choices?: Array<{ text?: string; message?: { content?: string } }> }).choices
  const first = choices?.[0]
  return String(first?.text ?? first?.message?.content ?? '')
}
