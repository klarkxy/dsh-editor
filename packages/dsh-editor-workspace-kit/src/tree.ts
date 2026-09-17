export const MAX_FILES = 2_000
export const GENERATED_DIRECTORIES = new Set(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])
const AUXILIARY_BASENAME = /^(AGENTS|CLAUDE|GEMINI|COPILOT)\.md$/i

export function isHiddenPath(relative: string): boolean {
  return relative.split('/').some((part) => part.startsWith('.'))
}

export function isGeneratedPath(relative: string): boolean {
  return relative.split('/').some((part) => GENERATED_DIRECTORIES.has(part.toLocaleLowerCase()))
}

/** Assistant/config files authors did not write as manuscript. Dotfiles already fail isHiddenPath. */
export function isAuxiliaryAuthorFile(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name
  if (base.startsWith('.')) return true
  return AUXILIARY_BASENAME.test(base)
}
