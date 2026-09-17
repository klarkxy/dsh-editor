import { Select as ThemesSelect } from '@radix-ui/themes'
import { useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
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
 * 下拉:基于 @radix-ui/themes Select,替代原生 <select>(原生弹层在 Windows
 * Chromium 下不跟随 color-scheme)。Themes 负责皮肤、键盘导航、焦点返还、
 * typeahead 与视口碰撞翻转。弹层走 Portal 渲染到 document.body,并自带
 * .radix-themes 包裹,主题变量在 Portal 内可用。
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
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const selected = props.options.find((option) => option.value === props.value)
  return (
    <span className={`select${open ? ' open' : ''}`}>
      <ThemesSelect.Root
        open={open}
        onOpenChange={(next: boolean) => {
          // 空列表不展开(与旧实现一致);disabled 由 Radix 自身拦截。
          if (next && props.options.length === 0) return
          setOpen(next)
        }}
        // 没有匹配项时传 '':Radix 视为未选择并显示 placeholder。
        value={selected ? encodeValue(selected.value) : ''}
        onValueChange={(next: string) => {
          const value = decodeValue(next)
          if (value !== props.value) props.onChange(value)
        }}
        disabled={props.disabled}>
        <ThemesSelect.Trigger
          ref={triggerRef}
          className="select-trigger"
          aria-label={props['aria-label']}
          title={props.title}
          placeholder={props.placeholder ?? t('select.unselected')}>
          {props.selectedLabel}
        </ThemesSelect.Trigger>
        <ThemesSelect.Content
          className="select-list"
          position="popper"
          align={props.align ?? 'center'}
          sideOffset={4}
          collisionPadding={8}
          aria-label={props['aria-label']}
          /*
           * Escape 只关本弹层、不关外层设置窗:设置弹窗的 keydown 是 React 合成
           * 事件,Portal 内容的事件会沿 React 树冒泡到它(它检查 defaultPrevented
           * 放行);而 Radix 的 DismissableLayer 在 document 原生监听,若 default
           * 已被 prevent 则跳过自身关闭——所以这里 preventDefault + 自己关 +
           * 自己把焦点还给触发钮,两条路径都被幂等接管。
           */
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            globalThis.setTimeout(() => triggerRef.current?.focus(), 0)
          }}>
          {props.options.map((option) => <ThemesSelect.Item
            {...{
              key: encodeValue(option.value),
              className: 'select-option',
              value: encodeValue(option.value),
              /* Radix 会把未知 prop 透传到 DOM；e2e 以 data-value 定位选项。 */
              ...{ 'data-value': encodeValue(option.value) },
            } as ComponentProps<typeof ThemesSelect.Item>}>
            {option.label}
          </ThemesSelect.Item>)}
        </ThemesSelect.Content>
      </ThemesSelect.Root>
    </span>
  );
}
