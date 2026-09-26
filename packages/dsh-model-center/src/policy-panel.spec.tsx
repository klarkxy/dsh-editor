import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { PolicyPanel } from './client.tsx'
import type { AiPolicy, RegisteredPurpose } from './contracts.ts'
import { parseModelCatalog } from './model-catalog.ts'
import { purposeRows } from './policy.ts'

const policy: AiPolicy = {
  revision: 1,
  roles: { normal: { provider: 'old-provider', model: 'old-chat' } },
  purposes: {},
  limits: { concurrency: 1, timeoutMs: 30_000, maxInputChars: 8000, maxOutputTokens: 1024, maxAttempts: 1 },
}
const purposes: RegisteredPurpose[] = [
  { id: 'chat', label: '对话', plugin: 'test', defaultTarget: { kind: 'role', role: 'normal' } },
  { id: 'manuscript.completion', label: '续写', plugin: 'test', defaultTarget: { kind: 'role', role: 'normal' } },
  { id: 'manuscript.rewrite', label: '改写', plugin: 'test', defaultTarget: { kind: 'role', role: 'normal' } },
  { id: 'title', label: '标题', plugin: 'test', defaultTarget: { kind: 'role', role: 'normal' } },
]
const catalog = parseModelCatalog({ groups: [{ id: 'ocg', name: 'OCG', models: [{ id: 'mimo', name: 'mimo' }] }] })

function inspect(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(inspect).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isValidElement(node)) return ''
  const props = node.props as Record<string, unknown>
  if (typeof node.type === 'function') {
    return inspect((node.type as (props: Record<string, unknown>) => ReactNode)(props))
  }
  const tag = typeof node.type === 'string' ? node.type : 'fragment'
  const attributes = ['className', 'data-purpose'].map(key =>
    props[key] ? ` ${key}="${props[key]}"` : '',
  ).join('')
  return `<${tag}${attributes}>${inspect(props.children as ReactNode)}</${tag}>`
}

function render(currentCatalog = catalog): string {
  return inspect(PolicyPanel({
    locale: 'zh', busy: false, dirty: false, policy, catalog: currentCatalog,
    rows: purposeRows(policy, purposes), resolved: {},
    onRoles() {}, onPurpose() {}, onSave() {}, onShowProviders() {}, onRefreshCatalog() {},
  }))
}

describe('model routing settings', () => {
  it('marks old bindings and previews affected advanced features without changing policy', () => {
    const html = render()
    expect(html).toContain('4个功能仍指向不可用模型')
    expect(html).toContain('受影响的其他功能：标题')
    expect(html).toContain('old-provider / old-chat（当前不可用）')
    expect(html).toContain('OCG / mimo')
    expect(html).toContain('<details className="model-center-advanced"')
    expect(html.indexOf('data-purpose="chat"')).toBeLessThan(html.indexOf('<details className="model-center-advanced"'))
    expect(html.indexOf('data-purpose="title"')).toBeGreaterThan(html.indexOf('<details className="model-center-advanced"'))
    expect(policy.roles.normal).toEqual({ provider: 'old-provider', model: 'old-chat' })
  })

  it('does not call an old binding unavailable when no catalogue could be loaded', () => {
    const html = render(parseModelCatalog({ groups: [] }))
    expect(html).toContain('当前未取得可用模型目录')
    expect(html).not.toContain('当前不可用')
    expect(html).not.toContain('个功能仍指向不可用模型')
  })
})