/** 添加插件对话框：检查 spec → 安装 → 结果，全部走官方 plugin-manager 服务。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge, Button as ThemeButton, Checkbox, Dialog, DialogTitle, Disclosure, Input, Notice, Select, Spinner,
} from '../ui/index.ts'
import { t } from '../i18n/index.ts'
import { isImeEvent } from '../ui/ime.ts'
import type { PluginManagerStore, PluginSpecInspection, PluginManagerSnapshot } from './plugin-manager.ts'
import { installViewOf, REFUSAL_PROBLEM_KEYS } from '../model/plugin-install-flow.ts'

export type InstallDialogRequest = { spec?: string; inspect: boolean } | undefined

export function PluginInstallDialog(props: {
  open: boolean
  store: PluginManagerStore | undefined
  snapshot: PluginManagerSnapshot
  /** Initial spec + whether to run 检查 immediately (discovery prefill). */
  request: InstallDialogRequest
  onOpenChange(open: boolean): void
  onConsumed(): void
  /** Open the installed plugin's detail once the install lands. */
  onOpenPlugin(packageName: string): void
}) {
  const { store, snapshot } = props
  const [spec, setSpec] = useState('')
  const [registry, setRegistry] = useState<string | undefined>(undefined)
  const [inspection, setInspection] = useState<PluginSpecInspection | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [enableAfter, setEnableAfter] = useState(true)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [registries, setRegistries] = useState<Array<{ value: string; label: string }>>([])
  const specRef = useRef<HTMLInputElement>(null)

  /* A prefill request resets the dialog; an already-running install re-shows. */
  useEffect(() => {
    if (!props.request) return
    setSpec(props.request.spec ?? '')
    setInspection(undefined)
    setApproved(new Set())
    if (props.request.inspect && props.request.spec) void runCheck(props.request.spec)
    props.onConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request])

  useEffect(() => {
    if (!props.open || !store) return
    void store.registries().then(result => {
      if (!result.ok || !result.value) return
      const list: Array<{ value: string; label: string }> = []
      if (result.value.registry !== undefined && result.value.registry !== null) list.push({ value: result.value.registry, label: result.value.registry })
      for (const fb of result.value.fallbackRegistries ?? []) if (!list.some(o => o.value === fb)) list.push({ value: fb, label: fb })
      if (result.value.resolved && !list.some(o => o.value === result.value.resolved)) list.unshift({ value: result.value.resolved, label: result.value.resolved })
      setRegistries(list)
    })
  }, [props.open, store])

  const runCheck = useCallback(async (value?: string) => {
    const specText = (value ?? spec).trim()
    if (!specText || !store) return
    setChecking(true)
    setInspection(undefined)
    const result = await store.inspect(specText, registry as string | null | undefined)
    setChecking(false)
    if (result.ok) setInspection(result.value)
    else setInspection({ status: 'refused', problem: 'unknown', reason: result.error.message ?? '' })
  }, [spec, registry, store])

  const runInstall = useCallback((approvedBuilds?: string[]) => {
    const specText = spec.trim()
    if (!specText || !store) return
    void store.install(specText, {
      enabled: enableAfter,
      ...(registry !== undefined ? { registry: registry as string } : {}),
      ...(approvedBuilds ? { approvedBuilds } : {}),
    })
  }, [spec, enableAfter, registry, store])

  const view = installViewOf(snapshot.install, inspection)
  const installBusy = view.kind === 'installing'
  const close = () => props.onOpenChange(false)

  const footer = view.kind === 'input' ? <>
    <ThemeButton variant="secondary" onClick={close}>{t('common.cancel')}</ThemeButton>
    <ThemeButton variant="primary" disabled={!spec.trim() || checking || !store}
      data-testid="plugin-install-check" onClick={() => void runCheck()}>
      {checking ? t('plugins.installChecking') : t('plugins.installCheck')}
    </ThemeButton>
  </> : view.kind === 'inspected' ? <>
    <ThemeButton variant="secondary" data-testid="plugin-install-back" onClick={() => setInspection(undefined)}>{t('plugins.installBack')}</ThemeButton>
    <ThemeButton variant="primary" data-testid="plugin-install-submit"
      disabled={view.accepted.bundle === false} onClick={() => runInstall()}>
      {t('plugins.installSubmit')}
    </ThemeButton>
  </> : view.kind === 'refused' ? <>
    <ThemeButton variant="secondary" onClick={() => setInspection(undefined)}>{t('plugins.installBack')}</ThemeButton>
    {view.problem === 'already-installed' && view.refused.reason
      ? null : null}
  </> : view.kind === 'installing' ? <>
    <ThemeButton variant="secondary" data-testid="plugin-install-cancel" disabled={view.cancelling}
      onClick={() => void store?.cancelInstall()}>{t('common.cancel')}</ThemeButton>
  </> : view.kind === 'result' ? <>
    {view.result === 'applied' && view.bundle
      ? <ThemeButton variant="secondary" data-testid="plugin-install-open" onClick={() => { close(); props.onOpenPlugin(view.bundle!) }}>{t('plugins.installOpen')}</ThemeButton>
      : view.result === 'failed' && !view.pendingBuilds
        ? <ThemeButton variant="secondary" data-testid="plugin-install-retry" onClick={() => runInstall()}>{t('plugins.installRetry')}</ThemeButton>
        : null}
    {view.result === 'failed' && view.pendingBuilds
      ? <ThemeButton variant="primary" data-testid="plugin-install-approve" disabled={approved.size === 0}
        onClick={() => runInstall([...approved])}>{t('plugins.installApproveRetry')}</ThemeButton>
      : null}
    <ThemeButton variant={view.result === 'applied' ? 'primary' : 'secondary'} data-testid="plugin-install-done" onClick={close}>{t('plugins.installDone')}</ThemeButton>
  </> : <ThemeButton variant="secondary" onClick={close}>{t('common.cancel')}</ThemeButton>

  return <Dialog open={props.open} onOpenChange={props.onOpenChange} size="md" titleHidden
    testid="plugin-install-dialog" initialFocusRef={specRef} footer={footer}>
    <DialogTitle asChild><h2 className="plugin-install-dialog__title">{t('plugins.installTitle')}</h2></DialogTitle>

    {view.kind === 'input' || view.kind === 'inspected' || view.kind === 'refused' ? <div className="plugin-install-field">
      <Input ref={specRef} value={spec} onChange={setSpec} data-testid="plugin-install-spec"
        placeholder={t('plugins.installSpecHint')} disabled={installBusy}
        onKeyDown={(event) => { if (event.key === 'Enter' && !isImeEvent(event.nativeEvent)) { event.preventDefault(); void runCheck() } }} />
      <Disclosure summary={t('plugins.installAdvanced')} className="plugin-install-advanced">
        {registries.length ? <Select value={registry ?? ''} onValueChange={(v: string) => setRegistry(v || undefined)}
          options={[{ value: '', label: t('plugins.installRegistryDefault') }, ...registries]}
          aria-label={t('plugins.installRegistry')} /> : null}
      </Disclosure>
    </div> : null}

    {view.kind === 'inspected' ? <div className="plugin-install-summary" data-testid="plugin-install-inspected">
      <p className="plugin-install-name">{view.accepted.name ?? spec}{view.accepted.version ? ` ${view.accepted.version}` : ''}</p>
      {view.accepted.description ? <p className="plugin-install-desc">{view.accepted.description}</p> : null}
      <p className="plugin-install-meta">
        {t('plugins.installKind')}: {t(`plugins.installKind.${view.accepted.kind}` as never)}
        {' · '}{t('plugins.installSource')}: {view.accepted.kind === 'registry' ? (view.accepted.registry ?? t('plugins.installRegistryDefault')) : (view.accepted.host ?? view.accepted.registry ?? t('plugins.installRegistryDefault'))}
      </p>
      {view.accepted.bundle === false ? <Notice tone="warning" title={t('plugins.installNotBundle')} /> : null}
      <Checkbox checked={enableAfter} onCheckedChange={(v) => setEnableAfter(v === true)}
        label={t('plugins.installEnableAfter')} data-testid="plugin-install-enable" />
    </div> : null}

    {view.kind === 'refused' ? <div data-testid="plugin-install-refused">
      <Notice tone="danger" title={t(REFUSAL_PROBLEM_KEYS[view.problem] as never)} />
      <Disclosure summary={t('plugins.installReason')} className="plugin-install-reason">
        <pre className="plugin-install-log">{view.refused.reason}</pre>
      </Disclosure>
    </div> : null}

    {view.kind === 'installing' ? <div className="plugin-install-progress" data-testid="plugin-install-progress">
      <Spinner /><p>{view.cancelling ? t('plugins.installCancelling')
        : view.progress?.phase === 'applying' ? t('plugins.installApplying')
        : view.progress?.attempt ? t('plugins.installAttempt', { index: view.progress.attempt.index, total: view.progress.attempt.total })
        : t('plugins.installRunning')}</p>
      {snapshot.install.log ? <Disclosure summary={t('plugins.installLog')}>
        <pre className="plugin-install-log">{snapshot.install.log}</pre>
      </Disclosure> : null}
    </div> : null}

    {view.kind === 'result' ? <div data-testid="plugin-install-result">
      {view.result === 'applied' ? <Notice tone="success" title={t('plugins.installDoneName', { name: `${view.bundle ?? ''} ${view.version ?? ''}`.trim() })} />
        : view.result === 'restart-required' ? <Notice tone="warning" title={t('plugins.installRestart', { name: view.bundle ?? '' })} />
        : view.result === 'cancelled' ? <Notice tone="info" title={t('plugins.installCancelled')} />
        : <Notice tone="danger" title={view.message ?? t('plugins.installFailed')} />}
      {view.result === 'failed' && view.pendingBuilds ? <div className="plugin-install-builds">
        <p>{t('plugins.installBuildsHint')}</p>
        {view.pendingBuilds.map(name => <Checkbox key={name} checked={approved.has(name)}
          onCheckedChange={(v) => setApproved(prev => { const next = new Set(prev); v === true ? next.add(name) : next.delete(name); return next })}
          label={name} />)}
      </div> : null}
    </div> : null}

    {view.kind === 'unknown' ? <Notice tone="warning" title={t('plugins.installUnknown')} /> : null}
  </Dialog>
}
