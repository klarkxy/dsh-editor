export function canPinPath(path: string): boolean {
  return /\.(?:md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.'))
}

export function pinnedLayoutColumns(input: {
  sidebarVisible: boolean
  sidebarWidth: number
  pinnedVisible: boolean
  pinnedWidth: number
  assistantVisible: boolean
  assistantWidth: number
}): string {
  return [
    input.sidebarVisible ? `${input.sidebarWidth}px 7px` : '',
    'minmax(420px,1fr)',
    input.pinnedVisible ? `7px ${input.pinnedWidth}px` : '',
    input.assistantVisible ? `7px ${input.assistantWidth}px` : '',
  ].filter(Boolean).join(' ')
}

export function validatePinnedPath(stored: string | null | undefined, treePaths: readonly string[]): string | null {
  if (!stored || !canPinPath(stored)) return null
  return treePaths.includes(stored) ? stored : null
}

export function storedPinnedPath(key: string): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw && raw.length ? raw : null
  } catch {
    return null
  }
}
