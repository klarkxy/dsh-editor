export type SceneIssue = {
  kind: 'dialogue-run' | 'crowd' | 'missing-character'
  at: string
  evidence: string
}

const DIALOGUE_LINE = /^\s*[「“"][^」”"]{0,200}[」”"]\s*$/
const CROWD = /众人(都|一阵|纷纷)?|大家(都|一阵)?|一众弟子|围观的人|一阵(哗然|骚动|议论)/

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split(/\n/).length
}

export function scanScene(text: string, characters: string[] = []): SceneIssue[] {
  const issues: SceneIssue[] = []
  const lines = text.split(/\n/)
  let run = 0
  let runStart = 0
  const flush = (end: number) => {
    if (run >= 4) {
      const slice = lines.slice(runStart, end).join('\n')
      issues.push({
        kind: 'dialogue-run',
        at: `L${runStart + 1}-L${end}`,
        evidence: slice.slice(0, 160),
      })
    }
    run = 0
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) {
      flush(i)
      continue
    }
    if (DIALOGUE_LINE.test(line)) {
      if (run === 0) runStart = i
      run += 1
    } else {
      flush(i)
    }
  }
  flush(lines.length)

  const crowdRe = new RegExp(CROWD.source, 'g')
  let match: RegExpExecArray | null
  while ((match = crowdRe.exec(text))) {
    issues.push({
      kind: 'crowd',
      at: `L${lineAt(text, match.index)}`,
      evidence: text.slice(match.index, match.index + 40).replace(/\s+/g, ' '),
    })
    if (issues.filter((item) => item.kind === 'crowd').length >= 8) break
  }

  const third = Math.floor(text.length / 3)
  const last = text.slice(third * 2)
  for (const name of characters.map((item) => item.trim()).filter(Boolean)) {
    if (name.length < 2) continue
    const appears = text.includes(name)
    if (!appears) {
      issues.push({ kind: 'missing-character', at: '全文', evidence: `${name} 未出现` })
      continue
    }
    if (text.length > 600 && !last.includes(name) && text.slice(0, third * 2).includes(name)) {
      issues.push({ kind: 'missing-character', at: '后段', evidence: `${name} 前段点名后长时间未出现` })
    }
  }
  return issues
}
