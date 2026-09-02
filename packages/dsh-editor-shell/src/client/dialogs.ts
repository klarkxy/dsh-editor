import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { DocumentKind } from '../project-files.ts'

/** Lock the focus inside a dialog and restore it on close. */
function useDialogReturnFocus(dialogRef: { current: HTMLElement | null }, firstFocus: () => void) {
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    globalThis.setTimeout(firstFocus, 0)
    return () => {
      const target = returnFocus.current
      globalThis.setTimeout(() => { if (target?.isConnected) target.focus() }, 0)
    }
  }, [])
  return dialogRef
}

function focusableBoundary(dialog: HTMLElement | null, event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab' || !dialog) return
  const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])')]
  if (!controls.length) return
  const first = controls[0]!
  const last = controls.at(-1)!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

export function ConfirmDialog(props: {
  id: string
  title: string
  message: string
  confirmLabel: string
  onCancel(): void
  onConfirm(): void
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  const cancel = useRef<HTMLButtonElement | null>(null)
  useDialogReturnFocus(dialog, () => cancel.current?.focus())
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onCancel(); return }
    focusableBoundary(dialog.current, event)
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog confirm-dialog', role: 'alertdialog', 'aria-modal': true, 'aria-labelledby': `${props.id}-title`, 'aria-describedby': `${props.id}-message`, onKeyDown },
      e('header', null, e('h2', { id: `${props.id}-title` }, props.title)),
      e('p', { id: `${props.id}-message` }, props.message),
      e('footer', null,
        e('button', { ref: cancel, type: 'button', onClick: props.onCancel }, '取消'),
        e('button', { className: 'danger-action', type: 'button', onClick: props.onConfirm }, props.confirmLabel),
      ),
    ),
  )
}

export function TextPromptDialog(props: {
  id: string
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  onCancel(): void
  onConfirm(value: string): void
}) {
  const [value, setValue] = useState(props.initialValue)
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  useDialogReturnFocus(dialog, () => { input.current?.focus(); input.current?.select() })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onCancel(); return }
    focusableBoundary(dialog.current, event)
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog prompt-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${props.id}-title`, onKeyDown },
      e('header', null,
        e('h2', { id: `${props.id}-title` }, props.title),
        e('button', { className: 'icon-button', type: 'button', 'aria-label': '关闭', onClick: props.onCancel }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (value.trim()) props.onConfirm(value.trim()) } },
        e('label', null, props.label, e('input', { ref: input, value, maxLength: 80, onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value) })),
        e('footer', null,
          e('button', { type: 'button', onClick: props.onCancel }, '取消'),
          e('button', { className: 'primary-action', type: 'submit', disabled: !value.trim() }, props.confirmLabel),
        ),
      ),
    ),
  )
}

export type CreateDocumentRequest = { kind: DocumentKind | 'group'; directory: string }

const CREATE_LABEL: Record<DocumentKind | 'group', string> = {
  group: '卷或部名称',
  chapter: '章节标题',
  outline: '大纲名称',
  character: '人物名称',
  world: '设定名称',
}

const CREATE_HEADING: Record<DocumentKind | 'group', string> = {
  group: '新建卷/部',
  chapter: '新建章节',
  outline: '新建大纲',
  character: '新建人物',
  world: '新建设定',
}

export function CreateDocumentDialog(props: {
  request: CreateDocumentRequest
  busy: boolean
  note: string
  onClose(): void
  onCreate(title: string): void
}) {
  const { request } = props
  const [title, setTitle] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => { setTitle(''); globalThis.setTimeout(() => input.current?.focus(), 0) }, [request.kind, request.directory])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onClose(); return }
    focusableBoundary(dialog.current, event)
  }
  const label = CREATE_LABEL[request.kind]
  const heading = CREATE_HEADING[request.kind]
  const placeholder = request.kind === 'group'
    ? '例如：第一卷'
    : request.kind === 'chapter'
      ? '例如：第一章 风起'
      : ''
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog create-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'create-dialog-title', onKeyDown },
      e('header', null,
        e('div', null,
          e('h2', { id: 'create-dialog-title' }, heading),
          e('small', null, request.kind === 'group' ? '将在作品文件夹中创建目录；现有章节不会移动。' : `保存到 ${request.directory}`),
        ),
        e('button', { className: 'icon-button', type: 'button', disabled: props.busy, 'aria-label': '关闭', onClick: props.onClose }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (title.trim()) props.onCreate(title.trim()) } },
        e('label', null, label,
          e('input', {
            ref: input,
            value: title,
            maxLength: 80,
            placeholder,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value),
          }),
        ),
        props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
        e('footer', null,
          e('button', { type: 'button', disabled: props.busy, onClick: props.onClose }, '取消'),
          e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !title.trim() }, props.busy ? '创建中…' : '创建'),
        ),
      ),
    ),
  )
}

export function NewProjectDialog(props: {
  busy: boolean
  note: string
  onClose(): void
  onCreate(title: string): void
}) {
  const [title, setTitle] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  useDialogReturnFocus(dialog, () => input.current?.focus())
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onClose(); return }
    focusableBoundary(dialog.current, event)
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog create-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'new-project-dialog-title', onKeyDown },
      e('header', null,
        e('div', null,
          e('h2', { id: 'new-project-dialog-title' }, '新建作品'),
          e('small', null, '将保存在「文档/dsh-editor」下。'),
        ),
        e('button', { className: 'icon-button', type: 'button', disabled: props.busy, 'aria-label': '关闭', onClick: props.onClose }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (title.trim()) props.onCreate(title.trim()) } },
        e('label', null, '作品名称',
          e('input', {
            ref: input,
            value: title,
            maxLength: 80,
            placeholder: '例如：未名之书',
            onChange: (event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value),
          }),
        ),
        props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
        e('footer', null,
          e('button', { type: 'button', disabled: props.busy, onClick: props.onClose }, '取消'),
          e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !title.trim() }, props.busy ? '创建中…' : '创建'),
        ),
      ),
    ),
  )
}
