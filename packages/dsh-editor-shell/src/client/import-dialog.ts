import { createElement as e, useRef } from 'react'
import { importSummary, type ImportFlow } from './import-flow.ts'
import { t } from '../i18n/index.ts'
import { Button, Dialog } from './ui/index.ts'

function ImportDialog(props: { flow: ImportFlow; onCancel(): void; onApply(): void; onContinue(): void; onCleanup(): void }) {
  const focus = useRef<HTMLButtonElement | null>(null)
  const open = props.flow.kind !== 'idle'
  const shown = useRef(props.flow)
  if (open) shown.current = props.flow
  const flow = shown.current
  const working = flow.kind === 'working'
  const recover = flow.kind === 'recover'
  const cleanup = flow.kind === 'cleanup-confirm'
  const probe = flow.kind === 'review' || flow.kind === 'recover' ? flow.probe : undefined
  const cleaning = recover && probe?.message === 'cleaning'
  const title = working ? t('import.working') : cleanup ? t('import.cleanupTitle') : recover ? t('import.recoverTitle') : t('import.confirmTitle')
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !working) props.onCancel() },
    title,
    className: 'file-dialog import-dialog',
    overlayClassName: 'file-dialog-overlay import-overlay',
    dismissible: !working,
    initialFocusRef: focus,
  },
    e('header', null, e('h2', { id: 'import-dialog-title' }, title)),
    working ? e('p', { role: 'status', 'aria-live': 'polite' }, flow.kind === 'working' ? flow.message : '')
      : cleanup ? e('p', null, t('import.cleanupBody'))
        : recover ? e('div', null,
          e('p', null, cleaning ? t('import.cleanupOnly') : t('import.recoverBody', { summary: importSummary(probe!) })),
          probe?.message && !cleaning ? e('p', { className: 'warning', role: 'alert' }, probe.message) : null,
        )
          : probe ? e('div', null,
            e('p', null, t('import.reviewBody', { summary: importSummary(probe) })),
            probe.skipped.length ? e('p', null, t('import.skipCount', { count: probe.skipped.length })) : null,
            e('ul', null, probe.preview.map((item: string) => e('li', { key: item }, item))),
            probe.skipped.length ? e('ul', { 'aria-label': t('import.skipExamples') }, probe.skipped.slice(0, 8).map((item) => e('li', { key: `${item.reason}:${item.path}` }, `${item.path} — ${item.reason}`))) : null,
          ) : null,
    !working ? e('footer', null,
      e(Button, { ref: focus, onClick: props.onCancel }, t('common.cancel')),
      recover && !cleaning ? e(Button, { onClick: props.onContinue }, t('import.continue')) : null,
      recover ? e(Button, { onClick: () => props.onCleanup() }, t('import.cleanupAction')) : null,
      cleanup ? e(Button, { onClick: props.onCleanup }, t('import.confirmCleanup')) : null,
      flow.kind === 'review' ? e(Button, { variant: 'primary', className: 'primary-action', onClick: props.onApply }, t('import.start')) : null,
    ) : null,
  )
}

export { ImportDialog }
