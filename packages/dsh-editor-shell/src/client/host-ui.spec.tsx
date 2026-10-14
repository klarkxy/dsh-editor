/*
 * C04 运行时冒烟：HOST_UI 传给插件的五个控件（Select/Dialog/Button/Input/
 * TextArea）按契约 props 的全部组合渲染——不得抛错、不得有 React 运行时
 * 警告，且可访问名（文本内容或 aria-label）始终存在。
 * 焦点返还的接管逻辑在 src/ui/focus-return.spec.ts 有专门用例；
 * 真实浏览器行为由 e2e/layout-invariants.mjs 的弹窗焦点断言覆盖。
 */
import { createElement, createRef, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiRoot } from '../ui/index.ts'
import { Select } from './select.tsx'
import { Button, Input, TextArea } from './ui/controls.tsx'
import { Dialog } from './ui/dialog.tsx'

const html = (node: ReactNode) => renderToStaticMarkup(createElement(UiRoot, { theme: 'light' }, node))

const warnings: string[] = []
const capture = (kind: 'error' | 'warn') => (message?: unknown, ...rest: unknown[]) => {
  warnings.push([message, ...rest].map(String).join(' '))
}

describe('C04 host controls smoke', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderQuiet = (node: ReactNode) => {
    warnings.length = 0
    vi.spyOn(console, 'error').mockImplementation(capture('error'))
    vi.spyOn(console, 'warn').mockImplementation(capture('warn'))
    const out = html(node)
    /* renderToStaticMarkup 不跑 effect：TextArea 自适应高度的 useLayoutEffect
       在 SSR 下必告警，浏览器里不会出现——只过滤这一类。 */
    const real = warnings.filter((w) => !w.includes('useLayoutEffect does nothing on the server'))
    expect(real).toEqual([])
    return out
  }

  it('Button renders every variant with an accessible name', () => {
    const out = renderQuiet(<>
      <Button>默认</Button>
      <Button variant="default" type="submit">保存</Button>
      <Button variant="primary" className="primary-action">创建</Button>
      <Button variant="danger" title="删除说明">删除</Button>
      <Button variant="icon" aria-label="关闭面板" data-testid="x-icon" />
      <Button variant="primary" disabled title="暂不可用">导出</Button>
      <Button variant="default" role="switch" aria-checked="true" aria-pressed={true} tabIndex={0}>开关</Button>
    </>)
    for (const label of ['默认', '保存', '创建', '删除', '导出', '开关']) expect(out).toContain(label)
    expect(out).toContain('aria-label="关闭面板"')
    expect(out).toContain('data-testid="x-icon"')
    expect(out).toContain('role="switch"')
    expect(out).toContain('aria-checked="true"')
    expect(out).toContain('disabled=""')
    expect(out).toContain('dsh-button')
  })

  it('Select renders trigger name, placeholder and encoded empty value', () => {
    const out = renderQuiet(<>
      <Select
        value="a"
        options={[{ value: '', label: '未选择' }, { value: 'a', label: '甲' }]}
        onChange={() => {}}
        aria-label="协议"
        title="协议选择"
        selectedLabel="甲（已选）" />
      <Select
        value=""
        options={[]}
        onChange={() => {}}
        aria-label="空列表"
        placeholder="没有可选项"
        disabled
        align="start" />
    </>)
    expect(out).toContain('aria-label="协议"')
    expect(out).toContain('title="协议选择"')
    expect(out).toContain('甲（已选）')
    expect(out).toContain('aria-label="空列表"')
    expect(out).toContain('没有可选项')
    expect(out).toContain('dsh-select')
  })

  it('Input renders every documented prop combination', () => {
    const out = renderQuiet(<>
      <Input value="正文" onChange={() => {}} aria-label="章节名" />
      <Input value="" onChange={() => {}} placeholder="输入路径" type="search" data-testid="host-input" />
      <Input value="secret" onChange={() => {}} type="password" disabled maxLength={12} autoFocus />
    </>)
    expect(out).toContain('aria-label="章节名"')
    expect(out).toContain('type="search"')
    expect(out).toContain('type="password"')
    expect(out).toContain('maxLength="12"')
    expect(out).toContain('data-testid="host-input"')
    expect(out).toContain('dsh-input')
  })

  it('TextArea renders rows/maxLength/disabled and keeps the name', () => {
    const out = renderQuiet(<>
      <TextArea value="多行" onChange={() => {}} aria-label="备注" rows={4} />
      <TextArea value="" onChange={() => {}} placeholder="输入内容" disabled maxLength={20} />
    </>)
    expect(out).toContain('aria-label="备注"')
    expect(out).toContain('rows="4"')
    expect(out).toContain('maxLength="20"')
    expect(out).toContain('dsh-textarea')
  })

  it('Dialog renders open chrome with hidden accessible title and testid', () => {
    const firstFocus = createRef<HTMLElement>()
    const out = renderQuiet(
      <Dialog
        open={true}
        onOpenChange={() => {}}
        title="宿主对话框"
        description="描述文本"
        className="file-dialog-overlay plugin-card"
        overlayClassName="plugin-overlay"
        testid="host-dialog"
        dismissible={false}
        initialFocusRef={firstFocus}>
        <h2>宿主对话框</h2>
        <button type="button">确定</button>
      </Dialog>)
    expect(out).toContain('role="dialog"')
    expect(out).toContain('data-testid="host-dialog"')
    expect(out).toContain('宿主对话框')
    expect(out).toContain('plugin-overlay')
    /* titleHidden：可见标题由 children 的 h2 提供，不重复渲染 header。 */
    expect(out).not.toContain('dsh-dialog__title')
  })

  it('Dialog renders nothing when closed', () => {
    const out = renderQuiet(
      <Dialog open={false} onOpenChange={() => {}} title="关着的" returnFocusRef={createRef<HTMLElement>()}>
        <span>不该出现</span>
      </Dialog>)
    expect(out).not.toContain('不该出现')
  })
})
