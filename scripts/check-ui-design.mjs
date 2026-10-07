import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LIGHT_TOKENS, DARK_TOKENS, DEFAULT_SHELL_ACCENT, DESIGN_SOURCE, DESIGN_SYSTEM_ID,
  FOUNDATION_TOKENS, SHELL_ACCENTS, ACCENT_SOLIDS, SCOPE,
} from '../packages/dsh-editor-shell/src/design-system/tokens.ts'
import { componentStyles, designSystemStyles, uiRule } from '../packages/dsh-editor-shell/src/design-system/styles.ts'
import { mountDesignScope } from '../packages/dsh-editor-shell/src/design-system/scope.ts'

let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }
function host(initial) {
  const values = new Map(initial === undefined ? [] : [['data-dsh-ui', initial]])
  return {
    getAttribute: name => values.get(name) ?? null,
    setAttribute: (name, value) => values.set(name, value),
    removeAttribute: name => values.delete(name),
  }
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
check('pinned official source, not third-party desktop', () => {
  assert.equal(DESIGN_SYSTEM_ID, 'dsh-official')
  assert.equal(DESIGN_SOURCE.repository, 'deepseek-ai/deepseek-harness')
  assert.equal(DESIGN_SOURCE.revision, '639ed015397290b3745d163aafe02ffee4aa3f84')
  assert.equal(DESIGN_SOURCE.tag, 'dsh-v0.2.0-rc.2')
  assert.deepEqual(FOUNDATION_TOKENS['radius-xs'], '4px')
  assert.equal(FOUNDATION_TOKENS['radius-sm'], '8px')
  assert.equal(FOUNDATION_TOKENS['radius-md'], '12px')
  assert.equal(FOUNDATION_TOKENS['radius-lg'], '16px')
  assert.equal(FOUNDATION_TOKENS['radius-xl'], '20px')
  assert.equal(FOUNDATION_TOKENS['radius-panel'], '28px')
  assert.equal(LIGHT_TOKENS.bg, '#f7f7f8')
  assert.equal(LIGHT_TOKENS.surface, '#eff0f2')
  assert.equal(LIGHT_TOKENS.raised, '#ffffff')
  assert.equal(LIGHT_TOKENS.sidebar, '#f0f1f3')
  assert.equal(LIGHT_TOKENS.sunken, '#e8e9ec')
  assert.equal(LIGHT_TOKENS.selected, '#dde1e6')
  assert.equal(LIGHT_TOKENS.hover, '#e6e8eb')
  assert.equal(LIGHT_TOKENS.text, '#1a1c1f')
  assert.equal(LIGHT_TOKENS.muted, '#5c6166')
  assert.equal(LIGHT_TOKENS.accent, '#4176e6')
  assert.equal(LIGHT_TOKENS.link, '#4868b2')
  assert.equal(LIGHT_TOKENS.brand, ACCENT_SOLIDS.blue.light.fill)
  assert.equal(LIGHT_TOKENS['on-brand'], ACCENT_SOLIDS.blue.light.on)
  assert.equal(DARK_TOKENS.bg, '#151517')
  assert.equal(DARK_TOKENS.surface, '#1e1e20')
  assert.equal(DARK_TOKENS.raised, '#2a2a2c')
  assert.equal(DARK_TOKENS.sunken, '#0f0f11')
  assert.equal(DARK_TOKENS.selected, '#33353a')
  assert.equal(DARK_TOKENS.hover, 'rgba(255, 255, 255, 0.12)')
  assert.equal(DARK_TOKENS.sidebar, '#1a1a1c')
  assert.equal(DARK_TOKENS.text, '#f9fafb')
  assert.equal(DARK_TOKENS.muted, '#adb2b8')
  assert.equal(DARK_TOKENS.accent, '#7aaaff')
  assert.equal(DARK_TOKENS.link, '#7aaaff')
  assert.equal(DARK_TOKENS.brand, ACCENT_SOLIDS.blue.dark.fill)
  assert.equal(DARK_TOKENS['on-brand'], ACCENT_SOLIDS.blue.dark.on)
})
check('light/dark token parity', () => assert.deepEqual(Object.keys(DARK_TOKENS).sort(), Object.keys(LIGHT_TOKENS).sort()))
check('a new user gets blue and every saved accent reaches the primary action', () => {
  assert.equal(DEFAULT_SHELL_ACCENT, 'blue')
  assert(SHELL_ACCENTS.includes(DEFAULT_SHELL_ACCENT))
  for (const name of ['accent', 'accent-hover', 'accent-solid', 'accent-soft', 'accent-border', 'on-accent', 'link']) {
    assert(designSystemStyles.includes(`--dsh-ui-${name}: var(--accent-`))
  }
  // The current location and the user bubble follow the accent as well. Without
  // them a saved accent only shows up in links and never reads as the theme.
  for (const name of ['selected', 'bubble']) {
    assert(designSystemStyles.includes(`--dsh-ui-${name}: var(--accent-`), name)
  }
  for (const accent of SHELL_ACCENTS) {
    const { light, dark } = ACCENT_SOLIDS[accent]
    assert(designSystemStyles.includes(`${SCOPE}[data-accent-color="${accent}"] { --dsh-ui-brand: ${light.fill}; --dsh-ui-brand-hover: ${light.hover}; --dsh-ui-on-brand: ${light.on}; }`), `${accent} light`)
    assert(designSystemStyles.includes(`${SCOPE}.dark[data-accent-color="${accent}"] { --dsh-ui-brand: ${dark.fill}; --dsh-ui-brand-hover: ${dark.hover}; --dsh-ui-on-brand: ${dark.on}; }`), `${accent} dark`)
  }
})
check('every saved accent keeps a readable primary fill in both modes', () => {
  for (const accent of SHELL_ACCENTS) {
    for (const [mode, tokens] of Object.entries(ACCENT_SOLIDS[accent])) {
      assert(contrast(tokens.on, tokens.fill) >= 4.5, `${accent}/${mode} fill ${contrast(tokens.on, tokens.fill)}`)
      assert(contrast(tokens.on, tokens.hover) >= 4.5, `${accent}/${mode} hover ${contrast(tokens.on, tokens.hover)}`)
      // A label must not be the fill colour, or the button reads as empty.
      assert(tokens.on.toLowerCase() !== tokens.fill.toLowerCase(), `${accent}/${mode}`)
    }
  }
})
check('all referenced design tokens are defined', () => {
  const defined = new Set([...designSystemStyles.matchAll(/(--dsh-ui-[\w-]+)\s*:/g)].map(m => m[1]))
  for (const match of designSystemStyles.matchAll(/var\((--dsh-ui-[\w-]+)/g)) assert(defined.has(match[1]), match[1])
})
check('body, secondary text and small primary labels meet 4.5:1', () => {
  for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
    for (const surface of ['bg', 'surface', 'raised', 'sidebar']) {
      for (const role of ['text', 'muted', 'link']) assert(contrast(tokens[role], tokens[surface]) >= 4.5, `${role}/${surface} ${contrast(tokens[role], tokens[surface])}`)
    }
    assert(contrast(tokens['on-accent'], tokens['accent-solid']) >= 4.5)
    assert(contrast(tokens['on-brand'], tokens.brand) >= 4.5)
  }
})
check('component rules stay out of plugin surfaces', () => {
  assert(uiRule(['button'], 'color: inherit').includes(':not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))'))
  assert(uiRule(['.tree-row::before'], 'display: none').includes('*))::before'))
})
check('unmount restores the previous host scope', () => {
  const root = host('original'); const dispose = mountDesignScope(root)
  assert.equal(root.getAttribute('data-dsh-ui'), 'dsh-official'); dispose(); dispose()
  assert.equal(root.getAttribute('data-dsh-ui'), 'original')
})
check('nested roots and StrictMode do not leak or remove a live scope', () => {
  const root = host(); const one = mountDesignScope(root); const two = mountDesignScope(root)
  one(); assert.equal(root.getAttribute('data-dsh-ui'), 'dsh-official'); two()
  assert.equal(root.getAttribute('data-dsh-ui'), null)
  const three = mountDesignScope(root); three(); assert.equal(root.getAttribute('data-dsh-ui'), null)
})
check('cleanup never overwrites another host change', () => {
  const root = host(); const dispose = mountDesignScope(root)
  root.setAttribute('data-dsh-ui', 'another-host'); dispose()
  assert.equal(root.getAttribute('data-dsh-ui'), 'another-host')
})
check('motion, forced-color and circle fallbacks are present', () => {
  assert(designSystemStyles.includes('prefers-reduced-motion: reduce'))
  assert(designSystemStyles.includes('forced-colors: active'))
  const supportsAt = componentStyles.indexOf('@supports (corner-shape: superellipse(1.5))')
  assert(supportsAt >= 0)
  const supportsBlock = componentStyles.slice(supportsAt)
  const superAt = supportsBlock.indexOf('corner-shape: superellipse(1.5)')
  const roundAt = supportsBlock.indexOf('corner-shape: round')
  assert(superAt >= 0 && roundAt > superAt)
  const superellipseTarget = ':where(:not([data-dsh-plugin-surface], [data-dsh-plugin-surface] *)):not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))'
  assert(supportsBlock.includes(superellipseTarget))
  assert(supportsBlock.includes(`${superellipseTarget}::before`))
  assert(supportsBlock.includes(`${superellipseTarget}::after`))
  const roundRule = supportsBlock.slice(superAt, roundAt)
  for (const selector of [
    '.composer-actions .send', '.composer-actions .chat-stop', 'button.send', 'button.chat-stop',
    '::-webkit-scrollbar-thumb',
    '.rt-AvatarRoot', '.rt-AvatarImage', '.rt-AvatarFallback',
    '.accent-swatch', '.models-credential-dot', '.preset-badge', '.cards-badge',
    '.activity-dots i', '.panel-activity-dots i',
    '.activity-shimmer:not(:where(', '.activity-shimmer i',
    '.assistant-launcher:not(.capability-note)',
    '.history-commit-dot', '.image-preview-close',
    '.chat-step-status', '.chat-step-error-dot',
  ]) assert(roundRule.includes(selector), selector)
  assert(!roundRule.includes('.chat-step-dot'))
  assert(!roundRule.includes('.assistant-launcher:not(:where'))
  assert(!roundRule.includes('.assistant-launcher.capability-note'))
})
check('menu material is the only blur; modal masks stay sharp', () => {
  assert(!/(?:linear|radial)-gradient|https?:\/\/|!important/.test(componentStyles))
  let blurred = 0
  for (const block of componentStyles.split(/}\n/)) {
    if (!/backdrop-filter/.test(block)) continue
    const usesMenuBlur = /backdrop-filter:\s*var\(--dsh-ui-menu-blur\)/.test(block)
    const clearsBlur = /backdrop-filter:\s*none/.test(block)
    assert(usesMenuBlur !== clearsBlur, block.slice(0, 180))
    if (usesMenuBlur) {
      blurred += 1
      assert(/rt-(?:DropdownMenuContent|ContextMenuContent|SelectContent|BaseMenuContent)/.test(block))
      assert(!/Dialog|composer|\.rt-Card|Overlay|palette/.test(block))
    } else {
      assert(/Overlay|composer|\.rt-Card|palette|dismiss/.test(block))
    }
  }
  assert.equal(blurred, 1)
  assert(componentStyles.split(/}\n/).some(block => /\.rt-BaseDialogOverlay/.test(block) && /backdrop-filter:\s*none/.test(block)))
})
check('accent location selection and unchanged editor typography contract', () => {
  assert(componentStyles.includes('background: var(--dsh-ui-selected)'))
  assert(!/\.cm-content[^}]*?(?:font-size|font-family|line-height|max-width)/s.test(componentStyles))
  const implicit = 'button.rt-BaseButton.rt-variant-solid:is(:not([data-accent-color]), [data-accent-color=""]):not(.send):not(.chat-stop)'
  assert(componentStyles.includes(implicit + ':not(:disabled):not([data-disabled])'))
  assert(componentStyles.includes(implicit + ':disabled'))
  assert(componentStyles.includes(implicit + '[data-disabled]'))
  assert(!componentStyles.includes('button.rt-BaseButton.rt-variant-solid:not([data-accent-color])'))
  assert(!componentStyles.includes('button.rt-BaseButton.rt-variant-solid:not(.send)'))
})
check('upstream notice is shipped with the shell resources', () => {
  const previous = readFileSync(new URL('../packages/dsh-editor-shell/resources/third-party/kimi-web-MIT.txt', import.meta.url), 'utf8')
  assert(previous.includes('Copyright (c) 2026 Moonshot AI'))
  assert(previous.includes('Permission is hereby granted'))
  const official = readFileSync(new URL('../packages/dsh-editor-shell/resources/third-party/deepseek-harness-MIT.txt', import.meta.url), 'utf8')
  assert(official.includes('Copyright (c) 2026 DeepSeek'))
  assert(official.includes('Permission is hereby granted'))
})
console.log(`UI design checks: ${passed} passed`)
