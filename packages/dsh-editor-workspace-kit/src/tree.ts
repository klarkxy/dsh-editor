export const MAX_FILES = 2_000
export const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])

export function isHiddenPath(relative: string): boolean {
  return relative.split('/').some((part) => part.startsWith('.'))
}

export function isGeneratedPath(relative: string): boolean {
  return relative.split('/').some((part) => GENERATED_DIRECTORIES.has(part.toLocaleLowerCase()))
}
