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

  // 原稿 follow-up：剩余颜色别名按语义归类（字体复合与静态色阶仍 pending）。
  'bg-document-preview': 'raised',
  'bg-document-selection': 'accent-soft',
  'bg-l1': 'surface',
  'bg-l2': 'raised',
  'bg-layer-4': 'raised',
  'bg-mask-1': 'scrim',
  'bg-mask-2': 'scrim',
  'bg-mask-3': 'scrim',
  'bg-mask-photo': 'scrim',
  'bg-overlay': 'scrim',
  'bg-mask-drop': 'accent-soft',
  'bg-multi-select': 'selected',
  'bg-skeleton': 'sunken',
  'border-inverted': 'line-strong',
  'border-inverted2': 'line-strong',
  'border-l2-darkmode-thin': 'line',
  'brand-primary': 'brand',
  'brand-primary-new-colorprimary-new-color': 'brand',
  'brand-primary-invert': 'on-brand',
  'brand-text': 'link',
  'button-contrast-fill': 'brand',
  'button-elevated-fill': 'raised',
  'button-floating-fill': 'raised',
  'button-floating-hover': 'hover',
  'button-ghost-active-border': 'accent-border',
  'button-ghost-active-fill': 'selected',
  'button-ghost-active-hover': 'selected',
  'button-info-fill': 'accent-soft',
  'button-info-hover': 'selected',
  'button-primary-dimmed': 'accent-border',
  'button-tool-bar-fill': 'surface',
  'button-tool-bar-hover': 'hover',
  'code-diff-added': 'success-soft',
  'file-diff-added-bg': 'success-soft',
  'file-diff-added-gutter': 'success-soft',
  'file-diff-added-marker': 'success',
  'code-diff-deleted': 'danger-soft',
  'file-diff-deleted-bg': 'danger-soft',
  'file-diff-deleted-gutter': 'danger-soft',
  'file-diff-deleted-marker': 'danger',
  'fill-l1': 'hover',
  'fill-tsp-secondary': 'hover',
  'fill-l2': 'selected',
  'fill-tertiary': 'sunken',
  'interactive-bg-hover-accent': 'accent-soft',
  'interactive-bg-hover-solid': 'surface',
  'label-caption': 'muted',
  'label-deep-diving': 'muted',
  'label-primary-dimmed': 'muted',
  'label-deep-diving-shimmer': 'faint',
  'label-dimmed': 'faint',
  'label-quaternary': 'faint',
  'label-shimmer': 'faint',
  'markdown-placeholder': 'faint',
  'label-document-preview': 'text',
  'label-primary-bluish': 'link',
  'markdown-citation': 'link',
  'label-primary-inverted': 'on-brand',
  'markdown-code-block': 'sunken',
  'markdown-code-segment-unselected': 'sunken',
  'markdown-inline-code': 'sunken',
  'markdown-code-block-banner': 'surface',
  'markdown-code-segment-selected': 'selected',
  'markdown-tag': 'accent-soft',
  'menu-group-header-fill': 'surface',
  'menu-icon': 'muted',
  'onboarding-accent': 'accent',
  'onboarding-card-fill': 'raised',
  'onboarding-checkbox-border': 'line-strong',
  'onboarding-secondary-fill': 'surface',
  'separator-primary': 'line',
  'settings-card-fill': 'raised',
  'state-business-tertiary': 'accent-soft',
  'state-error-secondary': 'danger-soft',
  'state-idle-primary': 'muted',
  'state-success-secondary': 'success-soft',
  'state-success-tertiary': 'success-soft',
  'state-warn-label': 'warning',
  'state-warn-secondary': 'warning-soft',
  'state-warn-tertiary': 'warning-soft',
  'switch-thumb': 'switch-thumb',
  'toast-bg': 'raised',
  'toast-label': 'text',
  'tooltip-bg': 'text',
  'tooltip-key-bg': 'muted',
  'turn-trigger-bg': 'surface',
  'turn-trigger-bg-hover': 'hover',
}

// --dsw-specific-* 的归类（值为完整 var() 声明）。
const SPECIFIC_MAP: Record<string, string> = {
  'specific-bubble': 'var(--dsh-ui-bubble)',
  'specific-bubble-highlight': 'var(--dsh-ui-selected)',
  'specific-input-major': 'var(--dsh-ui-raised)',
  'specific-login-input': 'var(--dsh-ui-raised)',
  'specific-selector': 'var(--dsh-ui-raised)',
  'specific-menu': 'var(--dsh-ui-menu-fill)',
  'specific-sidebar-nav-item-active': 'var(--dsh-ui-selected)',
  'specific-sidebar-nav-item-active-accent': 'var(--dsh-ui-accent)',
  'specific-sidebar-nav-item-hover': 'var(--dsh-ui-hover)',
  'specific-tip': 'var(--dsh-ui-surface)',
  'specific-sidebar-fill': 'var(--dsh-ui-sidebar)',
}

function classify(name: string): string | undefined {
  if (name === '--ds-font-family-code') return 'var(--dsh-ui-font-mono)'
  if (name.startsWith('--ds-font-family-')) return 'var(--dsh-ui-font-ui)'
  const bare = name.replace(/^--dsw-alias-/, '').replace(/^--dsw-/, '')
  // scrollbar-*: 名称含 hover 的取 muted，其余取 line-strong。
  if (bare.startsWith('scrollbar-')) return bare.includes('hover') ? 'var(--dsh-ui-muted)' : 'var(--dsh-ui-line-strong)'
  if (name.startsWith('--dsw-alias-')) {
    if (bare === 'button-tool-bar-fill-invisible') return 'transparent'
    const mapped = ALIAS_MAP[bare]
    return mapped ? `var(--dsh-ui-${mapped})` : undefined
  }
  if (bare.startsWith('specific-')) return SPECIFIC_MAP[bare]
  if (bare.startsWith('radius-')) return `var(--dsh-ui-${bare})`
  if (bare === 'elevation-prominent') return 'var(--dsh-ui-elevation-prominent)'
  if (bare.startsWith('elevation-')) return 'var(--dsh-ui-elevation-panel)'
  if (bare === 'focus-ring-color') return 'var(--dsh-ui-accent)'
  if (bare === 'focus-ring-width') return '2px'
  if (bare === 'menu-surface-fill') return 'var(--dsh-ui-menu-fill)'
  if (bare === 'menu-backdrop-filter') return 'none'
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
