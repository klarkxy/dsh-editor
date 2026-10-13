/* 首页「继续写作」与最近作品行使用的“上次位置”记录。
   每个作品记一条 { path, title, excerpt }：标题与概览同一来源
   （readableDocumentTitle：首个标题，退回文件名），摘录取首个非空正文行。
   localStorage 不可用时静默降级为不记忆。 */
import { readableDocumentTitle } from '../wrap-up-view.ts'
import { recentWorkPath } from '../home-stage.ts'

export type HomeResumeDoc = {
  path: string
  title: string
  excerpt?: string
}

export const HOME_RESUME_KEY = 'dsh-editor.home.last-doc'

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function storage(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function readHomeResumeMap(store: KeyValueStore | undefined = storage()): Record<string, HomeResumeDoc> {
  if (!store) return {}
  try {
    const raw = store.getItem(HOME_RESUME_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, HomeResumeDoc>
    if (!parsed || typeof parsed !== 'object') return {}
    const map: Record<string, HomeResumeDoc> = {}
    for (const [workspaceId, doc] of Object.entries(parsed)) {
      if (doc && typeof doc.path === 'string' && typeof doc.title === 'string') {
        map[workspaceId] = { path: doc.path, title: doc.title, excerpt: typeof doc.excerpt === 'string' ? doc.excerpt : undefined }
      }
    }
    return map
  } catch {
    return {}
  }
}

export function writeHomeResumeDoc(workspaceId: string, doc: HomeResumeDoc, store: KeyValueStore | undefined = storage()): void {
  if (!store || !workspaceId || !doc.path) return
  try {
    const map = readHomeResumeMap(store)
    map[workspaceId] = doc
    store.setItem(HOME_RESUME_KEY, JSON.stringify(map))
  } catch { /* 记忆是增强，写不进就跳过 */ }
}

export function removeHomeResumeDoc(workspaceId: string, store: KeyValueStore | undefined = storage()): void {
  if (!store) return
  try {
    const map = readHomeResumeMap(store)
    if (!(workspaceId in map)) return
    delete map[workspaceId]
    store.setItem(HOME_RESUME_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

/* 摘录：跳过 BOM 与 frontmatter 后，取第一条既不是 ATX 标题也非空白的行，
   折叠空白。没有正文行（只有标题或全空）时返回 undefined，由界面省略该行。 */
export function chapterExcerpt(text: string, limit = 90): string | undefined {
  const paper = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  const closed = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(paper)
  const body = closed ? paper.slice(closed[0].length) : paper
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#{1,6}\s/.test(trimmed)) continue
    const compact = trimmed.replace(/\s+/g, ' ')
    return compact.length <= limit ? compact : `${compact.slice(0, limit).trimEnd()}…`
  }
  return undefined
}

export function deriveHomeResumeDoc(path: string, text: string): HomeResumeDoc {
  const title = readableDocumentTitle(path, text)
  const excerpt = chapterExcerpt(text)
  return excerpt ? { path, title, excerpt } : { path, title }
}

/** 最近作品行的右对齐信息与第二行条目；第二行条目为两段独立 span。
   lineInfo 是作品位置（目录末尾两段，如 …\Writing\ux-work），不是章节路径：
   章节名已经在第二行，再显示一遍还带扩展名反而重复。路径拿不到时返回空串，
   由界面收起信息区与点线。 */
export function recentWorkRowMeta(
  workspace: { path?: string; updatedAt?: string },
  resume: HomeResumeDoc | undefined,
  formatTime: (iso: string | undefined) => string,
): { lineInfo: string; meta: string[] } {
  const meta: string[] = []
  const time = formatTime(workspace.updatedAt)
  if (time) meta.push(time)
  if (resume?.title) meta.push(resume.title)
  return { lineInfo: recentWorkPath(workspace.path ?? ''), meta }
}
