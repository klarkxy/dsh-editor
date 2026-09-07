import { createElement as e, useEffect, useRef, type KeyboardEvent } from 'react'
import { importSummary, type ImportFlow } from './import-flow.ts'
import { t } from '../i18n/index.ts'

function ImportDialog(props: { flow: ImportFlow; onCancel(): void; onApply(): void; onContinue(): void; onCleanup(): void }) {
  const focus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLElement | null>(null)
  useEffect(() => { if (focus.current) focus.current.focus(); else dialog.current?.focus() }, [props.flow.kind])
  if (props.flow.kind === 'idle') return null
  const working = props.flow.kind === 'working'
  const recover = props.flow.kind === 'recover'
  const cleanup = props.flow.kind === 'cleanup-confirm'
  const probe = props.flow.kind === 'review' || props.flow.kind === 'recover' ? props.flow.probe : undefined
  const cleaning = recover && probe?.message === 'cleaning'
  return e('div', {
    className: 'import-overlay',
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && !working) props.onCancel()
      if (event.key !== 'Tab' || working || !dialog.current) return
      const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
      if (!buttons.length) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    },
  },
    e('section', { ref: dialog, className: 'import-dialog', role: 'dialog', tabIndex: -1, 'aria-modal': true, 'aria-labelledby': 'import-dialog-title' },
      e('h2', { id: 'import-dialog-title' }, working ? t('import.working') : cleanup ? t('import.cleanupTitle') : recover ? t('import.recoverTitle') : t('import.confirmTitle')),
      working ? e('p', { role: 'status', 'aria-live': 'polite' }, props.flow.kind === 'working' ? props.flow.message : '')
        : cleanup ? e('p', null, t('import.cleanupBody'))
          : recover ? e('div', null,
            e('p', null, cleaning ? t('import.cleanupOnly') : t('import.recoverBody', { summary: importSummary(probe!) })),
            probe?.message && !cleaning ? e('p', { className: 'warning', role: 'alert' }, probe.message) : null,
          )
            : e('div', null,
              e('p', null, t('import.reviewBody', { summary: importSummary(probe!) })),
              probe!.skipped.length ? e('p', null, t('import.skipCount', { count: probe!.skipped.length })) : null,
              e('ul', null, probe!.preview.map((item: string) => e('li', { key: item }, item))),
              probe!.skipped.length ? e('ul', { 'aria-label': t('import.skipExamples') }, probe!.skipped.slice(0, 8).map((item) => e('li', { key: `${item.reason}:${item.path}` }, `${item.path} — ${item.reason}`))) : null,
            ),
      !working ? e('footer', null,
        e('button', { ref: focus, type: 'button', onClick: props.onCancel }, t('common.cancel')),
        recover && !cleaning ? e('button', { type: 'button', onClick: props.onContinue }, t('import.continue')) : null,
        recover ? e('button', { type: 'button', onClick: () => props.onCleanup() }, t('import.cleanupAction')) : null,
        cleanup ? e('button', { type: 'button', onClick: props.onCleanup }, t('import.confirmCleanup')) : null,
        props.flow.kind === 'review' ? e('button', { type: 'button', onClick: props.onApply }, t('import.start')) : null,
      ) : null,
    ),
  )
}

export { ImportDialog }
