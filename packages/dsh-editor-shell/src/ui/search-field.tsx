import { forwardRef } from 'react'
import { CrossIcon, SearchIcon } from './icons.tsx'
import { Input, type InputProps } from './input.tsx'
import { cx } from './shared.ts'
import './search-field.styles.ts'

export type SearchFieldProps = {
  clearLabel: string
  onClear?(): void
} & InputProps

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(props, ref) {
  const { clearLabel, onClear, className, ...rest } = props
  return (
    <Input
      ref={ref}
      type="search"
      className={cx('dsh-search-field', className)}
      leading={<SearchIcon size="sm" />}
      trailing={props.value
        ? (
          <button
            type="button"
            className="dsh-search-field__clear"
            aria-label={clearLabel}
            onClick={onClear}
          >
            <CrossIcon size="sm" />
          </button>
        )
        : undefined}
      {...rest}
    />
  )
})
