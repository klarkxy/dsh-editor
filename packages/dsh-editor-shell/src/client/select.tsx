import {
  Root as SelectRoot,
  Trigger as SelectTrigger,
  Value as SelectValue,
  Portal as SelectPortal,
  Content as SelectContent,
  Viewport as SelectViewport,
  Item as SelectItem,
  ItemText as SelectItemText,
  ItemIndicator as SelectItemIndicator,
} from '@radix-ui/react-select'
import { createElement as e, useRef, useState, type KeyboardEvent } from 'react'
import { t } from '../i18n/index.ts'

export type SelectOption = { value: string; label: string }

/*
 * Radix Select.Item 不接受空字符串 value,而模型设置里的"未选择"协议项
 * (settings-models 的 protocolUnset)就是 ''。这里统一给所有值加非空前缀,
 * 编解码互逆且不会与任何原始值碰撞,对外契约(onChange 收到原始值)不变。
 */
const encodeValue = (value: string): string => `v:${value}`
const decodeValue = (value: string): string => value.slice(2)

/*
 * 下拉:基于 @radix-ui/react-select,替代原生 <select>(原生弹层在 Windows
 * Chromium 下不跟随 color-scheme)和更早的自制弹层。Radix 负责键盘导航、
 * 焦点返还、typeahead 与视口碰撞翻转(底部空间不足时自动向上展开,聊天输入
 * 区下方的模型选择器因此不再需要手写 bottom 定位)。弹层走 Portal 渲染到
 * document.body,主题变量挂在 :root[data-theme] 上,纸/墨令牌照常生效;
 * 样式选择器因此与 palette 一样不带 .shell 前缀(见 styles.ts)。
 */
export function Select(props: {
  value: string
  options: readonly SelectOption[]
  onChange(value: string): void
  disabled?: boolean
  'aria-label': string
  placeholder?: string
  title?: string
  selectedLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const selected = props.options.find((option) => option.value === props.value)
  return e('span', { className: `select${open ? ' open' : ''}` },
    e(SelectRoot, {
      open,
      onOpenChange: (next: boolean) => {
        // 空列表不展开(与旧实现一致);disabled 由 Radix 自身拦截。
        if (next && props.options.length === 0) return
        setOpen(next)
      },
      // 没有匹配项时传 '':Radix 视为未选择并显示 placeholder。
      value: selected ? encodeValue(selected.value) : '',
      onValueChange: (next: string) => {
        const value = decodeValue(next)
        if (value !== props.value) props.onChange(value)
      },
      disabled: props.disabled,
    },
      e(SelectTrigger, { ref: triggerRef, type: 'button', className: 'select-trigger', 'aria-label': props['aria-label'], title: props.title },
        e('span', { className: selected || props.selectedLabel ? 'select-value' : 'select-value placeholder' },
          props.selectedLabel ?? e(SelectValue, { placeholder: props.placeholder ?? t('select.unselected') })),
        e('span', { className: 'select-caret', 'aria-hidden': true }, '⌄'),
      ),
      e(SelectPortal, null,
        e(SelectContent, {
          className: 'dsh-ui select-list',
          position: 'popper',
          sideOffset: 4,
          collisionPadding: 8,
          'aria-label': props['aria-label'],
          /*
           * Escape 只关本弹层、不关外层设置窗:设置弹窗的 keydown 是 React 合成
           * 事件,Portal 内容的事件会沿 React 树冒泡到它(它检查 defaultPrevented
           * 放行);而 Radix 的 DismissableLayer 在 document 原生监听,若 default
           * 已被 prevent 则跳过自身关闭——所以这里 preventDefault + 自己关 +
           * 自己把焦点还给触发钮,两条路径都被幂等接管。
           */
          onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            globalThis.setTimeout(() => triggerRef.current?.focus(), 0)
          },
        },
          e(SelectViewport, { className: 'select-viewport' },
            props.options.map((option) => e(SelectItem, {
              key: encodeValue(option.value),
              className: 'select-option',
              value: encodeValue(option.value),
            },
              e(SelectItemText, null, option.label),
              e(SelectItemIndicator, { className: 'select-option-check' }, '✓'),
            )),
          ),
        ),
      ),
    ),
  )
}
