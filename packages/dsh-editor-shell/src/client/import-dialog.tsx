import { useRef } from 'react';
import { importSummary, type ImportFlow } from './import-flow.ts'
import { t } from '../i18n/index.ts'
import { ActivityRing, ActivityText, Button, Dialog } from './ui/index.ts'

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
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !working) props.onCancel() }}
      title={title}
      className="file-dialog import-dialog"
      overlayClassName="file-dialog-overlay import-overlay"
      dismissible={!working}
      initialFocusRef={focus}>
      <header>
        <h2 id="import-dialog-title">
          {title}
        </h2>
      </header>
      {working ? <div className="import-working">
        <ActivityRing size={22} />
        <ActivityText cue="none">
          {flow.kind === 'working' ? flow.message : ''}
        </ActivityText>
      </div>
        : cleanup ? <p>
        {t('import.cleanupBody')}
      </p>
          : recover ? <div>
        <p>
          {cleaning ? t('import.cleanupOnly') : t('import.recoverBody', { summary: importSummary(probe!) })}
        </p>
        {probe?.message && !cleaning ? <p className="warning" role="alert">
          {probe.message}
        </p> : null}
      </div>
            : probe ? <div>
        <p>
          {t('import.reviewBody', { summary: importSummary(probe) })}
        </p>
        {probe.skipped.length ? <p>
          {t('import.skipCount', { count: probe.skipped.length })}
        </p> : null}
        <ul>
          {probe.preview.map((item: string) => <li key={item}>
            {item}
          </li>)}
        </ul>
        {probe.skipped.length ? <ul aria-label={t('import.skipExamples')}>
          {probe.skipped.slice(0, 8).map((item) => <li key={`${item.reason}:${item.path}`}>
            {`${item.path} — ${item.reason}`}
          </li>)}
        </ul> : null}
      </div> : null}
      {!working ? <footer>
        <Button ref={focus} onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        {recover && !cleaning ? <Button onClick={props.onContinue}>
          {t('import.continue')}
        </Button> : null}
        {recover ? <Button onClick={() => props.onCleanup()}>
          {t('import.cleanupAction')}
        </Button> : null}
        {cleanup ? <Button onClick={props.onCleanup}>
          {t('import.confirmCleanup')}
        </Button> : null}
        {flow.kind === 'review' ? <Button variant="primary" className="primary-action" onClick={props.onApply}>
          {t('import.start')}
        </Button> : null}
      </footer> : null}
    </Dialog>
  );
}

export { ImportDialog }
