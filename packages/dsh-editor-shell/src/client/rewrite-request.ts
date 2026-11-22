/** Desktop selection-rewrite prompt: the partner must write back through writing_change. */
export function desktopRewritePrompt(path: string, selection: string, instruction: string): string {
  return [
    `请改写下面这段。文件：${path}`,
    `改写要求：${instruction}`,
    '先 read 该文件，确认下面片段在文件中可唯一定位后，用 writing_change 只改这一处选段，不要改文件其他部分。',
    '',
    '【待改写】',
    selection,
  ].join('\n')
}
