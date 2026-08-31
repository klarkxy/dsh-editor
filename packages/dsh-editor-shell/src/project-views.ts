import { createElement as e, useState } from 'react'
import type { ChapterStatus, ProjectOverview } from 'dsh-editor-workbench/contracts'
import type { PreparedExport } from './export.ts'

export function chapterStatusText(status: ChapterStatus): string {
  if (status === 'revising') return '修订中'
  if (status === 'final') return '已定稿'
  return '草稿'
}

function modifiedText(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '修改时间未知'
}

function StatusSelect(props: { path: string; title: string; status: ChapterStatus; disabled?: boolean; onChange(path: string, status: ChapterStatus): void }) {
  return e('select', {
    value: props.status,
    disabled: props.disabled,
    'aria-label': `设置 ${props.title} 状态`,
    onChange: (event: { target: { value: string } }) => props.onChange(props.path, event.target.value as ChapterStatus),
  },
  e('option', { value: 'draft' }, '草稿'),
  e('option', { value: 'revising' }, '修订中'),
  e('option', { value: 'final' }, '已定稿'))
}

export function ProjectOverviewPanel(props: {
  overview: ProjectOverview | null
  busy: boolean
  error: string
  statusBusy: boolean
  onOpen(path: string): void
  onStatus(path: string, status: ChapterStatus): void
  onRetry(): void
}) {
  if (props.busy && !props.overview) return e('section', { className: 'project-view', 'aria-label': '作品概览' }, e('p', { role: 'status' }, '正在整理作品进度…'))
  if (!props.overview) return e('section', { className: 'project-view', 'aria-label': '作品概览' },
    e('h1', null, '作品概览'),
    e('p', { className: 'warning', role: 'alert' }, props.error || '作品进度暂时无法读取。正文仍可正常编辑。'),
    e('button', { type: 'button', onClick: props.onRetry }, '重新读取'))
  const view = props.overview
  return e('section', { className: 'project-view', 'aria-label': '作品概览' },
    e('header', null, e('div', null, e('small', null, 'PROJECT OVERVIEW'), e('h1', null, '作品进度')), e('button', { type: 'button', disabled: props.busy, onClick: props.onRetry }, props.busy ? '刷新中…' : '刷新')),
    props.error ? e('p', { className: 'warning', role: 'alert' }, props.error) : null,
    e('div', { className: 'overview-metrics' },
      e('article', null, e('strong', null, view.totals.chapters), e('span', null, '章节')),
      e('article', null, e('strong', null, view.totals.chars), e('span', null, '字')),
      e('article', null, e('strong', null, view.totals.byStatus.draft), e('span', null, '草稿')),
      e('article', null, e('strong', null, view.totals.byStatus.revising), e('span', null, '修订中')),
      e('article', null, e('strong', null, view.totals.byStatus.final), e('span', null, '已定稿')),
    ),
    view.recent ? e('p', { className: 'overview-recent' }, '最近编辑：', e('button', { type: 'button', onClick: () => props.onOpen(view.recent!.path) }, view.recent.title), e('small', null, modifiedText(view.recent.modifiedAt))) : null,
    view.truncated || view.skipped ? e('p', { className: 'warning' }, `概览已按安全上限生成${view.truncated ? '，部分文件未扫描' : ''}${view.skipped ? `；已跳过 ${view.skipped} 项` : ''}。`) : null,
    e('ol', { className: 'overview-list' }, view.chapters.map((chapter) => e('li', { key: chapter.path },
      e('button', { className: 'overview-open', type: 'button', onClick: () => props.onOpen(chapter.path) },
        e('strong', null, chapter.title),
        e('small', null, `${chapter.path} · ${chapter.chars} 字${chapter.empty ? ' · 空章' : ''}`)),
      e(StatusSelect, { path: chapter.path, title: chapter.title, status: chapter.status, disabled: props.statusBusy, onChange: props.onStatus }),
    ))),
  )
}

export function ProjectCardsPanel(props: {
  overview: ProjectOverview | null
  busy: boolean
  error: string
  statusBusy: boolean
  onOpen(path: string): void
  onStatus(path: string, status: ChapterStatus): void
  onRetry(): void
}) {
  const [tab, setTab] = useState<'chapters' | 'outlines'>('chapters')
  if (!props.overview) return e(ProjectOverviewPanel, props)
  const view = props.overview
  return e('section', { className: 'project-view cards-view', 'aria-label': '结构卡片' },
    e('header', null,
      e('div', null, e('small', null, 'STRUCTURE CARDS'), e('h1', null, '结构卡片')),
      e('nav', { className: 'card-tabs', 'aria-label': '卡片类型' },
        e('button', { type: 'button', 'aria-pressed': tab === 'chapters', onClick: () => setTab('chapters') }, '章节'),
        e('button', { type: 'button', 'aria-pressed': tab === 'outlines', onClick: () => setTab('outlines') }, '大纲')),
    ),
    props.error ? e('p', { className: 'warning', role: 'alert' }, props.error) : null,
    tab === 'chapters' ? e('div', { className: 'chapter-board' }, (['draft', 'revising', 'final'] as const).map((status) => e('section', { key: status, 'aria-label': chapterStatusText(status) },
      e('h2', null, chapterStatusText(status), e('small', null, view.chapters.filter((item) => item.status === status).length)),
      e('div', null, view.chapters.filter((item) => item.status === status).map((chapter) => e('article', { key: chapter.path, tabIndex: 0 },
        e('button', { className: 'card-open', type: 'button', onClick: () => props.onOpen(chapter.path) },
          e('strong', null, chapter.title),
          e('code', null, chapter.path),
          e('p', null, chapter.excerpt || (chapter.empty ? '空章' : '暂无摘要')),
          e('small', null, `${chapter.chars} 字 · ${modifiedText(chapter.modifiedAt)}`)),
        e(StatusSelect, { path: chapter.path, title: chapter.title, status: chapter.status, disabled: props.statusBusy, onChange: props.onStatus }),
      ))),
    ))) : e('div', { className: 'outline-cards' }, view.outlines.length ? view.outlines.map((outline) => e('article', { key: outline.path },
      e('button', { className: 'card-open', type: 'button', onClick: () => props.onOpen(outline.path) },
        e('strong', null, outline.title),
        e('code', null, outline.path),
        e('p', null, outline.excerpt || '暂无摘要'),
        e('small', null, `${outline.chars} 字 · ${modifiedText(outline.modifiedAt)}`)),
    )) : e('p', { className: 'muted' }, '还没有大纲文件。')),
  )
}

export function ExportPreviewDialog(props: { prepared: PreparedExport; busy: boolean; onCancel(): void; onConfirm(): void }) {
  const empty = props.prepared.chapters.filter((item) => item.empty)
  return e('div', { className: 'file-dialog-overlay', role: 'presentation' },
    e('section', { className: 'file-dialog export-preview-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'export-preview-title' },
      e('header', null, e('div', null, e('small', null, props.prepared.format === 'markdown' ? 'MARKDOWN' : 'TXT'), e('h2', { id: 'export-preview-title' }, '导出前检查'))),
      e('dl', { className: 'export-summary' },
        e('div', null, e('dt', null, '文件'), e('dd', null, props.prepared.filename)),
        e('div', null, e('dt', null, '章节'), e('dd', null, props.prepared.chapters.length)),
        e('div', null, e('dt', null, '总字数'), e('dd', null, props.prepared.totalChars))),
      empty.length ? e('p', { className: 'warning', role: 'alert' }, `有 ${empty.length} 个空章，仍会包含在导出文件中。`) : null,
      e('ol', { className: 'export-chapters' }, props.prepared.chapters.map((chapter, index) => e('li', { key: chapter.path }, e('span', null, `${index + 1}. ${chapter.path}`), e('small', null, `${chapter.chars} 字${chapter.empty ? ' · 空章' : ''}`)))),
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: props.onCancel }, '取消'),
        e('button', { className: 'primary-action', type: 'button', disabled: props.busy, onClick: props.onConfirm }, props.busy ? '生成中…' : '确认导出')),
    ))
}
