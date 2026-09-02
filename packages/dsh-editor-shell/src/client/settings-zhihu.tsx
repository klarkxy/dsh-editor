/**
 * 知乎设置页:对接编辑器搭档的知乎站内搜索工具。
 * - 凭证引用固定为 `ZHIHU_ACCESS_TOKEN`,通过 `credentials.describe` / `set` / `unset` 维护。
 * - 视图结构与 settings-models.tsx 的 ProviderEditor 卡片一致,只做"单凭据"剪裁。
 */
import {
  createElement as e,
  useEffect,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import type { CredentialView, RpcResponse, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { apiKeyFailure } from './settings-models-store.ts'
import type { ShellContext } from './shared.ts'

const ZHIHU_REF = 'ZHIHU_ACCESS_TOKEN'

const TEXT = {
  intro: '在知乎开放平台获取 Access Secret 后粘贴到此处,搭档即可调用知乎站内搜索工具。',
  help: 'Access Secret 仅保存在本机,不参与任何云端同步。',
  statusHeading: '当前状态',
  statusUnconfigured: '未配置',
  statusStored: '已保存密钥',
  statusLocked: '由环境变量提供(无法在本页修改)',
  label: 'Access Secret',
  placeholderStored: '已保存密钥(输入以替换)',
  placeholderLocked: '由环境变量锁定',
  placeholder: '输入 Access Secret',
  keyBlank: '密钥不能只包含空白字符',
  keyIllegal: '密钥格式不合法:不要带引号或 NAME=value 前缀',
  save: '保存',
  saving: '保存中…',
  clear: '清除',
  clearing: '清除中…',
  loadFailed: '读取知乎密钥状态失败',
  retry: '重试',
  loadFailedPrefix: '加载失败:',
  savedNote: '已保存。',
  clearedNote: '已清除。',
}

function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? '请求失败'
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
    return e('section', { className: 'zhihu-page', 'aria-label': '知乎' },
      e(Header, null),
      e('p', { className: 'zhihu-status', role: 'status' }, '正在读取…'),
    )
  }

  if (state.status === 'error') {
    const message = state.error ?? TEXT.loadFailed
    return e('section', { className: 'zhihu-page', 'aria-label': '知乎' },
      e(Header, null),
      e('p', { className: 'zhihu-error', role: 'alert' },
        `${TEXT.loadFailedPrefix}${message}`,
        e('button', { type: 'button', className: 'zhihu-button', onClick: () => void load() }, TEXT.retry),
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
    e('h2', { className: 'zhihu-title' }, '知乎'),
    e('p', { className: 'zhihu-intro' }, TEXT.intro),
    props.note ? e('p', { className: 'zhihu-saved', role: 'status' }, props.note) : null,
  )
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
    ? TEXT.placeholderLocked
    : configured
      ? TEXT.placeholderStored
      : TEXT.placeholder

  const statusText = keyLocked
    ? TEXT.statusLocked
    : configured
      ? TEXT.statusStored
      : TEXT.statusUnconfigured

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
      setNote(TEXT.savedNote)
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
      setNote(TEXT.clearedNote)
      await onSaved()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return e('section', { className: 'zhihu-page', 'aria-label': '知乎' },
    e(Header, { note }),
    e('dl', { className: 'zhihu-status-grid' },
      e('dt', { className: 'zhihu-status-label' }, TEXT.statusHeading),
      e('dd', { className: 'zhihu-status-value' },
        e('span', { className: dotClass, 'aria-hidden': true }),
        statusText,
      ),
    ),
    e('div', { className: 'zhihu-field' },
      e('label', { className: 'zhihu-field-label', htmlFor: 'zhihu-access-secret' }, TEXT.label),
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
        ? e('p', { className: 'zhihu-hint' }, TEXT.help)
        : e('p', { className: 'zhihu-warning', role: 'alert' },
            keyFailure === 'keyBlank' ? TEXT.keyBlank : TEXT.keyIllegal,
          ),
    ),
    failure !== undefined ? e('p', { className: 'zhihu-warning', role: 'alert' }, failure) : null,
    e('div', { className: 'zhihu-actions' },
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-danger',
        disabled: busy || keyLocked === true || !configured,
        onClick: () => void clear(),
      }, busy ? TEXT.clearing : TEXT.clear),
      e('button', {
        type: 'button',
        className: 'zhihu-button zhihu-button-primary',
        disabled: busy || keyLocked === true || keyValue.length === 0 || keyFailure !== undefined,
        onClick: () => void save(),
      }, busy ? TEXT.saving : TEXT.save),
    ),
  )
}
