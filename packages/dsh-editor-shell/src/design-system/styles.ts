/**
 * DSH official visual adapter for the existing React/Radix shell.
 * This is the single owner of product appearance. Existing styles.ts retains
 * structural, editor, native-window, plugin-seat and interaction contracts.
 * Do not add screen-specific competing overrides in either stylesheet.
 * Upstream attribution: resources/third-party/deepseek-harness-MIT.txt.
 * The earlier Kimi Web notice remains at resources/third-party/kimi-web-MIT.txt.
 */
import { SCOPE, SCOPE_DARK, TOKEN_SCOPE, tokenStyles } from './tokens.ts'

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

// Radix portals put `.radix-themes` on the floating node itself. A descendant
// selector misses that node, so menu and mask rules also match the theme root.
function withThemeSelf(selectors: readonly string[], declarations: string): string {
  const forms = selectors.flatMap((selector) => {
    const pseudo = selector.indexOf('::')
    const body = pseudo < 0 ? selector : selector.slice(0, pseudo)
    const after = pseudo < 0 ? '' : selector.slice(pseudo)
    const descendant = `${SCOPE} ${body}${excludePlugin}${after}`
    const self = `${TOKEN_SCOPE} .radix-themes${body}${excludePlugin}${after}`
    return [descendant, self]
  })
  return `${forms.join(',\n')} { ${declarations} }\n`
}

const hairline = '0.5px solid var(--dsh-ui-line)'
// Structural 50%, 100% and 999px circles/pills. The capability note is a rounded
// rectangle and keeps the superellipse. Plugin surfaces stay outside uiRule.
const roundShapes = [
  '.composer-actions .send', '.composer-actions .chat-stop', 'button.send', 'button.chat-stop',
  '.shell ::-webkit-scrollbar-thumb',
  '.rt-AvatarRoot', '.rt-AvatarImage', '.rt-AvatarFallback',
  '.models-credential-dot',
  '.preset-badge', '.cards-badge',
  '.activity-dots i', '.panel-activity-dots i',
  '.activity-shimmer', '.activity-shimmer i',
  '.history-commit-dot',
  '.image-preview-close',
  '.chat-step-status', '.chat-step-error-dot',
]
const cardSurface = 'background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-xl); box-shadow: none;'
const menuSelectors = ['.rt-DropdownMenuContent', '.rt-ContextMenuContent', '.rt-SelectContent', '.rt-BaseMenuContent'] as const


export const componentStyles = [
  // Global plugin page shares the workspace cell without resizing the manuscript.
  r(['.plugin-workspace'], 'display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); width: 100%; height: 100%; min-height: 0;'),
  r(['.plugin-workspace-writing', '.plugins-page'], 'grid-area: 1 / 1; min-width: 0; min-height: 0;'),
  r(['.plugin-workspace-writing.is-covered'], 'visibility: hidden; pointer-events: none;'),
  r(['.plugins-page'], 'display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--dsh-ui-header-height) minmax(0, 1fr); background: var(--dsh-ui-bg); color: var(--dsh-ui-text);'),
  r(['.plugins-page-header'], `padding-inline-start: var(--dsh-ui-space-3); border-bottom: ${hairline};`),
  // Page title outranks the plugin group h3 (16px/600); the header default left it smaller.
  r(['.plugins-page-header .rt-Heading'], 'font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-medium); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'),
  r(['.plugins-page-header button', '.plugins-trigger'], '-webkit-app-region: no-drag;'),
  r(['.plugins-page-layout'], 'display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 0;'),
  r(['.plugins-page-nav'], `display: flex; flex-direction: column; gap: var(--dsh-ui-space-3); padding: var(--dsh-ui-space-4); overflow: auto; background: var(--dsh-ui-sidebar); border-right: ${hairline};`),
  r(['.plugins-page-nav > *'], 'flex-shrink: 0;'),
  /* Nav section label follows the settings-nav-group treatment (muted, small,
     medium weight) so it never out-weighs the content group headings. */
  r(['.plugins-config-label'], 'margin-top: var(--dsh-ui-space-4); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.plugins-config-links'], 'display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0;'),
  r(['.plugins-page .plugins-page-nav .plugins-page-link'], 'justify-content: flex-start; width: 100%; margin: 0; padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3); border: 0; border-radius: var(--dsh-ui-radius-md); background: transparent; box-shadow: none; color: var(--dsh-ui-text); white-space: normal; text-align: start; height: auto; min-height: var(--dsh-ui-control-md); overflow-wrap: anywhere;'),
  r(['.plugins-page .plugins-page-nav .plugins-page-link:hover'], 'background: var(--dsh-ui-hover);'),
  r(['.plugins-page .plugins-page-nav .plugins-page-link[aria-current="page"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.plugins-page-content'], 'padding: var(--dsh-ui-space-5); overflow: auto; min-width: 0; min-height: 0; overflow-wrap: anywhere;'),
  // Header search + add action share the drag row; the title yields before them.
  r(['.plugins-page-tools'], 'min-width: 0;'),
  r(['.plugins-page-search'], 'flex: 0 1 16rem; min-width: 0;'),
  // Three-class catalog: one flat card per row, one primary control, no shadow.
  r(['.plugins-catalog'], 'display: flex; flex-direction: column; gap: var(--dsh-ui-space-6); min-width: 0;'),
  r(['.plugins-catalog-section'], 'display: flex; flex-direction: column; gap: var(--dsh-ui-space-3); min-width: 0;'),
  r(['.plugins-catalog-head'], 'min-width: 0;'),
  r(['.plugins-catalog-rows'], 'display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); list-style: none; margin: 0; padding: 0;'),
  r(['.plugins-catalog-row'], `${cardSurface} display: flex; align-items: center; gap: var(--dsh-ui-space-3); padding: var(--dsh-ui-space-3); min-width: 0;`),
  r(['.plugins-catalog-icon'], 'width: var(--dsh-ui-control-lg); height: var(--dsh-ui-control-lg); flex: none; border-radius: var(--dsh-ui-radius-md); background: var(--dsh-ui-surface); color: var(--dsh-ui-muted); display: flex; align-items: center; justify-content: center; font-weight: var(--dsh-ui-weight-strong);'),
  // The author's own brand art fills the same tile the monogram used, so a card
  // keeps one icon slot. contain keeps any oversized SVG inside the rounded tile.
  r(['.plugins-catalog-icon-image'], 'width: 100%; height: 100%; object-fit: contain; border-radius: inherit; display: block;'),
  r(['.plugins-catalog-row-text'], 'display: flex; flex-direction: column; gap: var(--dsh-ui-space-1); flex: 1 1 auto; min-width: 0;'),
  r(['.plugins-catalog-row-head'], 'flex-wrap: wrap; min-width: 0;'),
  r(['.plugins-catalog-row-title'], 'min-width: 0; overflow-wrap: anywhere; font-weight: var(--dsh-ui-weight-medium);'),
  // One line with the full text in the row tooltip keeps a long description from wrapping the control.
  r(['.plugins-catalog-row-desc'], 'margin: 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'),
  r(['.plugins-catalog-row-action'], 'flex: none; display: flex; align-items: center; justify-content: flex-end; gap: var(--dsh-ui-space-2); min-width: var(--dsh-ui-control-lg);'),
  /* 配置 and 详情 are the same kind of control, so they read the same way: a
     ghost button that gains its fill on hover. 详情 is the most frequent action
     in the catalog and a muted gray label made it look disabled next to the
     switch; `--dsh-ui-text` on the raised row surface clears 4.5:1 in both
     themes, and the switch stays the row's only filled control. */
  r(['.plugins-catalog-action'], 'height: auto; min-height: var(--dsh-ui-control-sm); padding: 0 var(--dsh-ui-space-2); border: 0; background: transparent; box-shadow: none; color: var(--dsh-ui-text); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.plugins-catalog-action:hover'], 'background: var(--dsh-ui-hover); color: var(--dsh-ui-text);'),
  /* A freshly installed user card announces itself where it already sits: one
     transient accent wash that settles back to the resting card surface. The
     length is composed from the slow motion token, and the client reads this
     same computed duration back to remove the class. */
  r(['.plugins-catalog-row.is-new'], 'animation: plugins-catalog-installed calc(var(--dsh-ui-duration-slow) * 4) var(--dsh-ui-ease-out);'),
  '@keyframes plugins-catalog-installed { from, 30% { background: var(--dsh-ui-accent-soft); border-color: var(--dsh-ui-accent-border); } to { background: var(--dsh-ui-raised); border-color: var(--dsh-ui-line-strong); } }',
  r(['.plugins-catalog-subsection'], `display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-3); border-top: ${hairline};`),
  r(['.plugins-catalog-subsection-title'], 'color: var(--dsh-ui-muted); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.plugins-catalog-hint', '.plugins-catalog-empty', '.plugins-catalog-preset-locked'], 'margin: 0; color: var(--dsh-ui-muted);'),
  r(['.plugins-catalog-advanced > summary'], 'cursor: pointer; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium); min-height: var(--dsh-ui-control-sm); padding-block: var(--dsh-ui-space-2);'),
  r(['.plugins-catalog-advanced[open] > summary', '.plugins-catalog-advanced .plugins-catalog-hint'], 'margin-bottom: var(--dsh-ui-space-2);'),

  // Shell and native chrome. Keep draggable/no-drag regions and native controls.
  `${SCOPE}.shell-theme { --topbar-h: var(--dsh-ui-header-height); --control-h: var(--dsh-ui-control-md); }`,
  r(['.shell'], 'background: var(--dsh-ui-bg); color: var(--dsh-ui-text); font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-normal);'),
  /* §1：顶栏 chrome 底、无下分割线；分栏之间由侧栏边线负责。 */
  r(['.dsh-topbar'], `height: var(--topbar-h); background: var(--dsh-ui-sidebar); box-shadow: none;`),
  r(['.workspace-menu-trigger'], 'border-radius: var(--dsh-ui-radius-md); background: transparent; color: var(--dsh-ui-text); box-shadow: none;'),
  r(['.workspace-menu-trigger:hover'], 'background: var(--dsh-ui-hover);'),
  /* 顶栏开关（IconButton data-variant=ghost）：默认弱字色，按下态用选中填充；
     暗色下 sunken 读作凹陷，用 hover 填充代替。 */
  r(['.dsh-topbar .dsh-icon-button'], 'color: var(--dsh-ui-muted);'),
  r(['.dsh-topbar .dsh-icon-button:hover:not(:disabled)'], 'background: var(--dsh-ui-hover); color: var(--dsh-ui-text);'),
  r(['.dsh-topbar .dsh-icon-button[aria-pressed="true"]'], 'background: var(--dsh-ui-sunken); color: var(--dsh-ui-text); box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong);'),
  `${SCOPE_DARK} .dsh-topbar .dsh-icon-button[aria-pressed="true"]${excludePlugin} { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong); }`,
  r(['.shell .window-controls button.window-close:hover'], 'background: var(--dsh-ui-danger); color: #ffffff;'),

  // Primitives. Preserve explicit Radix color overrides (red, gray, and the rest).
  r(['button.rt-BaseButton'], 'font-family: var(--dsh-ui-font-ui); font-weight: var(--dsh-ui-weight-medium); transition: background-color var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), color var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), box-shadow var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);'),
  r(['button.rt-Button.rt-r-size-1', 'button.rt-Button.rt-r-size-2'], 'min-height: var(--dsh-ui-control-sm); border-radius: var(--dsh-ui-radius-md); font-size: var(--dsh-ui-text-sm);'),
  r(['button.rt-Button.rt-r-size-2'], 'min-height: var(--dsh-ui-control-md); font-size: var(--dsh-ui-text-base);'),
  r(['button.rt-Button.rt-r-size-3'], 'min-height: var(--dsh-ui-control-lg); border-radius: var(--dsh-ui-radius-lg);'),
  r(['button.rt-IconButton'], 'min-width: var(--dsh-ui-control-sm); min-height: var(--dsh-ui-control-sm); border-radius: var(--dsh-ui-radius-md);'),
  // Radix accent default is the empty string, so absence and "" are both implicit.
  // A non-empty color (red, gray, blue, …) keeps that color's own solid styles.
  r(['button.rt-BaseButton.rt-variant-solid:is(:not([data-accent-color]), [data-accent-color=""]):not(.send):not(.chat-stop):not(:disabled):not([data-disabled])', 'button.primary-action:not(:disabled):not([data-disabled])'], 'background: var(--dsh-ui-brand); color: var(--dsh-ui-on-brand); box-shadow: none;'),
  r(['button.rt-BaseButton.rt-variant-solid:is(:not([data-accent-color]), [data-accent-color=""]):not(.send):not(.chat-stop):hover:not(:disabled):not([data-disabled])', 'button.primary-action:hover:not(:disabled):not([data-disabled])'], 'background: var(--dsh-ui-brand-hover); color: var(--dsh-ui-on-brand);'),
  r(['button.rt-BaseButton.rt-variant-solid:is(:not([data-accent-color]), [data-accent-color=""]):not(.send):not(.chat-stop):disabled', 'button.rt-BaseButton.rt-variant-solid:is(:not([data-accent-color]), [data-accent-color=""]):not(.send):not(.chat-stop)[data-disabled]', 'button.primary-action:disabled', 'button.primary-action[data-disabled]'], 'background: var(--dsh-ui-hover); color: var(--dsh-ui-muted); box-shadow: none;'),
  r(['button.rt-BaseButton.rt-variant-outline'], 'background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong); box-shadow: none; color: var(--dsh-ui-text);'),
  r(['button.rt-BaseButton.rt-variant-outline:hover'], 'background: var(--dsh-ui-hover);'),
  r(['button:disabled', 'button[data-disabled]'], 'cursor: not-allowed;'),
  r(['.rt-TextFieldRoot', '.rt-TextAreaRoot', '.rt-SelectTrigger'], 'background: var(--dsh-ui-raised); border: 0; border-radius: var(--dsh-ui-radius-md); box-shadow: var(--dsh-ui-elevation-soft);'),
  r(['.rt-TextFieldRoot:focus-within', '.rt-TextAreaRoot:focus-within', '.rt-SelectTrigger:focus-visible'], 'border: 0; box-shadow: var(--dsh-ui-elevation-focus);'),
  r(['.rt-TextFieldInput::placeholder', '.rt-TextAreaInput::placeholder'], 'color: var(--dsh-ui-muted); opacity: 1;'),
  r(['.rt-Badge'], 'font-weight: var(--dsh-ui-weight-medium); letter-spacing: 0;'),
  r(['.rt-Card', '.home-card', '.home-entry-card', '.settings-block.rt-Card'], cardSurface + ' transition: all var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);'),
  // Settings dialog blocks stay flat sections: the structural sheet zeroes their
  // padding, so the generic .rt-Card surface above left labels flush against a
  // visible border. Neutralize the chrome inside the settings dialog.
  r(['.settings-dialog .settings-block.rt-Card'], 'background: transparent; border: 0; border-radius: 0; box-shadow: none;'),
  r(['.rt-Card::before', '.rt-Card::after', '.home-entry-card::before', '.home-entry-card::after'], 'backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;'),
  r(['.home-entry-card:hover', '.home-card:hover'], 'background: var(--dsh-ui-raised); box-shadow: var(--dsh-ui-elevation-prominent); transform: translateY(-2px);'),
  r(['.home-entry-icon'], 'width: 40px; height: 40px; border-radius: var(--dsh-ui-radius-md); background: var(--dsh-ui-accent-soft); color: var(--dsh-ui-accent); display: flex; align-items: center; justify-content: center;'),
  r(['.home-entry-title'], 'font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-strong);'),
  r(['.home-hint', '.home-recent-empty'], 'color: var(--dsh-ui-muted);'),
  r(['.icon-button:active', '.editor-tools button:active', '.editor-tools button:hover'], 'transform: none;'),
  r(['.rt-BaseButton:focus-visible', '.tree-row:focus-visible', '.icon-button:focus-visible', '.home-entry-card:focus-visible', '.search-hit:focus-visible'], 'outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; box-shadow: 0 0 0 4px var(--dsh-ui-accent-soft);'),
  r(['a:not(.rt-BaseButton)'], 'color: var(--dsh-ui-link);'),

  // Neutral navigation: location is not a primary action. File rail styles
  // (sidebar head, tree rows, search panel) live in app/files/files-rail.styles.ts.
  // Home recent-work rows stack a title, a path and a timestamp, so they keep the
  // wrapping block. File-tree rows do not: one entry is one line, and the full name
  // stays reachable through the row's title attribute.
  r(['.home-recent .workspace-row .tree-row'], 'min-height: var(--dsh-ui-space-8); height: auto; align-items: flex-start; padding-block: var(--dsh-ui-space-1); white-space: normal;'),
  r(['.home-recent .workspace-row .tree-row:hover'], 'background: var(--dsh-ui-hover); box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong);'),
  r(['.home-recent .workspace-row .tree-row[aria-current="page"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text); box-shadow: inset 3px 0 0 var(--dsh-ui-accent);'),
  r(['.shell .panel-resizer::before'], 'background: var(--dsh-ui-line);'),
  r(['.shell .panel-resizer:hover::before', '.shell .panel-resizer:focus-visible::before', '.shell .panel-resizer[data-separator="active"]::before'], 'background: var(--dsh-ui-accent);'),
  r(['.project-directory'], 'overflow-wrap: anywhere;'),
  r(['.settings-nav-section'], 'display: flex; flex-direction: column; width: 100%; gap: var(--dsh-ui-space-1);'),
  r(['.settings-nav-section + .settings-nav-section'], 'margin-top: var(--dsh-ui-space-6); padding-top: var(--dsh-ui-space-6); border-top: 0.5px solid var(--dsh-ui-line);'),
  // Uppercase does nothing for the Chinese group names, so the label/tab
  // distinction is carried by size and colour instead of weight alone.
  r(['.settings-nav-group'], 'padding: var(--dsh-ui-space-3) var(--dsh-ui-space-3) var(--dsh-ui-space-1); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); font-weight: var(--dsh-ui-weight-strong); letter-spacing: 0; margin-bottom: var(--dsh-ui-space-1);'),
  r(['.sidebar-tools'], 'gap: var(--dsh-ui-space-2);'),

  // Writing stays in the existing CodeMirror instance. Do not override the
  // author's font, size, line-height, line width or typography preferences.
  r(['.editor'], 'background: var(--dsh-ui-bg); --paper-pad-inline: clamp(24px, 4vw, 64px); --paper-pad-block: 32px;'),
  r(['.editor-header', '.pinned-header'], 'min-height: var(--dsh-ui-header-height); background: var(--dsh-ui-bg); border-bottom: 0;'),
  r(['.editor-doc-title'], 'color: var(--dsh-ui-text); font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.editor-header [data-testid="paper-wordcount"]', '.editor-header [data-testid="paper-save-state"]'], 'color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); font-variant-numeric: tabular-nums;'),
  r(['.editor-tools'], `background: var(--dsh-ui-bg); border-top: ${hairline}; padding: var(--dsh-ui-space-2) var(--dsh-ui-space-4); gap: var(--dsh-ui-space-2);`),
  r(['.editor-tools button'], 'min-height: var(--dsh-ui-control-sm); padding-inline: var(--dsh-ui-space-3); background: transparent; border: 0.5px solid transparent; border-radius: var(--dsh-ui-radius-md); color: var(--dsh-ui-muted); box-shadow: none;'),
  r(['.editor-tools button:hover:not(:disabled)'], 'background: var(--dsh-ui-hover); color: var(--dsh-ui-text); border-color: transparent; box-shadow: none;'),
  r(['.paper-input .cm-placeholder'], 'color: var(--dsh-ui-muted); font-style: normal;'),
  r(['.ghost.is-loading'], 'color: var(--dsh-ui-muted); background: none; animation: none;'),

  // Conversation: open assistant prose, one bubble fill, grouped process rows.
  r(['.shell .chat'], 'display: flex; flex-direction: column; background: var(--dsh-ui-sidebar);'),
  r(['.chat-header'], 'flex-shrink: 0; min-height: var(--dsh-ui-header-height); border-bottom: 0; background: var(--dsh-ui-sidebar);'),
  r(['.chat-status'], 'font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted);'),
  r(['.chat > .chat-history'], 'flex: 1 1 0%; min-height: 0; height: auto; overflow: hidden;'),
  r(['.chat-history .rt-ScrollAreaViewport > div > .rt-Flex'], 'gap: var(--dsh-ui-space-6); padding: var(--dsh-ui-space-5);'),
  r(['.chat-row'], 'min-width: 0; max-width: 100%; overflow-wrap: anywhere;'),
  r(['.chat-row.user'], 'align-self: flex-end; width: fit-content; max-width: 92%;'),
  r(['.chat-row.assistant', '.chat-markdown'], 'font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-regular); line-height: var(--dsh-ui-leading-relaxed); color: var(--dsh-ui-text);'),
  r(['.chat-markdown p'], 'margin-block: 0 var(--dsh-ui-space-4);'),
  r(['.chat-markdown li'], 'margin-block: var(--dsh-ui-space-2);'),
  r(['.chat-markdown > :last-child'], 'margin-bottom: 0;'),
  r(['.chat-markdown h1', '.chat-markdown h2'], 'font-size: var(--dsh-ui-text-2xl); font-weight: var(--dsh-ui-weight-strong); margin-bottom: var(--dsh-ui-space-3); line-height: var(--dsh-ui-leading-tight);'),
  r(['.chat-markdown h3'], 'font-size: var(--dsh-ui-text-xl); font-weight: var(--dsh-ui-weight-strong); margin-bottom: var(--dsh-ui-space-2); line-height: var(--dsh-ui-leading-tight);'),
  r(['.chat-markdown h4'], 'font-size: var(--dsh-ui-text-md); font-weight: var(--dsh-ui-weight-strong); margin-bottom: var(--dsh-ui-space-2); line-height: var(--dsh-ui-leading-normal);'),
  r(['.chat-markdown a'], 'color: var(--dsh-ui-link); font-weight: var(--dsh-ui-weight-medium); text-decoration: none; text-underline-offset: 3px;'),
  r(['.chat-markdown a:hover', '.chat-markdown a:focus-visible'], 'text-decoration: underline dotted; text-underline-offset: 3px;'),
  r(['.chat-markdown code'], 'border-radius: var(--dsh-ui-radius-xs);'),
  r(['.chat-markdown pre', '.chat-step-code', '.chat-step-body pre'], 'background: var(--dsh-ui-surface); border: 0.5px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-lg); box-shadow: none; font-family: var(--dsh-ui-font-mono);'),
  r(['.chat-markdown th', '.chat-markdown td'], `border-width: 0.5px; border-style: solid; border-color: var(--dsh-ui-line); padding: var(--dsh-ui-space-2);`),
  r(['.chat-step-head'], 'height: var(--dsh-ui-space-8); font-size: var(--dsh-ui-text-sm);'),
  r(['.chat-step-status.is-ok'], 'background: var(--dsh-ui-success);'),
  r(['.chat-step-status.is-error', '.chat-step-error-dot'], 'background: var(--dsh-ui-danger);'),

  // A single composer surface, not an input box plus a separate configuration bar.
  r(['.chat > .composer'], 'flex-shrink: 0; width: auto; margin: var(--dsh-ui-space-2) var(--dsh-ui-space-2) var(--dsh-ui-space-3); padding: var(--dsh-ui-space-2); background: var(--dsh-ui-raised); border: 0; border-radius: var(--dsh-ui-radius-panel); box-shadow: var(--dsh-ui-elevation-soft); transition: box-shadow var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);'),
  r(['.chat > .composer:focus-within'], 'border: 0; box-shadow: var(--dsh-ui-elevation-focus);'),

  r(['.composer-toolbar'], 'gap: var(--dsh-ui-space-2); min-height: var(--dsh-ui-space-8); margin-top: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-2); border-top: 0.5px solid var(--dsh-ui-line);'),
  // Voice input is an optional plugin surface: idle it is one compact trigger beside send,
  // an active capture takes the first wrapped line. `order` and `flex-basis` are structural
  // placement, not a new visual scale; an absent plugin contributes no flex item at all.
  r(['.composer-voice'], 'display: flex; align-items: center; flex-shrink: 0; min-width: 0;'),
  r(['.composer-voice:not(:has(> div:not(:empty)))'], 'display: none;'),
  r(['.composer-voice-expanded'], 'order: -1; flex-basis: 100%;'),
  r(['.composer-model'], 'min-width: 0;'),
  r(['.composer-model .select-trigger'], 'min-height: var(--dsh-ui-control-sm); max-width: 100%; border: 0; box-shadow: none; background: transparent; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);'),
  // Send button: base dimensions and appearance apply to all states
  r(['button.rt-BaseButton.send', '.composer-actions .send'], 'width: var(--dsh-ui-control-xl); height: var(--dsh-ui-control-xl); min-width: var(--dsh-ui-control-xl); min-height: var(--dsh-ui-control-xl); margin: 0; border: 0; border-radius: var(--dsh-ui-radius-full); corner-shape: round; box-shadow: none; transition: background var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), transform var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out);'),
  // Enabled send gets brand background
  r(['button.rt-BaseButton.send:not(:disabled):not([disabled])', '.composer-actions .send:not(:disabled):not([disabled])'], 'background: var(--dsh-ui-brand); color: var(--dsh-ui-on-brand);'),
  r(['button.rt-BaseButton.send:hover:not(:disabled):not([disabled])', '.composer-actions .send:hover:not(:disabled):not([disabled])'], 'background: var(--dsh-ui-brand-hover); transform: scale(1.05);'),
  // Disabled send overrides with transparent
  r(['button.rt-BaseButton.send:disabled', 'button.rt-BaseButton.send[disabled]', '.composer-actions .send:disabled', '.composer-actions .send[disabled]'], 'background: transparent; color: var(--dsh-ui-muted); opacity: 1; box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong); transform: none; cursor: not-allowed;'),
  r(['button.rt-BaseButton.chat-stop', '.composer-actions .chat-stop'], 'width: var(--dsh-ui-space-8); height: var(--dsh-ui-space-8); margin: 0; border: 0; border-radius: var(--dsh-ui-radius-full); corner-shape: round; background: var(--dsh-ui-raised); color: var(--dsh-ui-text); box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong); transition: none;'),

  // Review and approvals remain visually distinct from routine tool logs.
  /* §5：提案/回执/冲突/过期卡统一为扁平 raised + line-strong，无侧边色条。 */
  r(['.proposal', '.proposal-card'], 'background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-xl); box-shadow: none; padding: var(--dsh-ui-space-5);'),
  r(['.proposal-card > strong', '.proposal > strong'], 'font-size: var(--dsh-ui-text-md); font-weight: var(--dsh-ui-weight-strong); color: var(--dsh-ui-text); display: block; margin-bottom: var(--dsh-ui-space-3);'),
  r(['.proposal-actions'], 'gap: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-4); margin-top: var(--dsh-ui-space-4); border-top: 0.5px solid var(--dsh-ui-line);'),
  r(['.proposal-card pre'], 'max-height: min(48dvh, 28rem); border: 0.5px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-lg); background: var(--dsh-ui-surface); color: var(--dsh-ui-text); box-shadow: none; scrollbar-gutter: stable;'),
  r(['.proposal-path-line'], 'font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); margin: var(--dsh-ui-space-1) 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'),
  r(['.proposal-conflict'], 'background: var(--dsh-ui-raised); color: var(--dsh-ui-text); border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-md); padding: var(--dsh-ui-space-3);'),
  r(['.chat-row.notice'], 'padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3); background: var(--dsh-ui-surface); border-left: 2px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-sm); color: var(--dsh-ui-muted);'),

  // Portals. Menus are a solid surface now (menu-blur: none). Modal masks stay sharp.
  withThemeSelf(menuSelectors, 'background: var(--dsh-ui-menu-fill); border: 0; border-radius: var(--dsh-ui-radius-lg); box-shadow: var(--dsh-ui-elevation-panel); backdrop-filter: var(--dsh-ui-menu-blur); -webkit-backdrop-filter: var(--dsh-ui-menu-blur);'),
  r(['.rt-DropdownMenuItem', '.rt-ContextMenuItem', '.rt-SelectItem', '.rt-BaseMenuItem'], 'min-height: var(--dsh-ui-control-sm); border-radius: var(--dsh-ui-radius-md); font-size: var(--dsh-ui-text-sm);'),
  r(['.rt-BaseMenuSeparator', '.rt-DropdownMenuSeparator', '.rt-ContextMenuSeparator'], 'height: 0.5px; background: var(--dsh-ui-line);'),
  r(['.rt-DropdownMenuItem[data-highlighted]:not([data-accent-color="red"])', '.rt-ContextMenuItem[data-highlighted]:not([data-accent-color="red"])', '.rt-SelectItem[data-highlighted]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  withThemeSelf(['.rt-BaseDialogOverlay', '.rt-BaseDialogOverlay::before', '.palette-overlay', '.file-dialog-overlay'], 'backdrop-filter: none; -webkit-backdrop-filter: none;'),
  withThemeSelf(['.rt-BaseDialogOverlay::before', '.palette-overlay', '.file-dialog-overlay'], 'background: var(--dsh-ui-scrim);'),
  r(['.rt-DialogContent', '.rt-AlertDialogContent', '.file-dialog'], 'background: var(--dsh-ui-raised); border: 0; border-radius: var(--dsh-ui-radius-panel); box-shadow: var(--dsh-ui-elevation-prominent);'),
  r(['.palette-content'], 'border: 0; border-radius: var(--dsh-ui-radius-panel); background: var(--dsh-ui-raised); box-shadow: var(--dsh-ui-elevation-prominent);'),
  r(['.palette-item', '[cmdk-item]'], 'border-radius: var(--dsh-ui-radius-md);'),
  r(['.palette-item[data-selected="true"]', '[cmdk-item][data-selected="true"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.palette-item-icon', '.palette-item[data-selected="true"] .palette-item-icon'], 'background: transparent; color: var(--dsh-ui-muted);'),
  r(['.palette-footer'], `background: var(--dsh-ui-surface); border-top: ${hairline}; color: var(--dsh-ui-muted);`),
  // The palette field is the whole point of the surface, so it is sized like a
  // control rather than like a bare text line.
  r(['.palette-input', 'input[cmdk-input]'], 'min-height: var(--dsh-ui-control-sm);'),
  // Keyboard hints are peripheral copy, so the 12px scale is their floor; the
  // Radix default renders them smaller than any other text in the window, and
  // the Kbd inside the topbar trigger is its own element, not the button.
  r(['.palette-kbd', '.palette-trigger-kbd'], 'font-size: var(--dsh-ui-text-xs); background: transparent; box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong); color: var(--dsh-ui-muted);'),
  r(['.dsh-topbar .palette-trigger'], 'font-size: var(--dsh-ui-text-xs); background: transparent; color: var(--dsh-ui-muted); box-shadow: none;'),
  r(['.dsh-topbar .palette-trigger:hover'], 'background: var(--dsh-ui-hover); color: var(--dsh-ui-text);'),
  r(['.history-commit'], 'border-radius: var(--dsh-ui-radius-md);'),
  r(['.history-technical-details'], 'color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);'),
  r(['.history-technical-details > summary'], 'cursor: pointer; min-height: var(--dsh-ui-control-sm); padding-block: var(--dsh-ui-space-2);'),
  r(['.rt-AvatarRoot', '.rt-AvatarImage', '.rt-AvatarFallback'], 'border-radius: 50%; corner-shape: round;'),

  // Settings are a settings window, not a collection of differently themed cards.
  r(['.settings-nav'], `background: var(--dsh-ui-sidebar); border-right: ${hairline}; padding: var(--dsh-ui-space-5) var(--dsh-ui-space-3);`),
  r(['.settings-nav .settings-tab'], 'min-height: var(--dsh-ui-control-md); border-radius: var(--dsh-ui-radius-md); font-size: var(--dsh-ui-text-sm); color: var(--dsh-ui-text);'),
  r(['.settings-nav .settings-tab[data-state="active"]', '.settings-nav .settings-tab.active'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),
  r(['.settings-header'], `background: var(--dsh-ui-raised); border-bottom: ${hairline};`),
  r(['.settings-header-title', '.settings-nav h2'], 'font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.settings-block-title', '.settings-page h3'], 'font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-medium);'),
  r(['.settings-dialog .settings-row'], 'min-height: 56px; padding-block: var(--dsh-ui-space-3);'),
  r(['.settings-row-description'], 'font-size: var(--dsh-ui-text-sm); color: var(--dsh-ui-muted);'),
  r(['.settings-dialog .settings-block + .settings-block'], `border-top: ${hairline}; padding-top: var(--dsh-ui-space-5);`),
  r(['.settings-segmented'], 'background: var(--dsh-ui-sunken); border-radius: var(--dsh-ui-radius-lg); box-shadow: none;'),
  r(['.settings-segmented button[aria-pressed="true"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text); box-shadow: none;'),
  r(['.settings-content.is-active .settings-page'], 'animation: none;'),
  r(['.history-commit[aria-current="true"]', '.history-commit[aria-selected="true"]', '.history-commit[data-selected="true"]'], 'background: var(--dsh-ui-selected); color: var(--dsh-ui-text);'),

  // Shared scroll and activity grammar. No perpetual decorative shimmer.
  r(['.activity-dots.is-typing i'], 'animation-name: shell-activity-pulse;'),
  r(['.panel-skeleton i::after'], 'display: none;'),
  r(['.activity-shimmer'], 'height: 2px; background: var(--dsh-ui-line);'),
  r(['.dsh-launcher'], 'background: var(--dsh-ui-raised); border: 0; box-shadow: var(--dsh-ui-elevation-panel);'),
  r(['.shell ::-webkit-scrollbar'], 'width: 6px; height: 6px;'),
  r(['.shell ::-webkit-scrollbar-thumb'], 'background: var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-full); corner-shape: round;'),
  r(['.shell ::-webkit-scrollbar-thumb:hover'], 'background: var(--dsh-ui-muted);'),


  // Superellipse only where the engine supports it. Circles and pills stay round.
  `@supports (corner-shape: superellipse(1.5)) {\n${r([':where(:not([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))', ':where(:not([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))::before', ':where(:not([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))::after'], 'corner-shape: superellipse(1.5);')}${r(roundShapes, 'corner-shape: round;')}}`,
].join('\n')

export const responsiveStyles = `
@supports (container-type: inline-size) {
  ${r(['.editor-stack'], 'container-type: inline-size;')}
  ${r(['.editor'], '--paper-pad-inline: clamp(24px, 7cqi, 64px);')}
}
@media (max-width: 760px) {
  ${r(['.plugins-page-layout'], 'grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr);')}
  /* Narrow: the nav becomes a wrapping row of the three fixed pages and the
     search field, so the first plugin row stays near the top instead of below
     a 34dvh nav block. Nothing scrolls sideways here: every entry below has to
     stay reachable, so the nav is allowed to grow. */
  ${r(['.plugins-page-nav'], `flex-direction: row; flex-wrap: wrap; align-items: center; padding: var(--dsh-ui-space-3); max-height: none; overflow: visible; border-right: 0; border-bottom: ${hairline}; gap: var(--dsh-ui-space-2);`)}
  ${r(['.plugins-config-label'], 'position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap;')}
  ${r(['.plugins-page .plugins-page-nav > .plugins-page-link'], 'width: auto; flex: none;')}
  ${r(['.plugins-page-nav > .ui-input'], 'flex: 1 1 12rem; min-width: 0;')}
  /* At 390px the configuration entries used to run off the right edge of a
     nowrap scroller: the nav itself reported no overflow because the inner <ul>
     was the scroller, so 子智能体 and 知乎 were unreachable. Each entry now takes
     a full-width row, so the nav grows instead of clipping. */
  ${r(['.plugins-config-links'], 'flex: 1 1 100%; order: 3; flex-direction: row; flex-wrap: wrap; gap: var(--dsh-ui-space-1); min-width: 0;')}
  ${r(['.plugins-page .plugins-page-nav .plugins-config-links .plugins-page-link'], 'flex: 1 1 100%; width: 100%; white-space: normal; min-height: var(--dsh-ui-control-sm);')}
  ${r(['.plugins-page-content'], 'padding: var(--dsh-ui-space-3);')}
  /* Narrow header: the fixed control height cannot hold search + add + window
     controls on one line, so the drag row grows instead of dropping an action. */
  ${r(['.plugins-page'], 'grid-template-rows: auto minmax(0, 1fr);')}
  ${r(['.shell > .plugins-page-header'], 'height: auto; min-height: var(--dsh-ui-header-height); flex-wrap: wrap; row-gap: var(--dsh-ui-space-2); padding-block: var(--dsh-ui-space-2);')}
  ${r(['.plugins-page-search'], 'flex: 1 1 6rem;')}
  ${r(['.chat > .composer'], 'margin: var(--dsh-ui-space-2);')}
  ${r(['.editor-header'], 'gap: var(--dsh-ui-space-2); padding-inline: var(--dsh-ui-space-3); flex-wrap: wrap;')}
  ${r(['.editor-doc-title'], 'padding-inline-start: 0;')}
  ${r(['.settings-dialog'], 'grid-template-columns: 104px minmax(0, 1fr);')}
  ${r(['.settings-nav'], 'padding-inline: var(--dsh-ui-space-2);')}
  ${r(['.settings-content', '.settings-header'], 'padding: var(--dsh-ui-space-3);')}
}
@media (prefers-reduced-motion: reduce) {
  ${SCOPE} *, ${SCOPE} *::before, ${SCOPE} *::after { animation: none; animation-duration: 0s; transition: none; transition-duration: 0s; scroll-behavior: auto; }
}
@media (forced-colors: active) {
  ${r(['button:focus-visible', '[tabindex]:focus-visible'], 'outline: 2px solid Highlight;')}
  ${r(['.tree-row[aria-current="page"]', '.settings-tab[data-state="active"]'], 'outline: 1px solid Highlight; outline-offset: -1px;')}
  ${r(['.composer', '.proposal-card', '.rt-DialogContent'], 'border: 1px solid CanvasText;')}
}
`

/* 官方资源预览的槽位宿主规则在 app/shell/shell.styles.ts —— 宿主元素
   自带 data-dsh-plugin-surface，会被 uiRule 的插件排除跳过，不能用 r()。 */
export const officialResourceStyles = ``

export const designSystemStyles = `${tokenStyles}\n${componentStyles}\n${responsiveStyles}\n${officialResourceStyles}`
