import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createElement as e, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { friendlyModelError, providerWrite, validateModelForm, type DiscoveredModel, type ModelForm, type ModelInterface } from './model-config.ts'
import type { CompletionPreference } from './completion-preference.ts'
import { AUTHOR_PREFERENCES_MAX_CHARS } from './author-preferences.ts'

const KEY_REFS = ['DEEPSEEK_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY'] as const

type ModelSetupProps = {
  connection: ConnectionHandle
  onBack?(): void
  onConfigured(provider: string, model: string): void
  onTestFailure?(): void
  completionPreference?: CompletionPreference
  onCompletionPreferenceChange?(value: CompletionPreference): void
  authorPreferences?: string
  onAuthorPreferencesChange?(value: string): void
  children?: ReactNode
}

export function ModelSetup(props: ModelSetupProps) {
  const [form, setForm] = useState<ModelForm>({ choice: 'deepseek', baseURL: '', apiKey: '' })
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    void props.connection.api.credentials.describe({ refs: [...KEY_REFS] }).then((response) => {
      if (!live || !response.result.ok) return
      setConfigured(Object.fromEntries(Object.entries(response.result.value.credentials).map(([ref, value]) => [ref, value.configured])))
    })
    return () => { live = false }
  }, [props.connection])

  const changeChoice = (choice: ModelInterface) => {
    setForm((old) => ({
      ...old,
      choice,
    }))
    setNote('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    let write = providerWrite(form)
    const failure = validateModelForm(form, configured[write.keyRef] === true)
    if (failure) { setNote(failure); return }
    setBusy(true)
    setNote('正在连接…')
    try {
      let model = ''
      if (form.choice === 'custom') {
        const key = form.apiKey.trim()
        const discovered = await props.connection.api.llm.discoverModels({
          settingsNs: 'llm-pi-ai',
          provider: write.provider,
          baseURL: form.baseURL.trim().replace(/\/+$/, ''),
          api: 'openai-completions',
          ...(key ? { apiKey: key } : {}),
        })
        if (!discovered.result.ok) throw new Error(discovered.result.error.message)
        const models = discovered.result.value.models.filter((item): item is DiscoveredModel => Boolean(item.id.trim()))
        if (models.length === 0) throw new Error('接口没有返回可用模型')
        write = providerWrite(form, models)
        model = models[0].id
      }

      if (write.settingsNs && write.settingsPath && write.settingsValue !== undefined) {
        const described = await props.connection.api.settings.describe({})
        if (!described.result.ok) throw new Error(described.result.error.message)
        if (!described.result.value.writable) throw new Error('settings are read-only')
        const namespace = described.result.value.namespaces.find((item) => item.ns === write.settingsNs)
        if (!namespace) throw new Error('model settings are unavailable')
        const mutated = await props.connection.api.settings.mutate({
          ns: write.settingsNs,
          ops: [{ op: 'set', path: write.settingsPath, value: write.settingsValue }],
          expectedRevision: namespace.revision,
        })
        if (!mutated.result.ok) throw new Error(mutated.result.error.message)
      }

      const key = form.apiKey.trim()
      if (key) {
        const info = await props.connection.api.credentials.describe({ refs: [write.keyRef] })
        if (!info.result.ok) throw new Error(info.result.error.message)
        if (!info.result.value.credentials[write.keyRef]?.writable) throw new Error('credential is read-only or managed by environment')
        const stored = await props.connection.api.credentials.set({ ref: write.keyRef, value: key })
        if (!stored.result.ok) throw new Error(stored.result.error.message)
        setForm((old) => ({ ...old, apiKey: '' }))
        setConfigured((old) => ({ ...old, [write.keyRef]: true }))
      }

      if (!model) {
        const catalog = await props.connection.api.llm.models({})
        if (!catalog.result.ok) throw new Error(catalog.result.error.message)
        model = catalog.result.value.groups.find((item) => item.id === write.provider)?.models[0]?.id || ''
        if (!model) throw new Error('接口没有返回可用模型')
      }

      setNote('连接成功')
      props.onConfigured(write.provider, model)
    } catch (error) {
      setNote(friendlyModelError(error instanceof Error ? error.message : String(error)))
      props.onTestFailure?.()
    } finally {
      setBusy(false)
    }
  }

  const write = providerWrite(form)
  return e('main', { className: 'settings-view', 'aria-labelledby': 'model-setup-title' },
    e('form', { className: 'model-panel', onSubmit: (event: FormEvent) => void submit(event) },
      e('header', null,
        e('div', null,
          e('p', { className: 'settings-brand' }, 'DSH / 连接'),
          e('h2', { id: 'model-setup-title' }, '接口'),
          e('p', null, 'Key 仅保存在本机'),
        ),
        props.onBack ? e('button', { type: 'button', onClick: props.onBack, 'aria-label': '返回写作区' }, '← 写作') : null,
      ),
      e('fieldset', { className: 'provider-tabs', disabled: busy },
        e('legend', null, '类型'),
        ([['deepseek', 'DeepSeek'], ['custom', '自定义接口']] as const).map(([value, label]) => e('label', { key: value },
          e('input', { type: 'radio', name: 'provider', checked: form.choice === value, onChange: () => changeChoice(value) }), label,
        )),
      ),
      form.choice === 'custom' ? e('label', null, e('span', null, '接口地址'), e('input', {
        value: form.baseURL,
        placeholder: 'https://example.com/v1',
        onChange: (event: ChangeEvent<HTMLInputElement>) => setForm((old) => ({ ...old, baseURL: event.target.value })),
      })) : null,
      e('label', null, e('span', null, 'API Key'), e('input', {
        type: 'password',
        autoComplete: 'off',
        value: form.apiKey,
        placeholder: configured[write.keyRef] ? '已配置；留空保持不变' : '粘贴 API Key',
        onChange: (event: ChangeEvent<HTMLInputElement>) => setForm((old) => ({ ...old, apiKey: event.target.value })),
      })),
      props.onBack && props.completionPreference && props.onCompletionPreferenceChange ? e('fieldset', { className: 'completion-preference' },
        e('legend', null, '自动补全'),
        e('p', null, '补全只生成建议，经你确认后才会写入正文。'),
        ([['manual', '仅手动'], ['pause', '停顿后提示']] as const).map(([value, label]) => e('label', { key: value },
          e('input', {
            type: 'radio',
            name: 'completion-preference',
            checked: props.completionPreference === value,
            onChange: () => props.onCompletionPreferenceChange?.(value),
          }),
          label,
        )),
      ) : null,
      props.onBack && props.authorPreferences !== undefined && props.onAuthorPreferencesChange ? e('label', { className: 'author-preferences' },
        e('span', null, '跨作品作者约定'),
        e('textarea', {
          value: props.authorPreferences,
          maxLength: AUTHOR_PREFERENCES_MAX_CHARS,
          rows: 4,
          placeholder: '例如：第三人称限知；少用感叹号；对白保持克制。',
          'aria-label': '跨作品作者约定',
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => props.onAuthorPreferencesChange?.(event.target.value),
        }),
        e('small', null, `${props.authorPreferences.length} / ${AUTHOR_PREFERENCES_MAX_CHARS} 字；仅保存在本机，所有作品的搭档、补全和选段修改都会参考。`),
      ) : null,
      note ? e('p', { className: /成功/.test(note) ? 'success' : 'warning', role: /成功/.test(note) ? 'status' : 'alert' }, note) : null,
      e('footer', null,
        props.onBack ? e('button', { type: 'button', onClick: props.onBack, disabled: busy }, '返回') : null,
        e('button', { className: 'primary-action', type: 'submit', disabled: busy }, busy ? '连接中' : '连接'),
      ),
    ),
    props.children ?? null,
  )
}
