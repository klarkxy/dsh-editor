/**
 * Author-facing word count shared by the paper footer, 文档概览, export
 * precheck rows and totals. Counts every non-whitespace character so CJK
 * prose, latin words and digits weigh the same everywhere the number shows.
 */
export function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}
