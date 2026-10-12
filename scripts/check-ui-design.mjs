import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as tokenModule from '../packages/dsh-editor-shell/src/design-system/tokens.ts'
import {
  LIGHT_TOKENS, DARK_TOKENS, DESIGN_SOURCE, DESIGN_SYSTEM_ID,
  FOUNDATION_TOKENS, SCOPE, SCOPE_DARK,
} from '../packages/dsh-editor-shell/src/design-system/tokens.ts'
import { componentStyles, designSystemStyles, uiRule } from '../packages/dsh-editor-shell/src/design-system/styles.ts'
import { mountDesignScope } from '../packages/dsh-editor-shell/src/design-system/scope.ts'
import { collectStyles, LAYER_ORDER_STATEMENT, STYLE_LAYERS } from '../packages/dsh-editor-shell/src/design-system/layers.ts'
import { DSW_VARS } from '../packages/dsh-editor-shell/src/design-system/dsw-vars.ts'
import { DSW_MAP, DSW_PENDING } from '../packages/dsh-editor-shell/src/design-system/compat.ts'

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
/** Composite an rgba() over a solid hex background. */
function blend(value, background) {
  const rgba = value.match(/rgba?\(([^)]+)\)/)
  if (!rgba) return value
  const [r, g, b, a = 1] = rgba[1].split(',').map(Number)
  const back = background.slice(1).match(/../g).map(x => parseInt(x, 16))
  return '#' + [r, g, b].map((channel, i) => Math.round(channel * a + back[i] * (1 - a)).toString(16).padStart(2, '0')).join('')
}

check('own 原稿 design system pinned to the spec values', () => {
  assert.equal(DESIGN_SYSTEM_ID, 'dsh-yuangao')
  assert.equal(DESIGN_SOURCE.repository, 'dsh-editor')
  assert.equal(DESIGN_SOURCE.tag, 'dsh-yuangao')
  assert.equal(SCOPE, 'html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes, [data-dsh-theme])')
  assert.equal(SCOPE_DARK, 'html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes.dark, [data-dsh-theme="dark"])')
  assert.equal(LIGHT_TOKENS.chrome, '#E8EBE6')
  assert.equal(LIGHT_TOKENS.bg, '#F7F8F4')
  assert.equal(LIGHT_TOKENS.paper, '#F7F8F4')
  assert.equal(LIGHT_TOKENS.raised, '#FFFFFF')
  assert.equal(LIGHT_TOKENS.brand, '#2E4F7A')
  assert.equal(LIGHT_TOKENS['on-brand'], '#FFFFFF')
  assert.equal(LIGHT_TOKENS.marker, '#B23A2A')
  assert.equal(LIGHT_TOKENS['margin-rule'], 'rgba(178, 58, 42, 0.35)')
  assert.equal(DARK_TOKENS.chrome, '#151816')
  assert.equal(DARK_TOKENS.bg, '#1C201D')
  assert.equal(DARK_TOKENS.raised, '#252A26')
  assert.equal(DARK_TOKENS.brand, '#8FB0DE')
  assert.equal(DARK_TOKENS['on-brand'], '#14181B')
  assert.equal(DARK_TOKENS.marker, '#E07A68')
  assert.equal(FOUNDATION_TOKENS['radius-sm'], '6px')
  assert.equal(FOUNDATION_TOKENS['radius-md'], '8px')
  assert.equal(FOUNDATION_TOKENS['radius-panel'], '20px')
  assert.equal(FOUNDATION_TOKENS['font-display'], '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif')
  assert.equal(FOUNDATION_TOKENS['text-display'], '22px')
  assert.equal(FOUNDATION_TOKENS['dim-opacity'], '0.55')
  assert.equal(FOUNDATION_TOKENS['z-rail-overlay'], '40')
  assert.equal(FOUNDATION_TOKENS['z-dropdown'], '50')
  assert.equal(FOUNDATION_TOKENS['z-dialog'], '60')
})
check('light/dark token parity', () => assert.deepEqual(Object.keys(DARK_TOKENS).sort(), Object.keys(LIGHT_TOKENS).sort()))
check('no accent system remains', () => {
  for (const name of ['SHELL_ACCENTS', 'ACCENT_SOLIDS', 'DEFAULT_SHELL_ACCENT']) {
    assert(!(name in tokenModule), `${name} export must be gone`)
  }
  // Radix's own data-accent-color attr stays for explicit component colours;
  // the saved-accent override rules and the picker swatch are gone.
  assert(!designSystemStyles.includes('--dsh-ui-accent: var(--accent-9'))
  assert(!designSystemStyles.includes('accent-swatch'))
})
check('tokens carry no gradients or blur', () => {
  for (const source of [LIGHT_TOKENS, DARK_TOKENS, FOUNDATION_TOKENS, DSW_MAP]) {
    for (const value of Object.values(source)) assert(!/gradient|blur\(/.test(value), value)
  }
})
check('all referenced design tokens are defined', () => {
  const defined = new Set([...designSystemStyles.matchAll(/(--dsh-ui-[\w-]+)\s*:/g)].map(m => m[1]))
  for (const match of designSystemStyles.matchAll(/var\((--dsh-ui-[\w-]+)/g)) assert(defined.has(match[1]), match[1])
})
check('spec contrast pairs clear 4.5:1 in both modes', () => {
  for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
    for (const [foreground, surface] of [
      ['text', 'bg'], ['text', 'chrome'], ['text', 'raised'],
      ['muted', 'bg'], ['muted', 'chrome'], ['muted', 'raised'],
      ['on-brand', 'brand'], ['link', 'bg'], ['link', 'raised'],
      ['danger', 'bg'], ['success', 'bg'], ['warning', 'bg'],
    ]) {
      assert(contrast(tokens[foreground], tokens[surface]) >= 4.5, `${foreground}/${surface} ${contrast(tokens[foreground], tokens[surface])}`)
    }
  }
})
check('status text stays readable on its soft background', () => {
  for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
    for (const [foreground, surface] of [
      ['success', 'success-soft'], ['warning', 'warning-soft'], ['danger', 'danger-soft'],
      ['accent', 'raised'],
    ]) {
      const background = blend(tokens[surface], tokens.bg)
      assert(contrast(tokens[foreground], background) >= 4.5, `${foreground}/${surface} ${contrast(tokens[foreground], background)}`)
    }
  }
})
check('component rules stay out of plugin surfaces', () => {
  assert(uiRule(['button'], 'color: inherit').includes(':not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))'))
  assert(uiRule(['.tree-row::before'], 'display: none').includes('*))::before'))
})
check('unmount restores the previous host scope', () => {
  const root = host('original'); const dispose = mountDesignScope(root)
  assert.equal(root.getAttribute('data-dsh-ui'), 'dsh-yuangao'); dispose(); dispose()
  assert.equal(root.getAttribute('data-dsh-ui'), 'original')
})
check('nested roots and StrictMode do not leak or remove a live scope', () => {
  const root = host(); const one = mountDesignScope(root); const two = mountDesignScope(root)
  one(); assert.equal(root.getAttribute('data-dsh-ui'), 'dsh-yuangao'); two()
  assert.equal(root.getAttribute('data-dsh-ui'), null)
  const three = mountDesignScope(root); three(); assert.equal(root.getAttribute('data-dsh-ui'), null)
})
check('cleanup never overwrites another host change', () => {
  const root = host(); const dispose = mountDesignScope(root)
  root.setAttribute('data-dsh-ui', 'another-host'); dispose()
  assert.equal(root.getAttribute('data-dsh-ui'), 'another-host')
})
check('layer order is declared once at the head of the collected sheet', () => {
  const collected = collectStyles()
  assert(collected.startsWith(LAYER_ORDER_STATEMENT))
  assert.equal(LAYER_ORDER_STATEMENT, '@layer legacy, dsh.reset, dsh.tokens, dsh.components, dsh.surfaces, dsh.state;')
  assert(!/@layer\s+(?!legacy\b|dsh\.)/.test(collected.replace(LAYER_ORDER_STATEMENT, '')))
  let position = -1
  for (const layer of STYLE_LAYERS) {
    const at = collected.indexOf(`@layer ${layer} {`)
    if (at >= 0) { assert(at > position, `${layer} out of order`); position = at }
  }
})
check('DSW_MAP covers every scanned var or names it pending', () => {
  const mapped = new Set(Object.keys(DSW_MAP))
  const pending = new Set(DSW_PENDING)
  for (const name of DSW_VARS) assert(mapped.has(name) || pending.has(name), `unclassified dsw var ${name}`)
  for (const name of pending) assert(!mapped.has(name), `${name} is both mapped and pending`)
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
    '.models-credential-dot', '.preset-badge', '.cards-badge',
    '.activity-dots i', '.panel-activity-dots i',
    '.activity-shimmer:not(:where(', '.activity-shimmer i',
    '.assistant-launcher:not(.capability-note)',
    '.history-commit-dot', '.image-preview-close',
    '.chat-step-status', '.chat-step-error-dot',
  ]) assert(roundRule.includes(selector), selector)
  assert(!roundRule.includes('.chat-step-dot'))
  assert(!roundRule.includes('.accent-swatch'))
})
check('menus are solid and no surface uses blur', () => {
  assert(!/(?:linear|radial)-gradient|https?:\/\/|!important/.test(componentStyles))
  assert(!/blur\(/.test(componentStyles))
  assert(/menu-fill/.test(componentStyles))
  assert.equal(LIGHT_TOKENS['menu-blur'], 'none')
  assert.equal(DARK_TOKENS['menu-blur'], 'none')
  const overlayBlock = componentStyles.split(/}\n/).find(block => /\.rt-BaseDialogOverlay/.test(block) && /backdrop-filter/.test(block))
  assert(overlayBlock && /backdrop-filter:\s*none/.test(overlayBlock))
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
