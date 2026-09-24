import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LIGHT_TOKENS, DARK_TOKENS, DEFAULT_SHELL_ACCENT, DESIGN_SOURCE } from '../packages/dsh-editor-shell/src/design-system/tokens.ts'
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
  assert.equal(DESIGN_SOURCE.repository, 'MoonshotAI/kimi-code')
  assert.equal(DESIGN_SOURCE.revision, 'e7d5a0aee74e7f116cca0273c416ece9139a78a0')
})
check('light/dark token parity', () => assert.deepEqual(Object.keys(DARK_TOKENS).sort(), Object.keys(LIGHT_TOKENS).sort()))
check('new-user accent is blue', () => assert.equal(DEFAULT_SHELL_ACCENT, 'blue'))
check('all referenced design tokens are defined', () => {
  const defined = new Set([...designSystemStyles.matchAll(/(--dsh-ui-[\w-]+)\s*:/g)].map(m => m[1]))
  for (const match of designSystemStyles.matchAll(/var\((--dsh-ui-[\w-]+)/g)) assert(defined.has(match[1]), match[1])
})
check('body, secondary text and small primary labels meet 4.5:1', () => {
  for (const tokens of [LIGHT_TOKENS, DARK_TOKENS]) {
    for (const surface of ['bg', 'surface', 'raised', 'sidebar']) {
      for (const role of ['text', 'muted']) assert(contrast(tokens[role], tokens[surface]) >= 4.5, `${role}/${surface}`)
    }
    assert(contrast(tokens['on-accent'], tokens['accent-solid']) >= 4.5)
  }
})
check('component rules stay out of plugin surfaces', () => {
  assert(uiRule(['button'], 'color: inherit').includes(':not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))'))
  assert(uiRule(['.tree-row::before'], 'display: none').includes('*))::before'))
})
check('unmount restores the previous host scope', () => {
  const root = host('original'); const dispose = mountDesignScope(root)
  assert.equal(root.getAttribute('data-dsh-ui'), 'kimi-web'); dispose(); dispose()
  assert.equal(root.getAttribute('data-dsh-ui'), 'original')
})
check('nested roots and StrictMode do not leak or remove a live scope', () => {
  const root = host(); const one = mountDesignScope(root); const two = mountDesignScope(root)
  one(); assert.equal(root.getAttribute('data-dsh-ui'), 'kimi-web'); two()
  assert.equal(root.getAttribute('data-dsh-ui'), null)
  const three = mountDesignScope(root); three(); assert.equal(root.getAttribute('data-dsh-ui'), null)
})
check('cleanup never overwrites another host change', () => {
  const root = host(); const dispose = mountDesignScope(root)
  root.setAttribute('data-dsh-ui', 'another-host'); dispose()
  assert.equal(root.getAttribute('data-dsh-ui'), 'another-host')
})
check('motion and forced-color fallbacks are present', () => {
  assert(designSystemStyles.includes('prefers-reduced-motion: reduce'))
  assert(designSystemStyles.includes('forced-colors: active'))
})
check('no new gradients, blur, remote assets or important overrides outside accessibility', () => {
  assert(!/(?:linear|radial)-gradient|backdrop-filter|https?:\/\/|!important/.test(componentStyles))
})
check('neutral location selection and unchanged editor typography contract', () => {
  assert(componentStyles.includes('background: var(--dsh-ui-selected)'))
  assert(!/\.cm-content[^}]*?(?:font-size|font-family|line-height|max-width)/s.test(componentStyles))
})
check('upstream notice is shipped with the shell resources', () => {
  const notice = readFileSync(new URL('../packages/dsh-editor-shell/resources/third-party/kimi-web-MIT.txt', import.meta.url), 'utf8')
  assert(notice.includes('Copyright (c) 2026 Moonshot AI'))
  assert(notice.includes('Permission is hereby granted'))
})
console.log(`UI design checks: ${passed} passed`)
