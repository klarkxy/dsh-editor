import { createElement as e } from 'react'
import type { ChapterStatus } from 'dsh-editor-workbench/contracts'
import type { PreparedExport } from './export.ts'

export function chapterStatusText(status: ChapterStatus): string {
  if (status === 'revising') return '修订中'
  if (status === 'final') return '已定稿'
  return '草稿'
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
