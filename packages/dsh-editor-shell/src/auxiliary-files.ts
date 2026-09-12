const AUXILIARY_BASENAME = /^(AGENTS|CLAUDE|GEMINI|COPILOT)\.md$/i

/**
 * Identified assistant/config files that authors did not write as manuscript.
 * Dot-files are already hidden by the tree. Never matches 正文/人物卡/世界书 chapters.
 */
export function isAuxiliaryAuthorFile(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name
  if (base.startsWith('.')) return true
  return AUXILIARY_BASENAME.test(base)
}
