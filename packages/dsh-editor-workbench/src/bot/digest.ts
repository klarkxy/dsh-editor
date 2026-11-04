import { BOT_INIT_SENTINEL } from './transcript.ts'

export const BOT_INIT_PROMPT_TAIL = '\n\n请用三到五句话告诉作者你对这部作品的认识（类型、进度、主要人物或主题），然后问作者想从哪里继续。不要修改任何文件，不要调用 conversation_wrap_up。'

const MAX_TREE_ENTRIES = 300
const MAX_AUX_FILES = 12
const AUX_DIR_CHARS = 800
const CHAPTER_COUNT = 3
const CHAPTER_CHARS = 500
const DIGEST_CAP = 12000
const AUX_DIRS = ['大纲/', '人物卡/', '世界书/']

type FileAccess = {
  listPaths?(): Promise<string[]> | string[]
  readText(path: string): Promise<string>
}

function isTextDoc(path: string): boolean {
  return /\.(md|txt)$/i.test(path)
}

function naturalOrder(paths: string[]): string[] {
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  return [...paths].sort(collator.compare)
}

function basename(path: string): string {
  return path.split(/[\/]/).pop() ?? path
}

/** Bounded work digest for the init sentinel prompt. Best-effort: unreadable files are skipped. */
export async function buildInitDigest(files: FileAccess, visiblePaths: string[]): Promise<string> {
  const docs = visiblePaths.filter(isTextDoc)
  const parts: string[] = []
  const tree = visiblePaths.slice(0, MAX_TREE_ENTRIES)
  if (tree.length) parts.push(`目录：\n${tree.join('\n')}`)

  const aux = docs.filter((path) => AUX_DIRS.some((dir) => path.startsWith(dir))).slice(0, MAX_AUX_FILES)
  const chapterFiles = naturalOrder(docs.filter((path) => /^正文\/.+\.(md|txt)$/i.test(path.replace(/\\/g, '/')))).slice(-CHAPTER_COUNT)

  const read = async (path: string, cap: number) => {
    try {
      const text = await files.readText(path)
      return text.slice(0, cap)
    } catch {
      return ''
    }
  }

  const agents = docs.find((path) => basename(path) === 'AGENTS.md')
  if (agents) {
    const text = await read(agents, AUX_DIR_CHARS)
    if (text) parts.push(`AGENTS.md：\n${text}`)
  }
  for (const path of aux) {
    const text = await read(path, AUX_DIR_CHARS)
    if (text) parts.push(`${path}：\n${text}`)
  }
  for (const path of chapterFiles) {
    const text = await read(path, CHAPTER_CHARS)
    if (text) parts.push(`${path}：\n${text}`)
  }

  let digest = parts.join('\n\n')
  if (digest.length > DIGEST_CAP) digest = digest.slice(0, DIGEST_CAP)
  return digest
}

export function buildInitPrompt(digest: string): string {
  return `${BOT_INIT_SENTINEL}\n下面是这部作品的概况，由 Editor 读取文件整理而成，不是作者的消息。\n\n${digest}${BOT_INIT_PROMPT_TAIL}`
}
