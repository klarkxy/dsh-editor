import type { ReactNode } from 'react'
import type { ShellToolSeatContext } from 'dsh-editor-seats'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

/*
 * 私有面板共享外观（原稿系统）：根节点挂 `dsh-panel` 取得 token 别名与基础排版，
 * 页头/分节/列表/空态/提示用下面的组件或 `dsh-panel-*` 类名，各面板只写自己的
 * 结构差异。样式按 `.dsh-panel` 作用域书写，不依赖 `.radix-themes`：宿主是 shell
 * 时 `--s-*` 解析到 `--dsh-ui-*`，standalone 时退回 Radix/官方别名。
 */

const cx = (...names: Array<string | undefined | false>) => names.filter(Boolean).join(' ')

export type PanelHostButton = ShellToolSeatContext['Button']

/* 面板页头：标题 + 可选描述 + 右上角关闭（icon 变体需要可访问名称）。 */
export function PanelHeader(props: {
  title: ReactNode
  description?: ReactNode
  onClose?(): void
  closeLabel?: string
  Button?: PanelHostButton
  titleId?: string
  className?: string
}) {
  return (
    <header className={cx('dsh-panel-header', props.className)}>
      <div className="dsh-panel-header__text">
        <h2 id={props.titleId}>{props.title}</h2>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.onClose ? (
        <SeatButton
          host={props.Button}
          variant="icon"
          className="icon-button dsh-panel-close"
          aria-label={props.closeLabel}
          onClick={props.onClose}>
          ×
        </SeatButton>
      ) : null}
    </header>
  )
}

/* 分节：label 给 h3 小节标题；aria-label 保留面板原本的可访问名。 */
export function PanelSection(props: {
  label?: ReactNode
  'aria-label'?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={cx('dsh-panel-section', props.className)} aria-label={props['aria-label']}>
      {props.label ? <h3>{props.label}</h3> : null}
      {props.children}
    </section>
  )
}

/* 行列表：list-style 复位与行距；各行内部结构仍属面板私有。 */
export function PanelList(props: {
  ordered?: boolean
  className?: string
  'aria-label'?: string
  children?: ReactNode
}) {
  const Tag = props.ordered ? 'ol' : 'ul'
  return <Tag className={cx('dsh-panel-list', props.className)} aria-label={props['aria-label']}>{props.children}</Tag>
}

export function PanelRow(props: {
  className?: string
  children?: ReactNode
}) {
  return <li className={cx('dsh-panel-row', props.className)}>{props.children}</li>
}

/* 提示条：muted 为中性说明，danger 带危险色与内嵌边条；role 由调用方按语义给。 */
export function PanelNotice(props: {
  tone?: 'muted' | 'danger'
  role?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <p className={cx('dsh-panel-notice', props.className)} data-tone={props.tone ?? 'muted'} role={props.role}>
      {props.children}
    </p>
  )
}

/* 空态：比正常数据更安静的扁平文本，不带卡片外观。 */
export function PanelEmpty(props: {
  className?: string
  children?: ReactNode
}) {
  return <p className={cx('dsh-panel-empty', props.className)}>{props.children}</p>
}

/*
 * 共享面板样式。reduced-motion 终止全部面板动画（含伪元素），用更高特异度
 * 选择器代替 !important；standalone 宿主的裸 button 按 secondary 观感兜底，
 * 宿主按钮（dsh-button）自带的变体样式不经这里重复定义。
 */
export const panelChromeStyles = `
.dsh-panel {
${surfaceTokenAliases}
  min-width: 0; min-height: 0; display: flex; flex-direction: column;
  font-family: var(--s-font); font-size: var(--s-text-sm); line-height: var(--s-leading-normal); color: var(--s-text);
}
.dsh-panel-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-space-2);
}
.dsh-panel-header__text { min-width: 0; }
.dsh-panel-header h2 {
  margin: 0; color: var(--s-text);
  font: var(--s-weight-medium) var(--s-text-md)/var(--s-leading-tight) var(--s-font);
}
.dsh-panel-header p { margin: var(--s-space-1) 0 0; font-size: var(--s-text-xs); color: var(--s-muted); }
.dsh-panel-close { flex: none; }
.dsh-panel-section { display: grid; gap: var(--s-space-2); min-width: 0; }
.dsh-panel-section > h3 {
  margin: 0; color: var(--s-muted);
  font-size: var(--s-text-sm); font-weight: var(--s-weight-medium);
}
.dsh-panel-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--s-space-1); }
.dsh-panel-row { min-width: 0; min-height: var(--s-control-sm); }
.dsh-panel-notice { margin: 0; font-size: var(--s-text-sm); }
.dsh-panel-notice[data-tone='muted'] { color: var(--s-muted); }
.dsh-panel-notice[data-tone='danger'] {
  color: var(--s-danger); font-weight: var(--s-weight-medium);
  border-inline-start: 2px solid var(--s-danger); padding-inline-start: var(--s-space-2);
}
.dsh-panel-empty { margin: 0; padding: var(--s-space-2) 0; color: var(--s-muted); font-size: var(--s-text-sm); }
.dsh-panel .muted { color: var(--s-muted); }
/* 提案卡在 shell 里是 uiRule（插件表面被排除），面板内的提案卡在这里恢复扁平卡片外观。 */
.dsh-panel .proposal-card {
  display: grid; gap: var(--s-space-2); margin: 0; min-width: 0;
  padding: var(--s-space-3) var(--s-space-4);
  border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md);
  background: var(--s-raised); box-shadow: none; font-size: var(--s-text-sm);
}
.dsh-panel .proposal-card > header,
.dsh-panel .proposal-card > footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-space-2); }
.dsh-panel .proposal-card pre {
  margin: 0; max-height: min(48dvh, 28rem); overflow: auto; scrollbar-gutter: stable;
  padding: var(--s-space-2) var(--s-space-3);
  border: 0.5px solid var(--s-line); border-radius: var(--s-radius-sm);
  background: var(--s-surface); color: var(--s-text); box-shadow: none;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.dsh-panel p.warning {
  margin: 0; color: var(--s-danger); font-weight: var(--s-weight-medium);
  border-inline-start: 2px solid var(--s-danger); padding-inline-start: var(--s-space-2);
}
/* standalone 宿主（无 dsh-button）时 SeatButton 退化为裸 button + 变体类。 */
.dsh-panel button:not(.dsh-button) {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--s-space-2);
  min-height: var(--s-control-sm); padding: 0 var(--s-space-3); box-sizing: border-box;
  border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-sm);
  background: var(--s-raised); color: var(--s-text); cursor: pointer;
  font: var(--s-weight-medium) var(--s-text-sm)/1 var(--s-font);
}
.dsh-panel button:not(.dsh-button):hover:not(:disabled) { background: var(--s-hover); }
.dsh-panel button:not(.dsh-button).primary-action { background: var(--s-brand); color: var(--s-on-brand); border-color: transparent; }
.dsh-panel button:not(.dsh-button).primary-action:hover:not(:disabled) { background: var(--s-brand-hover); }
.dsh-panel button:not(.dsh-button).danger-action { background: var(--s-danger); color: var(--s-raised); border-color: transparent; }
.dsh-panel button:not(.dsh-button).icon-button { min-width: var(--s-control-sm); padding: 0; border-color: transparent; background: transparent; }
.dsh-panel button:not(.dsh-button).icon-button:hover:not(:disabled) { background: var(--s-hover); }
.dsh-panel button:not(.dsh-button):disabled { opacity: .45; cursor: default; }
.dsh-panel button[aria-pressed='true'] { background: var(--s-selected); color: var(--s-text); border-color: transparent; }
.dsh-panel :is(button, input:not(.dsh-input__control), select, textarea, a, [tabindex]):focus { outline: none; }
.dsh-panel :is(button, input:not(.dsh-input__control), select, textarea, a, [tabindex]):focus-visible { box-shadow: var(--s-focus-shadow); }
@media (forced-colors: active) {
  .dsh-panel :is(button, input:not(.dsh-input__control), select, textarea, a, [tabindex]):focus-visible {
    outline: 2px solid CanvasText; outline-offset: 2px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-panel, .dsh-panel *, .dsh-panel *::before, .dsh-panel *::after,
  .dsh-panel .panel-activity-dots i, .dsh-panel .panel-skeleton i::after {
    animation: none; transition: none;
  }
}
`
