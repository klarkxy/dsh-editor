import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { ShellDialogProps, ShellToolSeatContext } from 'dsh-editor-seats'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { guardImeEnter, renderInput } from './host-ui.tsx'
import { t } from './messages.ts'

/* 活动暗示:三点呼吸(参数改写自 Amicro pulse-dots,MIT);装饰 aria-hidden,
   关键帧在 styles.ts。 */
const activityDots = () => <span className="panel-activity-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>

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

export function cardsPromptKeyDown(event: {
  key?: string
  preventDefault(): void
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}): boolean {
  return guardImeEnter(event)
}

export function TextPromptDialog(props: {
  Dialog?: ComponentType<ShellDialogProps>
  Button?: ShellToolSeatContext['Button']
  Input?: ShellToolSeatContext['Input']
  id: string
  open: boolean
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  note?: string
  busy?: boolean
  onCancel(): void
  onConfirm(value: string): void
}) {
  const [value, setValue] = useState(props.initialValue)
  const input = useRef<HTMLInputElement | null>(null)
  const shown = useRef({ title: props.title, label: props.label, confirmLabel: props.confirmLabel })
  const wasOpen = useRef(props.open)
  if (props.open) shown.current = { title: props.title, label: props.label, confirmLabel: props.confirmLabel }
  useEffect(() => {
    if (props.open && !wasOpen.current) setValue(props.initialValue)
    wasOpen.current = props.open
  }, [props.open, props.initialValue])
  const display = shown.current

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() && !props.busy) props.onConfirm(value.trim())
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    cardsPromptKeyDown(event)
  }

  const children = [
    <header key="header">
      <h2 id={`${props.id}-title`}>
        {display.title}
      </h2>
      <SeatButton
        host={props.Button}
        variant="icon"
        className="icon-button"
        aria-label={t('common.close')}
        disabled={props.busy}
        onClick={props.onCancel}>
        ×
      </SeatButton>
    </header>,
    <form key="form" onSubmit={submit}>
      <label>
        {display.label}
        {renderInput(props.Input, {
          ref: input,
          value,
          maxLength: 80,
          disabled: props.busy,
          'aria-label': display.label,
          onChange: setValue,
          onKeyDown: onInputKeyDown,
        })}
      </label>
      {props.note ? <p className="warning" role="alert">
        {props.note}
      </p> : null}
      <footer>
        <SeatButton host={props.Button} disabled={props.busy} onClick={props.onCancel}>
          {t('common.cancel')}
        </SeatButton>
        <SeatButton
          host={props.Button}
          variant="primary"
          className="primary-action"
          type="submit"
          disabled={props.busy || !value.trim()}>
          {props.busy ? <Fragment>
            {activityDots()}
            {t('common.saving')}
          </Fragment> : display.confirmLabel}
        </SeatButton>
      </footer>
    </form>,
  ]

  if (props.Dialog) {
    return (
      <props.Dialog
        open={props.open}
        onOpenChange={(next: boolean) => { if (!next && !props.busy) props.onCancel() }}
        title={display.title}
        className="file-dialog prompt-dialog"
        overlayClassName="file-dialog-overlay"
        dismissible={!props.busy}
        initialFocusRef={input}>
        {children}
      </props.Dialog>
    );
  }

  if (!props.open) return null
  return (
    <NativePromptFallback
      busy={props.busy}
      titleId={`${props.id}-title`}
      firstFocus={() => { input.current?.focus(); input.current?.select() }}
      onCancel={props.onCancel}>
      {children}
    </NativePromptFallback>
  );
}

export function ConfirmDialog(props: {
  Dialog?: ComponentType<ShellDialogProps>
  Button?: ShellToolSeatContext['Button']
  id: string
  open: boolean
  title: string
  message: string
  confirmLabel: string
  onCancel(): void
  onConfirm(): void
}) {
  const confirm = useRef<HTMLButtonElement | null>(null)
  const children = [
    <header key="header">
      <h2 id={`${props.id}-title`}>
        {props.title}
      </h2>
      <SeatButton
        host={props.Button}
        variant="icon"
        className="icon-button"
        aria-label={t('common.close')}
        onClick={props.onCancel}>
        ×
      </SeatButton>
    </header>,
    <p key="message">
      {props.message}
    </p>,
    <footer key="footer">
      <SeatButton host={props.Button} onClick={props.onCancel}>
        {t('common.cancel')}
      </SeatButton>
      <SeatButton
        host={props.Button}
        variant="primary"
        className="primary-action"
        ref={confirm}
        onClick={props.onConfirm}>
        {props.confirmLabel}
      </SeatButton>
    </footer>,
  ]

  if (props.Dialog) {
    return (
      <props.Dialog
        open={props.open}
        onOpenChange={(next: boolean) => { if (!next) props.onCancel() }}
        title={props.title}
        className="file-dialog prompt-dialog"
        overlayClassName="file-dialog-overlay"
        dismissible={true}
        initialFocusRef={confirm}>
        {children}
      </props.Dialog>
    );
  }

  if (!props.open) return null
  return (
    <NativePromptFallback
      titleId={`${props.id}-title`}
      firstFocus={() => confirm.current?.focus()}
      onCancel={props.onCancel}>
      {children}
    </NativePromptFallback>
  );
}

function NativePromptFallback(props: {
  busy?: boolean
  titleId: string
  firstFocus(): void
  onCancel(): void
  children?: unknown
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  useDialogReturnFocus(dialog, props.firstFocus)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onCancel(); return }
    focusableBoundary(dialog.current, event)
  }
  return (
    <div
      className="file-dialog-overlay"
      onClick={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget && !props.busy) props.onCancel()
      }}>
      <div
        ref={dialog}
        className="file-dialog prompt-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby={props.titleId}
        onKeyDown={onKeyDown}>
        {props.children as never}
      </div>
    </div>
  );
}
