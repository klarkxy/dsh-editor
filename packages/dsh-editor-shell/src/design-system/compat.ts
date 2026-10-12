import { DSW_VARS } from './dsw-vars.ts'

/*
 * 兼容层（迁移期，第 6 阶段删除）：官方制品读的 --dsw-* / --ds-* 变量映射到
 * 「原稿」token。规则见 docs/redesign/design-system-spec.md §6；能归类的进
 * DSW_MAP，无法归类的进 DSW_PENDING，不为它们猜一个值。
 */
export type DswVar = (typeof DSW_VARS)[number]

// §6 具名映射，键为去掉 --dsw-alias- / --dsw- 前缀后的变量名。
const ALIAS_MAP: Record<string, string> = {
  'bg-base': 'bg',
  'bg-layer-1': 'surface',
  'bg-layer-2': 'raised',
  'bg-layer-3': 'raised',
  'bg-module-platform': 'sunken',
  'label-primary': 'text',
  'label-secondary': 'muted',
  'label-tertiary': 'muted',
  'label-primary-foreground': 'on-brand',
  'label-error': 'danger',
  'border-l1': 'line',
  'border-l2': 'line',
  'border-l3': 'line-strong',
  'border-l4': 'line-strong',
  'settings-card-stroke': 'line-strong',
  'state-business-primary': 'accent',
  'state-success-primary': 'success',
  'state-warn-primary': 'warning',
  'state-error-primary': 'danger',
  'interactive-bg-hover': 'hover',
  'interactive-bg-active': 'selected',
  'interactive-bg-hover-danger': 'danger-soft',
  'button-primary-fill': 'brand',
  'button-primary-hover': 'brand-hover',
  'link': 'link',
}

function classify(name: string): string | undefined {
  if (name === '--ds-font-family-code') return 'var(--dsh-ui-font-mono)'
  if (name.startsWith('--ds-font-family-')) return 'var(--dsh-ui-font-ui)'
  const bare = name.replace(/^--dsw-alias-/, '').replace(/^--dsw-/, '')
  // scrollbar-*: 名称含 hover 的取 muted，其余取 line-strong。
  if (bare.startsWith('scrollbar-')) return bare.includes('hover') ? 'var(--dsh-ui-muted)' : 'var(--dsh-ui-line-strong)'
  if (name.startsWith('--dsw-alias-')) {
    const mapped = ALIAS_MAP[bare]
    return mapped ? `var(--dsh-ui-${mapped})` : undefined
  }
  if (bare.startsWith('radius-')) return `var(--dsh-ui-${bare})`
  if (bare === 'elevation-prominent') return 'var(--dsh-ui-elevation-prominent)'
  if (bare.startsWith('elevation-')) return 'var(--dsh-ui-elevation-panel)'
  if (bare === 'focus-ring-color') return 'var(--dsh-ui-accent)'
  if (bare === 'focus-ring-width') return '2px'
  if (bare === 'menu-surface-fill') return 'var(--dsh-ui-menu-fill)'
  if (bare === 'menu-backdrop-filter') return 'none'
  if (bare === 'specific-sidebar-fill') return 'var(--dsh-ui-sidebar)'
  return undefined
}

const entries = DSW_VARS.map(name => [name, classify(name)] as const)
export const DSW_MAP: Partial<Record<DswVar, string>> = Object.fromEntries(
  entries.filter((entry): entry is readonly [DswVar, string] => entry[1] !== undefined),
)
export const DSW_PENDING: readonly DswVar[] = entries
  .filter((entry): entry is readonly [DswVar, undefined] => entry[1] === undefined)
  .map(entry => entry[0])

/** token 作用域内输出的映射声明；值一律是 var(--dsh-ui-*) 或规格给定的字面量。 */
export function dswDeclarations(): string {
  return Object.entries(DSW_MAP)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
}
