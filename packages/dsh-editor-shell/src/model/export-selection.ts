import { compareDocumentPaths } from './natural-order.ts'

/* §8 导出预检的选择模型：按目录分组的纯函数，供 export-dialog 渲染与
   单元测试复用。路径均为工作区相对路径（'正文/第一章.md'）。 */

export const BODY_DIR = '正文'

export type ExportDocGroup = {
  /** 目录路径；'' 表示工作区根目录下的散文件。 */
  dir: string
  paths: string[]
}

/** 文档按目录分组；组序与组内序都走自然排序（中文数字感知）。 */
export function groupExportDocuments(paths: readonly string[]): ExportDocGroup[] {
  const groups = new Map<string, string[]>()
  for (const path of [...paths].sort(compareDocumentPaths)) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const list = groups.get(dir)
    if (list) list.push(path)
    else groups.set(dir, [path])
  }
  return [...groups.entries()].map(([dir, groupPaths]) => ({ dir, paths: groupPaths }))
}

/** 默认只勾「正文」目录（含其子目录组）；没有正文组时全勾。 */
export function defaultExportSelection(groups: readonly ExportDocGroup[]): Set<string> {
  const body = groups.filter((group) => group.dir === BODY_DIR || group.dir.startsWith(`${BODY_DIR}/`))
  const source = body.length ? body : groups
  return new Set(source.flatMap((group) => group.paths))
}

/** 目录勾选态：全选 / 全不选 / 部分（indeterminate）。 */
export function dirSelectionState(group: ExportDocGroup, selected: ReadonlySet<string>): boolean | 'indeterminate' {
  const count = group.paths.filter((path) => selected.has(path)).length
  return count === 0 ? false : count === group.paths.length ? true : 'indeterminate'
}

export function setDocSelection(selected: ReadonlySet<string>, path: string, on: boolean): Set<string> {
  const next = new Set(selected)
  if (on) next.add(path)
  else next.delete(path)
  return next
}

export function setDirSelection(group: ExportDocGroup, selected: ReadonlySet<string>, on: boolean): Set<string> {
  const next = new Set(selected)
  for (const path of group.paths) {
    if (on) next.add(path)
    else next.delete(path)
  }
  return next
}
