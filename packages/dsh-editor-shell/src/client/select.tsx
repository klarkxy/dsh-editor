import { useState } from 'react';
import { t } from '../i18n/index.ts'
import { Select as InternalSelect } from '../ui/index.ts'

import type { SelectOption } from '../model/select.ts'

/*
 * Radix Select.Item 不接受空字符串 value,而模型设置里的"未选择"协议项
 * (settings-models 的 protocolUnset)就是 ''。这里统一给所有值加非空前缀,
 * 编解码互逆且不会与任何原始值碰撞,对外契约(onChange 收到原始值)不变。
 */
const encodeValue = (value: string): string => `v:${value}`
const decodeValue = (value: string): string => value.slice(2)

/*
 * 宿主下拉:C04 落在内部 Select(src/ui/select.tsx)上,props 契约不变。
 * 编码、空列表不展开、.select/.select-trigger 类名钩子(设置页样式仍引用)
 * 由本适配层保留;Escape 关闭与焦点返还由 @radix-ui/react-select 负责,
 * 嵌在宿主 Dialog 里时由 Dialog 的 listbox 守卫兜住。
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

  const selected = props.options.find((option) => option.value === props.value)
  return (
    <span className={`select${open ? ' open' : ''}`}>
      <InternalSelect
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
        options={props.options.map((option) => ({ value: encodeValue(option.value), label: option.label }))}
        placeholder={props.placeholder ?? t('select.unselected')}
        selectedLabel={props.selectedLabel}
        align={props.align}
        title={props.title}
        aria-label={props['aria-label']}
        disabled={props.disabled}
        className="select-trigger" />
    </span>
  );
}
