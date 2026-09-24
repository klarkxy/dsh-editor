/**
 * Kimi Web visual adapter for the existing React/Radix shell.
 * This is the single owner of product appearance. Existing styles.ts retains
 * structural, editor, native-window, plugin-seat and interaction contracts.
 * Do not add screen-specific competing overrides in either stylesheet.
 * Upstream attribution: resources/third-party/kimi-web-MIT.txt.
 */
import { SCOPE, tokenStyles } from './tokens.ts'

// Portalled menus share the HTML scope. Plugin surfaces inherit tokens but not
// our element rules; plugins own their internal layout and component variants.
const excludePlugin = ':not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))'
export function uiRule(selectors: readonly string[], declarations: string): string {
  const scoped = selectors.map((selector) => {
    const pseudo = selector.indexOf('::')
    const target = pseudo < 0
      ? `${selector}${excludePlugin}`
      : `${selector.slice(0, pseudo)}${excludePlugin}${selector.slice(pseudo)}`
    return `${SCOPE} ${target}`
  })
  return `${scoped.join(',\n')} { ${declarations} }\n`
}
const r = uiRule

export const componentStyles = [
  // Shell and native chrome. Keep draggable/no-drag regions and native controls.
  `${SCOPE}.shell-theme { --topbar-h: var(--dsh-ui-header-height); --control-h: var(--dsh-ui-control-md); }`,
  r(['.shell'], 'background: var(--dsh-ui-bg); color: var(--dsh-ui-text); font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-normal);'),
  r(['.shell > .chrome'], 'height: var(--topbar-h); background: var(--dsh-ui-bg); border-bottom: 1px solid var(--dsh-ui-line); box-shadow: none;'),
  r(['.workspace-menu-trigger'], 'border-radius: var(--dsh-ui-radius-md); background: transparent; color: var(--dsh-ui-text); box-shadow: none;'),
  r(['.workspace-menu-trigger:hover'], 'background: var(--dsh-ui-hover);'),
  r(['.layout-controls'], 'gap: var(--dsh-ui-space-1);'),
  r(['.layout-controls button[aria-pressed="true"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.topbar-actions'], 'gap: var(--dsh-ui-space-1);'),
  r(['.shell .window-controls button.window-close:hover'], 'background: var(--dsh-ui-danger); color: white;'),

  // Primitives. Preserve per-control Radix color overrides (red, gray, etc.).
  r(['button.rt-BaseButton'], 'font-family: var(--dsh-ui-font-ui); font-weight: var(--dsh-ui-weight-medium); transition: background-color var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), color var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), box-shadow var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);'),
  r(['button.rt-Button.rt-r-size-1'], 'min-height: var(--dsh-ui-control-sm); border-radius: var(--dsh-ui-radius-sm); font-size: var(--dsh-ui-text-sm);'),
  r(['button.rt-Button.rt-r-size-2'], 'min-height: var(--dsh-ui-control-md); border-radius: var(--dsh-ui-radius-md); font-size: var(--dsh-ui-text-base);'),
  r(['button.rt-Button.rt-r-size-3'], 'min-height: var(--dsh-ui-control-lg); border-radius: var(--dsh-ui-radius-lg);'),
  r(['button.rt-IconButton'], 'border-radius: var(--dsh-ui-radius-md);'),
  r(['button.rt-BaseButton.rt-variant-solid'], 'box-shadow: var(--dsh-ui-shadow-xs);'),
  r(['button.rt-BaseButton.rt-variant-outline'], 'background: var(--dsh-ui-raised); box-shadow: inset 0 0 0 1px var(--dsh-ui-line-strong), var(--dsh-ui-shadow-xs); color: var(--dsh-ui-text);'),
  r(['button.rt-BaseButton.rt-variant-outline:hover'], 'background: var(--dsh-ui-sunken);'),
  r(['button:disabled', 'button[data-disabled]'], 'cursor: not-allowed;'),
  r(['.rt-TextFieldRoot', '.rt-TextAreaRoot', '.rt-SelectTrigger'], 'background: var(--dsh-ui-raised); border-radius: var(--dsh-ui-radius-md); box-shadow: inset 0 0 0 1px var(--dsh-ui-line-strong);'),
  r(['.rt-TextFieldRoot:focus-within', '.rt-TextAreaRoot:focus-within', '.rt-SelectTrigger:focus-visible'], 'box-shadow: inset 0 0 0 1px var(--dsh-ui-accent), 0 0 0 3px var(--dsh-ui-accent-soft);'),
  r(['.rt-TextFieldInput::placeholder', '.rt-TextAreaInput::placeholder'], 'color: var(--dsh-ui-muted); opacity: 1;'),
  r(['.rt-Badge'], 'font-weight: var(--dsh-ui-weight-medium); letter-spacing: 0;'),
  r(['.icon-button:active', '.editor-tools button:active', '.editor-tools button:hover'], 'transform: none;'),
  r(['.rt-BaseButton:focus-visible', '.tree-row:focus-visible', '.chat-step-summary:focus-visible', '.chat-process-toggle:focus-visible', '.icon-button:focus-visible'], 'outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px;'),

  // Neutral navigation: location is not a primary action.
  r(['.shell .sidebar'], 'background: var(--dsh-ui-sidebar); border-right: 0;'),
  r(['.shell .sidebar .side-title'], 'min-height: var(--dsh-ui-header-height); border-bottom: 1px solid var(--dsh-ui-line);'),
  r(['.shell .sidebar .side-title-label'], 'font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium); color: var(--dsh-ui-muted);'),
  r(['.shell .tree .tree-row'], 'min-height: var(--dsh-ui-space-8); border-radius: var(--dsh-ui-radius-md); color: var(--dsh-ui-text); font-size: var(--dsh-ui-text-sm);'),
  r(['.shell .tree .tree-row:hover'], 'background: var(--dsh-ui-hover);'),
  r(['.shell .tree .tree-row[aria-current="page"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.shell .tree .tree-row::before'], 'display: none;'),
  r(['.shell .tree .tree-row[data-drop="true"]'], 'background: var(--dsh-ui-accent-soft); box-shadow: inset 0 0 0 1px var(--dsh-ui-accent);'),
  r(['.shell .tree-row-actions'], 'opacity: 1;'),
  r(['.shell .panel-resizer::before'], 'background: var(--dsh-ui-line);'),
  r(['.shell .panel-resizer:hover::before', '.shell .panel-resizer:focus-visible::before', '.shell .panel-resizer[data-separator="active"]::before'], 'background: var(--dsh-ui-accent);'),
  r(['.sidebar-tools'], 'gap: var(--dsh-ui-space-2);'),

  // Writing stays in the existing CodeMirror instance. Do not override the
  // author's font, size, line-height, line width or typography preferences.
  r(['.editor'], 'background: var(--dsh-ui-bg); --paper-pad-inline: clamp(24px, 4vw, 64px); --paper-pad-block: 32px;'),
  r(['.editor-header', '.pinned-header'], 'min-height: var(--dsh-ui-header-height); background: var(--dsh-ui-bg); border-bottom: 1px solid var(--dsh-ui-line);'),
  r(['.editor-doc-title'], 'color: var(--dsh-ui-text); font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.editor-header [data-testid="paper-wordcount"]', '.editor-header [data-testid="paper-save-state"]'], 'color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); font-variant-numeric: tabular-nums;'),
  r(['.editor-tools'], 'background: var(--dsh-ui-bg); border-top: 1px solid var(--dsh-ui-line); padding: var(--dsh-ui-space-2) var(--dsh-ui-space-4); gap: var(--dsh-ui-space-2);'),
  r(['.editor-tools button'], 'min-height: var(--dsh-ui-control-sm); padding-inline: var(--dsh-ui-space-3); background: transparent; border: 1px solid transparent; border-radius: var(--dsh-ui-radius-sm); color: var(--dsh-ui-muted); box-shadow: none;'),
  r(['.editor-tools button:hover:not(:disabled)'], 'background: var(--dsh-ui-hover); color: var(--dsh-ui-text); border-color: transparent; box-shadow: none;'),
  r(['.paper-input .cm-placeholder'], 'color: var(--dsh-ui-muted); font-style: normal;'),
  r(['.ghost.is-loading'], 'color: var(--dsh-ui-muted); background: none; animation: none;'),

  // Conversation: open assistant prose, inset neutral user bubbles and grouped
  // process disclosures. Flex accommodates optional banners without extra grid rows.
  r(['.shell .chat'], 'display: flex; flex-direction: column; background: var(--dsh-ui-bg);'),
  r(['.chat-header'], 'flex-shrink: 0; min-height: var(--dsh-ui-header-height); border-bottom: 1px solid var(--dsh-ui-line); background: var(--dsh-ui-bg);'),
  r(['.conversation-select .select-trigger'], 'border: 0; box-shadow: none; background: transparent; font-weight: var(--dsh-ui-weight-medium);'),
  r(['.chat-status', '.composer-mode'], 'font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted);'),
  r(['.chat .archived-conversations'], 'flex-shrink: 0; border-bottom: 1px solid var(--dsh-ui-line);'),
  r(['.chat > .chat-history'], 'flex: 1 1 0%; min-height: 0; height: auto; overflow: hidden;'),
  r(['.chat-history .rt-ScrollAreaViewport > div > .rt-Flex'], 'gap: var(--dsh-ui-space-5); padding: var(--dsh-ui-space-4);'),
  r(['.chat-row'], 'min-width: 0; max-width: 100%; overflow-wrap: anywhere;'),
  r(['.chat-row.user'], 'align-self: flex-end; width: fit-content; max-width: 92%;'),
  r(['.chat-row.user > .rt-Card'], 'background: var(--dsh-ui-sunken); border: 0; border-radius: var(--dsh-ui-radius-lg); box-shadow: none; padding: var(--dsh-ui-space-3) var(--dsh-ui-space-4);'),
  r(['.chat-row.user > .rt-Card::before', '.chat-row.user > .rt-Card::after'], 'display: none;'),
  r(['.chat-row.assistant', '.chat-markdown'], 'font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-relaxed); color: var(--dsh-ui-text);'),
  r(['.chat-markdown p'], 'margin-block: 0 var(--dsh-ui-space-3);'),
  r(['.chat-markdown h1', '.chat-markdown h2'], 'font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-strong);'),
  r(['.chat-markdown h3', '.chat-markdown h4'], 'font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-strong);'),
  r(['.chat-markdown a'], 'color: var(--dsh-ui-accent-solid); text-underline-offset: 3px;'),
  r(['.chat-markdown pre', '.chat-step-code', '.chat-step-body pre'], 'background: var(--dsh-ui-surface); border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-md); font-family: var(--dsh-ui-font-mono);'),
  r(['.chat-markdown th', '.chat-markdown td'], 'border-color: var(--dsh-ui-line); padding: var(--dsh-ui-space-2);'),
  r(['.chat-empty'], 'padding: var(--dsh-ui-space-6) var(--dsh-ui-space-2); color: var(--dsh-ui-muted);'),
  r(['.chat-process-toggle'], 'min-height: var(--dsh-ui-space-8); height: auto; padding: var(--dsh-ui-space-1) 0; border: 0; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);'),
  r(['.chat-process-body'], 'margin-left: var(--dsh-ui-space-1); padding-left: var(--dsh-ui-space-3); border-left: 1px solid var(--dsh-ui-line);'),
  r(['.chat-step:not([open])'], 'height: var(--dsh-ui-space-8);'),
  r(['.chat-step-head'], 'height: var(--dsh-ui-space-8); font-size: var(--dsh-ui-text-sm);'),
  r(['.chat-step-summary'], 'border-radius: var(--dsh-ui-radius-sm);'),
  r(['.chat-step-summary:hover'], 'background: var(--dsh-ui-hover);'),
  r(['.chat-step-status.is-ok'], 'background: var(--dsh-ui-success);'),
  r(['.chat-step-status.is-error', '.chat-step-error-dot'], 'background: var(--dsh-ui-danger);'),

  // A single composer surface, not an input box plus a separate configuration bar.
  r(['.chat > .composer'], 'flex-shrink: 0; width: auto; margin: var(--dsh-ui-space-3) var(--dsh-ui-space-3) var(--dsh-ui-space-4); padding: var(--dsh-ui-space-3); background: var(--dsh-ui-raised); border: 1px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-xl); box-shadow: var(--dsh-ui-shadow-sm); transition: border-color var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), box-shadow var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);'),
  r(['.chat > .composer:focus-within'], 'border-color: var(--dsh-ui-accent); box-shadow: 0 0 0 3px var(--dsh-ui-accent-soft);'),
  r(['.composer .rt-TextAreaRoot', '.composer .rt-TextAreaRoot:focus-within'], 'background: transparent; border: 0; box-shadow: none;'),
  r(['.composer .rt-TextAreaRoot::before', '.composer .rt-TextAreaRoot::after'], 'display: none;'),
  r(['.composer .rt-TextAreaInput'], 'min-height: 64px; max-height: min(240px, 32dvh); padding: var(--dsh-ui-space-1); font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-relaxed);'),
  r(['.composer-toolbar'], 'gap: var(--dsh-ui-space-2); min-height: var(--dsh-ui-space-8);'),
  r(['.composer-model'], 'min-width: 0;'),
  r(['.composer-model .select-trigger'], 'min-height: var(--dsh-ui-control-sm); max-width: 100%; box-shadow: none; background: transparent; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);'),
  r(['.composer-actions .send'], 'width: var(--dsh-ui-space-8); height: var(--dsh-ui-space-8); min-width: var(--dsh-ui-space-8); min-height: var(--dsh-ui-space-8); margin: 0; border-radius: var(--dsh-ui-radius-full); background: var(--dsh-ui-accent-solid); color: var(--dsh-ui-on-accent);'),
  r(['.composer-actions .send:hover:not(:disabled)'], 'background: var(--dsh-ui-accent-hover);'),
  r(['.composer-actions .send:disabled'], 'background: var(--dsh-ui-sunken); color: var(--dsh-ui-muted); opacity: 0.65;'),
  r(['.composer-actions .chat-stop'], 'width: var(--dsh-ui-space-8); height: var(--dsh-ui-space-8); margin: 0; border-radius: var(--dsh-ui-radius-full); background: var(--dsh-ui-danger-soft); color: var(--dsh-ui-danger);'),

  // Review and approvals remain visually distinct from routine tool logs.
  r(['.proposal', '.proposal-card'], 'background: var(--dsh-ui-raised); border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-lg); box-shadow: var(--dsh-ui-shadow-xs); padding: var(--dsh-ui-space-4);'),
  r(['.proposal-card > strong', '.proposal > strong'], 'font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-medium); color: var(--dsh-ui-text);'),
  r(['.proposal-actions'], 'gap: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-2);'),
  r(['.proposal-card pre'], 'max-height: min(48dvh, 28rem); border-radius: var(--dsh-ui-radius-md); background: var(--dsh-ui-surface); color: var(--dsh-ui-text); scrollbar-gutter: stable;'),
  r(['.proposal-conflict'], 'background: var(--dsh-ui-danger-soft); color: var(--dsh-ui-danger); border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-md); padding: var(--dsh-ui-space-3);'),
  r(['.chat-row.notice'], 'padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3); background: var(--dsh-ui-surface); border-left: 2px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-sm); color: var(--dsh-ui-muted);'),

  // Portals: neutral menus, bounded scroll, consistent keyboard focus.
  r(['.rt-DropdownMenuContent', '.rt-ContextMenuContent', '.rt-SelectContent'], 'background: var(--dsh-ui-raised); border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-lg); box-shadow: var(--dsh-ui-shadow-lg);'),
  r(['.rt-DropdownMenuItem', '.rt-ContextMenuItem', '.rt-SelectItem'], 'min-height: var(--dsh-ui-space-8); border-radius: var(--dsh-ui-radius-sm); font-size: var(--dsh-ui-text-sm);'),
  r(['.rt-DropdownMenuItem[data-highlighted]:not([data-accent-color="red"])', '.rt-ContextMenuItem[data-highlighted]:not([data-accent-color="red"])', '.rt-SelectItem[data-highlighted]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.rt-DialogContent', '.rt-AlertDialogContent'], 'background: var(--dsh-ui-raised); border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-xl); box-shadow: var(--dsh-ui-shadow-xl);'),
  r(['.palette-content'], 'border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-xl); background: var(--dsh-ui-raised); box-shadow: var(--dsh-ui-shadow-xl);'),
  r(['.palette-item[data-selected="true"]', '[cmdk-item][data-selected="true"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.palette-item-icon', '.palette-item[data-selected="true"] .palette-item-icon'], 'background: transparent; color: var(--dsh-ui-muted);'),
  r(['.palette-footer'], 'background: var(--dsh-ui-surface); border-top: 1px solid var(--dsh-ui-line); color: var(--dsh-ui-muted);'),

  // Settings are a settings window, not a collection of differently themed cards.
  r(['.settings-nav'], 'background: var(--dsh-ui-sidebar); border-right: 1px solid var(--dsh-ui-line); padding: var(--dsh-ui-space-5) var(--dsh-ui-space-3);'),
  r(['.settings-nav .settings-tab'], 'min-height: var(--dsh-ui-control-md); border-radius: var(--dsh-ui-radius-md); font-size: var(--dsh-ui-text-sm);'),
  r(['.settings-nav .settings-tab[data-state="active"]', '.settings-nav .settings-tab.active'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.settings-header'], 'background: var(--dsh-ui-raised); border-bottom: 1px solid var(--dsh-ui-line);'),
  r(['.settings-header-title', '.settings-nav h2'], 'font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.settings-block-title', '.settings-page h3'], 'font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.settings-dialog .settings-row'], 'min-height: 56px; padding-block: var(--dsh-ui-space-3);'),
  r(['.settings-row-description'], 'font-size: var(--dsh-ui-text-sm); color: var(--dsh-ui-muted);'),
  r(['.settings-dialog .settings-block + .settings-block'], 'border-top: 1px solid var(--dsh-ui-line); padding-top: var(--dsh-ui-space-5);'),
  r(['.settings-segmented'], 'background: var(--dsh-ui-sunken); border-radius: var(--dsh-ui-radius-md);'),
  r(['.settings-content.is-active .settings-page'], 'animation: none;'),
  r(['.history-commit[aria-current="true"]', '.history-commit[aria-selected="true"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),

  // Shared scroll and activity grammar. No perpetual decorative shimmer.
  r(['.activity-dots.is-typing i'], 'animation-name: shell-activity-pulse;'),
  r(['.panel-skeleton i::after'], 'display: none;'),
  r(['.activity-shimmer'], 'height: 2px; background: var(--dsh-ui-line);'),
  r(['.shell > .assistant-launcher'], 'background: var(--dsh-ui-raised); border: 1px solid var(--dsh-ui-line); box-shadow: var(--dsh-ui-shadow-md); animation: none;'),
  r(['.shell > .assistant-launcher:not(.capability-note):hover'], 'transform: none; background: var(--dsh-ui-hover); box-shadow: var(--dsh-ui-shadow-md);'),
  r(['.shell ::-webkit-scrollbar'], 'width: 6px; height: 6px;'),
  r(['.shell ::-webkit-scrollbar-thumb'], 'background: var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-full);'),
  r(['.shell ::-webkit-scrollbar-thumb:hover'], 'background: var(--dsh-ui-muted);'),
  r(['.shell .chat.chat-overlay', '.shell > .sidebar-overlay'], 'border: 1px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-xl); box-shadow: var(--dsh-ui-shadow-xl);'),
  r(['.shell > .chat-overlay-dismiss', '.shell > .side-overlay-dismiss'], 'background: var(--dsh-ui-scrim);'),
].join('\n')

export const responsiveStyles = `
@supports (container-type: inline-size) {
  ${r(['.editor-stack'], 'container-type: inline-size;')}
  ${r(['.editor'], '--paper-pad-inline: clamp(24px, 7cqi, 64px);')}
}
@media (max-width: 760px) {
  ${r(['.composer-mode'], 'max-width: 7em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;')}
  ${r(['.chat > .composer'], 'margin: var(--dsh-ui-space-2);')}
  ${r(['.editor-header'], 'gap: var(--dsh-ui-space-2); padding-inline: var(--dsh-ui-space-3); flex-wrap: wrap;')}
  ${r(['.editor-doc-title'], 'padding-inline-start: 0;')}
  ${r(['.settings-dialog'], 'width: calc(100vw - 16px); height: calc(100dvh - 16px); grid-template-columns: 104px minmax(0, 1fr);')}
  ${r(['.settings-nav'], 'padding-inline: var(--dsh-ui-space-2);')}
  ${r(['.settings-content', '.settings-header'], 'padding: var(--dsh-ui-space-3);')}
}
@media (prefers-reduced-motion: reduce) {
  ${r(['*', '*::before', '*::after'], 'animation: none !important; transition: none !important; scroll-behavior: auto !important;')}
}
@media (forced-colors: active) {
  ${r(['button:focus-visible', '[tabindex]:focus-visible'], 'outline: 2px solid Highlight;')}
  ${r(['.tree-row[aria-current="page"]', '.settings-tab[data-state="active"]'], 'outline: 1px solid Highlight; outline-offset: -1px;')}
  ${r(['.composer', '.proposal-card'], 'border: 1px solid CanvasText;')}
}
`

export const designSystemStyles = `${tokenStyles}\n${componentStyles}\n${responsiveStyles}`
