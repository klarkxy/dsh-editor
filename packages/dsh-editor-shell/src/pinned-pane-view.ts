export function canPinPath(path: string): boolean {
  return /\.(?:md|txt)$/i.test(path) && !path.split('/').some((part) => part.startsWith('.'))
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
