/**
 * 知乎设置页:对接编辑器搭档的知乎开放平台工具(站内搜索、全网搜索、热榜、直答、公开知识库检索)。
 * - 凭证引用固定为 `ZHIHU_ACCESS_TOKEN`,通过 `credentials.describe` / `set` / `unset` 维护。
 * - 视图结构与 settings-models.tsx 的 ProviderEditor 卡片一致,只做"单凭据"剪裁。
 * - 页内附加:Access Secret 获取引导(复制控制台链接,仅未配置时显示)与近 30 天调用用量图表,
 *   用量数据经 `/manuscript` 通道的 `zhihu.usage` RPC 读取。
 */
import {
  createElement as e,
  useEffect,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { CredentialView, RpcResponse, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { apiKeyFailure } from './settings-models-store.ts'
import type { ShellContext } from './shared.ts'
import { windowBridge } from './window-controls.tsx'
import { t, useLocale } from '../i18n/index.ts'

const ZHIHU_REF = 'ZHIHU_ACCESS_TOKEN'
const ZHIHU_CONSOLE_URL = 'https://developer.zhihu.com'

function text() {
  return {
  intro: t('zhihu.intro'),
  guideTitle: t('zhihu.guideTitle'),
  guideSteps: [
    t('zhihu.guideStep1'),
    t('zhihu.guideStep2'),
    t('zhihu.guideStep3'),
  ],
  help: t('zhihu.help'),
  statusHeading: t('zhihu.status'),
  statusUnconfigured: t('zhihu.unconfigured'),
  statusStored: t('zhihu.stored'),
  statusLocked: t('zhihu.envLocked'),
  label: 'Access Secret',
  placeholderStored: t('zhihu.placeholderStored'),
  placeholderLocked: t('zhihu.placeholderLocked'),
  placeholder: t('zhihu.placeholder'),
  keyBlank: t('zhihu.keyBlank'),
  keyIllegal: t('zhihu.keyIllegal'),
  save: t('common.save'),
  saving: t('common.saving'),
  clear: t('common.clear'),
  clearing: t('zhihu.clearing'),
  loadFailed: t('zhihu.loadFailed'),
  retry: t('common.retry'),
  loadFailedPrefix: t('zhihu.loadFailedPrefix'),
  savedNote: t('common.saved'),
  clearedNote: t('zhihu.cleared'),
  usageTitle: t('zhihu.usageTitle'),
  usageIntro: t('zhihu.usageIntro'),
  usageLoading: t('zhihu.usageLoading'),
  usageLoadFailed: t('zhihu.usageFailed'),
  usageEmpty: t('zhihu.usageEmpty'),
  usageCalls: t('zhihu.calls'),
  usageFailure: t('zhihu.failure'),
  usageNote: t('zhihu.usageNote'),
  kbTitle: t('zhihu.kbTitle'),
  kbIntro: t('zhihu.kbIntro'),
  kbManageHint: t('zhihu.kbManage'),
  kbManageUrl: 'https://zhida.zhihu.com/repositories/square',
  kbBaseLabel: t('zhihu.kbBase'),
  kbDefaultBase: t('zhihu.kbDefault'),
  kbEmpty: t('zhihu.kbEmpty'),
  kbLoading: t('zhihu.kbLoading'),
  kbLoadFailed: t('zhihu.kbFailed'),
  kbRefresh: t('common.refresh'),
  kbFileLabel: t('zhihu.file'),
  kbNoFile: t('zhihu.noFile'),
  kbFileNote: t('zhihu.fileNote'),
  kbTooLarge: t('zhihu.tooLarge'),
  kbUpload: t('common.upload'),
  kbUploading: t('common.uploading'),
  kbUploadFailed: t('zhihu.uploadFailed'),
  kbUploaded: t('zhihu.uploaded'),
  kbNeedKey: t('zhihu.needKey'),
  }
}

const USAGE_DAYS = 30

type ZhihuDailyUsage = {
  date: string
  calls: number
  failures: number
  results: number
}

type ZhihuUsageSummary = { days: ZhihuDailyUsage[] }

function isZhihuUsageSummary(value: unknown): value is ZhihuUsageSummary {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { days?: unknown }).days)
}

function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? t('common.requestFailed')
}

function rpcResult<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}

type LoadState = {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  credential: CredentialView | undefined
}

const INITIAL_LOAD: LoadState = { status: 'loading', error: null, credential: undefined }

export function SettingsZhihuSection(props: { ctx: ShellContext }): ReactNode {
  useLocale()
  const [state, setState] = useState<LoadState>(INITIAL_LOAD)

  const load = async (): Promise<void> => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await props.ctx.connection.api.credentials.describe({ refs: [ZHIHU_REF] })
      const result = rpcResult<{ credentials: Record<string, CredentialView> }>(response)
      if (!result.ok) {
        setState({ status: 'error', error: failureMessage(result), credential: undefined })
        return
      }
      setState({ status: 'ready', error: null, credential: result.value.credentials[ZHIHU_REF] })
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error), credential: undefined })
    }
  }

  useEffect(() => {
    void load()
  }, [props.ctx])

  if (state.status === 'loading') {
    return e('section', { className: 'zhihu-page', 'aria-label': t('settings.zhihu') },
      e(Header, null),
      e('p', { className: 'zhihu-status', role: 'status' }, t('zhihu.reading')),
    )
  }

  if (state.status === 'error') {
    const message = state.error ?? text().loadFailed
    return e('section', { className: 'zhihu-page', 'aria-label': t('settings.zhihu') },
      e(Header, null),
      e('p', { className: 'zhihu-error', role: 'alert' },
        `${text().loadFailedPrefix}${message}`,
        e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, text().retry),
      ),
    )
  }

  return e(ZhihuEditor, {
    ctx: props.ctx,
    credential: state.credential,
    onSaved: load,
  })
}

function Header(props: { note?: string | null }): ReactNode {
  return e('header', { className: 'zhihu-header' },
    e('h2', { className: 'zhihu-title' }, t('settings.zhihu')),
    e('p', { className: 'zhihu-intro' }, text().intro),
    props.note ? e('p', { className: 'zhihu-saved', role: 'status' }, props.note) : null,
  )
}

/** 外链:桌面端走 preload 桥(主进程白名单校验后用系统浏览器打开),浏览器端回退 window.open。 */
function ExternalLink(props: { url: string; label: string }): ReactNode {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const bridge = windowBridge()
    if (bridge?.openExternal) { bridge.openExternal(props.url); return }
    window.open(props.url, '_blank', 'noopener,noreferrer')
  }
  return e('a', { className: 'zhihu-link', href: props.url, target: '_blank', rel: 'noreferrer', onClick }, props.label)
}

/** 获取 Access Secret 的引导:仅在未保存密钥时显示。 */
function Guide(): ReactNode {
  return e('section', { className: 'zhihu-guide', 'aria-label': text().guideTitle },
    e('h3', { className: 'zhihu-guide-title' }, text().guideTitle),
    e('ol', { className: 'zhihu-guide-steps' },
      e('li', null,
        text().guideSteps[0],
        e(ExternalLink, { url: ZHIHU_CONSOLE_URL, label: 'developer.zhihu.com' }),
      ),
      e('li', null, text().guideSteps[1]),
      e('li', null, text().guideSteps[2]),
    ),
  )
}

/** 与 dsh-editor-novel-kernel/src/zhihu-knowledge.ts 的 RPC 契约对应的浏览器侧类型。 */
type ZhihuKnowledgeBase = {
  id: string
  name: string
  isDefault: boolean
  contentCount: number
}

type KbListState =
  | { status: 'loading' }
  | { status: 'ready'; bases: ZhihuKnowledgeBase[] }
  | { status: 'error'; error: string }

function isKnowledgeBaseList(value: unknown): value is { bases: ZhihuKnowledgeBase[] } {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { bases?: unknown }).bases)
}

/** 分块 base64,避免一次性展开大字符串。 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

const KB_ACCEPT = '.pdf,.md,.txt,.ppt,.pptx,.xlsx,.xls,.docx,.doc,.webp,.png,.jpg,.mobi,.epub,.csv,.azw3'
const KB_MAX_BYTES = 20 * 1024 * 1024

/**
 * 知乎知识库管理:列库、手动选文件上传。上传只能由用户在这里显式发起,
 * 不暴露给搭档工具——文件会进入知乎云端。
 */
function KnowledgeBaseSection(props: { ctx: ShellContext; enabled: boolean }): ReactNode {
  const { ctx, enabled } = props
  const [list, setList] = useState<KbListState>({ status: 'loading' })
  const [baseId, setBaseId] = useState('')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = async (): Promise<void> => {
    if (!enabled) return
    setList({ status: 'loading' })
    try {
      const raw = await ctx.connection.rpc.call('/novel-kernel', 'zhihu.knowledge.bases', {})
      const result = raw as RpcResult<unknown>
      if (!result.ok) { setList({ status: 'error', error: failureMessage(result) }); return }
      if (!isKnowledgeBaseList(result.value)) { setList({ status: 'error', error: t('zhihu.contract') }); return }
      setList({ status: 'ready', bases: result.value.bases })
    } catch (error) {
      setList({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  useEffect(() => {
    void load()
  }, [ctx, enabled])

  const upload = async (): Promise<void> => {
    if (!file || busy) return
    setFailure(undefined)
    setNote(undefined)
    if (file.size > KB_MAX_BYTES) { setFailure(text().kbTooLarge); return }
    setBusy(true)
    try {
      const contentBase64 = toBase64(await file.arrayBuffer())
      const raw = await ctx.connection.rpc.call('/novel-kernel', 'zhihu.knowledge.upload', {
        fileName: file.name,
        contentBase64,
        ...(baseId ? { knowledgeBaseId: baseId } : {}),
      })
      const result = raw as RpcResult<unknown>
      if (!result.ok) { setFailure(`${text().kbUploadFailed}${failureMessage(result)}`); return }
      setNote(text().kbUploaded)
      setFile(undefined)
      setFileKey((key) => key + 1)
      await load()
    } catch (error) {
      setFailure(`${text().kbUploadFailed}${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return e('section', { className: 'zhihu-kb', 'aria-label': text().kbTitle },
    e('h3', { className: 'zhihu-usage-title' }, text().kbTitle),
    e('p', { className: 'zhihu-usage-intro' }, text().kbIntro),
    e('p', { className: 'zhihu-usage-intro' },
      text().kbManageHint,
      e(ExternalLink, { url: text().kbManageUrl, label: 'zhida.zhihu.com/repositories/square' }),
    ),
    !enabled ? e('p', { className: 'zhihu-hint' }, text().kbNeedKey) : null,
    enabled && list.status === 'loading' ? e('p', { className: 'zhihu-status', role: 'status' }, text().kbLoading) : null,
    enabled && list.status === 'error' ? e('p', { className: 'zhihu-error', role: 'alert' },
      `${text().loadFailedPrefix}${list.error || text().kbLoadFailed}`,
      e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, text().retry),
    ) : null,
    enabled && list.status === 'ready' ? e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-kb-base' }, text().kbBaseLabel),
      e('div', { className: 'zhihu-kb-base-row' },
        e('select', {
          id: 'zhihu-kb-base',
          className: 'zhihu-input',
          value: baseId,
          disabled: busy,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => setBaseId(event.target.value),
        },
          e('option', { value: '' }, text().kbDefaultBase),
          ...list.bases.map((base) => e('option', { key: base.id, value: base.id },
            t('zhihu.baseOption', { name: base.name, default: base.isDefault ? t('zhihu.defaultMark') : '', count: base.contentCount }),
          )),
        ),
        e('button', { type: 'button', className: 'zhihu-button', disabled: busy, onClick: () => void load() }, text().kbRefresh),
      ),
      list.bases.length === 0 ? e('p', { className: 'zhihu-hint' }, text().kbEmpty) : null,
    ) : null,
    enabled && list.status === 'ready' ? e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-kb-file' }, text().kbFileLabel),
      e('input', {
        key: fileKey,
        id: 'zhihu-kb-file',
        type: 'file',
        accept: KB_ACCEPT,
        className: 'zhihu-kb-file',
        disabled: busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0]),
      }),
      e('p', { className: 'zhihu-hint' }, text().kbFileNote),
    ) : null,
    enabled && list.status === 'ready' ? e('div', { className: 'zhihu-actions' },
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-primary',
        disabled: busy || !file,
        onClick: () => void upload(),
      }, busy ? text().kbUploading : text().kbUpload),
    ) : null,
    note ? e('p', { className: 'zhihu-saved', role: 'status' }, note) : null,
    failure ? e('p', { className: 'zhihu-warning', role: 'alert' }, failure) : null,
  )
}

/** 近 30 天知乎能力调用用量:SVG 柱状图(成功/失败堆叠)。 */function ZhihuUsageSection(props: { ctx: ShellContext }): ReactNode {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; summary: ZhihuUsageSummary }
    | { status: 'error'; error: string }
  >({ status: 'loading' })

  const load = async (): Promise<void> => {
    setState({ status: 'loading' })
    try {
      const raw = await props.ctx.connection.rpc.call('/manuscript', 'zhihu.usage', { days: USAGE_DAYS })
      const result = raw as RpcResult<unknown>
      if (!result.ok) {
        setState({ status: 'error', error: failureMessage(result) })
        return
      }
      if (!isZhihuUsageSummary(result.value)) {
        setState({ status: 'error', error: t('zhihu.contract') })
        return
      }
      setState({ status: 'ready', summary: result.value })
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  useEffect(() => {
    void load()
  }, [props.ctx])

  if (state.status === 'loading') {
    return e('section', { className: 'zhihu-usage', 'aria-label': text().usageTitle },
      e('h3', { className: 'zhihu-usage-title' }, text().usageTitle),
      e('p', { className: 'zhihu-status', role: 'status' }, text().usageLoading),
    )
  }

  if (state.status === 'error') {
    return e('section', { className: 'zhihu-usage', 'aria-label': text().usageTitle },
      e('h3', { className: 'zhihu-usage-title' }, text().usageTitle),
      e('p', { className: 'zhihu-error', role: 'alert' },
        `${text().loadFailedPrefix}${state.error || text().usageLoadFailed}`,
        e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, text().retry),
      ),
    )
  }

  const days = state.summary.days
  const hasAny = days.some((day) => day.calls > 0)

  return e('section', { className: 'zhihu-usage', 'aria-label': text().usageTitle },
    e('h3', { className: 'zhihu-usage-title' }, text().usageTitle),
    e('p', { className: 'zhihu-usage-intro' }, text().usageIntro),
    !hasAny
      ? e('p', { className: 'zhihu-status' }, text().usageEmpty)
      : e(UsageChart, { days }),
    e('p', { className: 'zhihu-hint' }, text().usageNote),
  )
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 120
const CHART_PAD_BOTTOM = 16

/** 30 根柱子,成功段(下)+ 失败段(上)堆叠;高度按单日最大调用数归一。 */
function UsageChart(props: { days: ZhihuDailyUsage[] }): ReactNode {
  const days = props.days
  const maxCalls = Math.max(1, ...days.map((day) => day.calls))
  const slot = CHART_WIDTH / days.length
  const barWidth = Math.max(2, slot - 4)
  const plotHeight = CHART_HEIGHT - CHART_PAD_BOTTOM

  const bars = days.map((day, index) => {
    const x = index * slot + (slot - barWidth) / 2
    const failHeight = (day.failures / maxCalls) * plotHeight
    const okHeight = ((day.calls - day.failures) / maxCalls) * plotHeight
    const label = `${day.date.slice(5)}:${text().usageCalls} ${day.calls},${text().usageFailure} ${day.failures}`
    const parts: ReactNode[] = []
    if (okHeight > 0) {
      parts.push(e('rect', {
        key: 'ok',
        className: 'zhihu-chart-bar-ok',
        x, y: plotHeight - okHeight, width: barWidth, height: okHeight,
      }))
    }
    if (failHeight > 0) {
      parts.push(e('rect', {
        key: 'fail',
        className: 'zhihu-chart-bar-fail',
        x, y: plotHeight - okHeight - failHeight, width: barWidth, height: failHeight,
      }))
    }
    return e('g', { key: day.date }, e('title', null, label), ...parts)
  })

  const ticks = [0, Math.floor(days.length / 2), days.length - 1].map((index) => {
    const day = days[index]
    if (!day) return null
    return e('text', {
      key: day.date,
      className: 'zhihu-chart-tick',
      x: index * slot + slot / 2,
      y: CHART_HEIGHT - 2,
      textAnchor: 'middle',
    }, day.date.slice(5))
  })

  return e('svg', {
    className: 'zhihu-chart',
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    role: 'img',
    'aria-label': t('zhihu.usageTitleDays', { days: USAGE_DAYS }),
    preserveAspectRatio: 'none',
  }, ...bars, ...ticks)
}

function ZhihuEditor(props: {
  ctx: ShellContext
  credential: CredentialView | undefined
  onSaved(): Promise<void>
}): ReactNode {
  const { ctx, credential, onSaved } = props
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)

  const keyLocked = credential?.writable === false
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const configured = credential?.configured === true
  const placeholder = keyLocked
    ? text().placeholderLocked
    : configured
      ? text().placeholderStored
      : text().placeholder

  const statusText = keyLocked
    ? text().statusLocked
    : configured
      ? text().statusStored
      : text().statusUnconfigured

  const dotClass = keyLocked
    ? 'zhihu-dot zhihu-dot-locked'
    : configured
      ? 'zhihu-dot zhihu-dot-configured'
      : 'zhihu-dot zhihu-dot-missing'

  const save = async (): Promise<void> => {
    if (keyLocked) return
    if (keyFailure !== undefined) return
    if (keyValue.length === 0) return
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await ctx.connection.api.credentials.set({ ref: ZHIHU_REF, value: keyValue })
      const result = rpcResult<Record<string, never>>(response)
      if (!result.ok) { setFailure(failureMessage(result)); return }
      setKeyDraft('')
      setNote(text().savedNote)
      await onSaved()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    if (keyLocked) return
    if (!configured) return
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await ctx.connection.api.credentials.unset({ ref: ZHIHU_REF })
      const result = rpcResult<Record<string, never>>(response)
      if (!result.ok) { setFailure(failureMessage(result)); return }
      setKeyDraft('')
      setNote(text().clearedNote)
      await onSaved()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return e('section', { className: 'zhihu-page', 'aria-label': t('settings.zhihu') },
    e(Header, { note }),
    // 已保存(或环境变量锁定)密钥后不再需要获取引导。
    configured ? null : e(Guide, null),
    e('dl', { className: 'zhihu-status-grid' },
      e('dt', { className: 'zhihu-status-label' }, text().statusHeading),
      e('dd', { className: 'zhihu-status-value' },
        e('span', { className: dotClass, 'aria-hidden': true }),
        statusText,
      ),
    ),
    e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-access-secret' }, text().label),
      e('input', {
        id: 'zhihu-access-secret',
        type: 'password',
        autoComplete: 'off',
        className: 'zhihu-input',
        value: keyDraft,
        placeholder,
        'aria-invalid': keyFailure !== undefined,
        disabled: busy || keyLocked === true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value),
      }),
      keyFailure === undefined
        ? e('p', { className: 'zhihu-hint' }, text().help)
        : e('p', { className: 'zhihu-warning', role: 'alert' },
            keyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal,
          ),
    ),
    failure !== undefined ? e('p', { className: 'zhihu-warning', role: 'alert' }, failure) : null,
    e('div', { className: 'zhihu-actions' },
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-danger',
        disabled: busy || keyLocked === true || !configured,
        onClick: () => void clear(),
      }, busy ? text().clearing : text().clear),
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-primary',
        disabled: busy || keyLocked === true || keyValue.length === 0 || keyFailure !== undefined,
        onClick: () => void save(),
      }, busy ? text().saving : text().save),
    ),
    e(KnowledgeBaseSection, { ctx, enabled: configured }),
    e(ZhihuUsageSection, { ctx }),
  )
}
