import { createElement as e, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'

export type SelectOption = { value: string; label: string }

/** Move the highlight by `delta`, wrapping around; returns the current index when the list is empty. */
export function moveActiveIndex(length: number, current: number, delta: number): number {
  if (length <= 0) return current
  return (current + delta + length) % length
}

/** Index of the current value, falling back to the first option so ArrowDown from nothing lands on 0/1. */
export function activeIndexFor(options: readonly SelectOption[], value: string): number {
  const index = options.findIndex((option) => option.value === value)
  return index >= 0 ? index : 0
}

/*
 * 自制下拉:替代原生 <select>。原生弹层在 Windows Chromium 下不跟随
 * color-scheme(带作者 background/color 时白底、高亮行灰字看不清),
 * 这里的弹层是普通 DOM,完全走纸/墨设计令牌。
 */
export function Select(props: {
  value: string
  options: readonly SelectOption[]
  onChange(value: string): void
  disabled?: boolean
  'aria-label': string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => activeIndexFor(props.options, props.value))
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  const close = (focusTrigger: boolean) => {
    setOpen(false)
    if (focusTrigger) globalThis.setTimeout(() => triggerRef.current?.focus(), 0)
  }
  const choose = (index: number) => {
    const option = props.options[index]
    if (!option) return
    if (option.value !== props.value) props.onChange(option.value)
    close(true)
  }

  // Click outside closes the popover.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Keep the highlighted option in view while navigating by keyboard.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  // Re-sync the highlight when the value/options change under a closed popover.
  useEffect(() => {
    if (!open) setActive(activeIndexFor(props.options, props.value))
  }, [open, props.value, props.options])

  const openList = (nextActive?: number) => {
    if (props.disabled || props.options.length === 0) return
    setActive(nextActive ?? activeIndexFor(props.options, props.value))
    setOpen(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openList(event.key === 'ArrowUp' ? props.options.length - 1 : undefined)
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => moveActiveIndex(props.options.length, index, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => moveActiveIndex(props.options.length, index, -1))
        return
      case 'Home':
        event.preventDefault()
        setActive(0)
        return
      case 'End':
        event.preventDefault()
        setActive(props.options.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(active)
        return
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      case 'Tab':
        close(false)
        return
    }
  }

  const selected = props.options.find((option) => option.value === props.value)
  return e('span', { ref: rootRef, className: `select${open ? ' open' : ''}` },
    e('button', {
      ref: triggerRef,
      type: 'button',
      className: 'select-trigger',
      disabled: props.disabled,
      'aria-label': props['aria-label'],
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      onClick: () => (open ? close(true) : openList()),
      onKeyDown,
    },
      e('span', { className: selected ? 'select-value' : 'select-value placeholder' }, selected?.label ?? props.placeholder ?? '未选择'),
      e('span', { className: 'select-caret', 'aria-hidden': true }, '⌄'),
    ),
    open ? e('ul', { ref: listRef, className: 'select-list', role: 'listbox', 'aria-label': props['aria-label'] },
      props.options.map((option, index) => e('li', {
        key: option.value,
        role: 'option',
        'aria-selected': option.value === props.value,
        'data-active': index === active ? 'true' : undefined,
        className: `select-option${index === active ? ' active' : ''}`,
        onMouseEnter: () => setActive(index),
        onMouseDown: (event: ReactMouseEvent) => { event.preventDefault(); choose(index) },
      }, option.label)),
    ) : null,
  )
}
