/** 定位必须唯一的原文/锚点。重叠出现（「哈哈哈」里的「哈哈」）也算第二次匹配。 */

export function findUniqueIndex(text: string, needle: string): number {
  if (!needle) return -1
  const first = text.indexOf(needle)
  if (first < 0) return -1
  if (text.indexOf(needle, first + 1) >= 0) return -2
  return first
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while ((index = text.indexOf(needle, index)) >= 0) {
    count += 1
    index += 1
  }
  return count
}
