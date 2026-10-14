import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findings } from './check-ui-drift.mjs'
import * as tokenModule from '../packages/dsh-editor-shell/src/design-system/tokens.ts'
import {
  LIGHT_TOKENS, DARK_TOKENS, DESIGN_SOURCE, DESIGN_SYSTEM_ID,
  FOUNDATION_TOKENS, SCOPE, SCOPE_DARK, tokenStyles,
} from '../packages/dsh-editor-shell/src/design-system/tokens.ts'
import { uiRule } from '../packages/dsh-editor-shell/src/design-system/styles.ts'
import { mountDesignScope } from '../packages/dsh-editor-shell/src/design-system/scope.ts'
import { collectStyles, defineStyles, LAYER_ORDER_STATEMENT, STYLE_LAYERS } from '../packages/dsh-editor-shell/src/design-system/layers.ts'
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

/* 6a-3 之后不再有单一组件样式串：断言跑在 collectStyles() 上。这里手动注册
   所有 sheet（定义即注册的 *.styles.ts 与 tokenStyles），与
   client/root.tsx 的注入次序一致。 */
const SHELL_SRC = fileURLToPath(new URL('../packages/dsh-editor-shell/src/', import.meta.url))
for (const dir of [
  'ui', 'client', 'client/ui', 'design-system',
  'app/shell', 'app/home', 'app/assistant', 'app/settings', 'app/files',
]) {
  for (const entry of readdirSync(join(SHELL_SRC, dir))) {
    if (entry.endsWith('.styles.ts')) await import(new URL(`../packages/dsh-editor-shell/src/${dir}/${entry}`, import.meta.url).href)
  }
}
defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
const collected = collectStyles()
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
  assert(!collected.includes('--dsh-ui-accent: var(--accent-9'))
  assert(!collected.includes('accent-swatch'))
})
check('tokens carry no gradients or blur', () => {
  for (const source of [LIGHT_TOKENS, DARK_TOKENS, FOUNDATION_TOKENS, DSW_MAP]) {
    for (const value of Object.values(source)) assert(!/gradient|blur\(/.test(value), value)
  }
})
check('all referenced design tokens are defined', () => {
  const defined = new Set([...collected.matchAll(/(--dsh-ui-[\w-]+)\s*:/g)].map(m => m[1]))
  for (const match of collected.matchAll(/var\((--dsh-ui-[\w-]+)/g)) assert(defined.has(match[1]), match[1])
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
  assert(collected.startsWith(LAYER_ORDER_STATEMENT))
  assert.equal(LAYER_ORDER_STATEMENT, '@layer dsh.reset, dsh.tokens, dsh.components, dsh.surfaces, dsh.state;')
  assert(!/@layer\s+(?!dsh\.)/.test(collected.replace(LAYER_ORDER_STATEMENT, '')))
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
check('official plugin --dsw-* inventory is current', () => {
  /* dsw-vars.ts 是 scan-dsw-vars.mjs 扫描官方插件发布产物生成的清单；
     --check 模式对当前 node_modules 复扫并与提交文件逐字比对，
     保证 DSW_MAP/DSW_PENDING 的分类断言始终基于最新使用面。 */
  const script = fileURLToPath(new URL('./scan-dsw-vars.mjs', import.meta.url))
  execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })
})
check('motion, forced-color and circle fallbacks are present', () => {
  assert(collected.includes('prefers-reduced-motion: reduce'))
  assert(collected.includes('forced-colors: active'))
  const supportsAt = collected.indexOf('@supports (corner-shape: superellipse(1.5))')
  assert(supportsAt >= 0)
  const supportsBlock = collected.slice(supportsAt)
  const superAt = supportsBlock.indexOf('corner-shape: superellipse(1.5)')
  const roundAt = supportsBlock.indexOf('corner-shape: round')
  assert(superAt >= 0 && roundAt > superAt)
  const superellipseTarget = 'html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes, [data-dsh-theme]) :where(*):not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *))'
  assert(supportsBlock.includes(superellipseTarget))
  assert(supportsBlock.includes(`${superellipseTarget}::before`))
  assert(supportsBlock.includes(`${superellipseTarget}::after`))
  const roundRule = supportsBlock.slice(superAt, roundAt)
  for (const selector of [
    '.models-credential-dot',
    '.activity-dots i',
    '.activity-shimmer:not(:where(', '.activity-shimmer i',
    '.history-commit-dot', '.image-preview-close',
    '.chat-step-status', '.chat-step-error-dot',
  ]) assert(roundRule.includes(selector), selector)
  assert(!roundRule.includes('.chat-step-dot'))
  assert(!roundRule.includes('.accent-swatch'))
})
check('menus are solid and no surface uses blur', () => {
  assert(!/https?:\/\/|!important/.test(collected))
  assert(!/blur\(/.test(collected))
  /* 遮罩声明只允许 none（旧 .rt-BaseDialogOverlay 约定的延续）。 */
  for (const m of collected.matchAll(/backdrop-filter:\s*([^;]+)/g)) assert.equal(m[1].trim(), 'none')
  /* 唯一的渐变是骨架屏扫光（装饰动画）；菜单/对话框等表面不许渐变。 */
  const gradients = collected.match(/[^{}]*\{[^}]*gradient[^}]*\}/g) ?? []
  assert.equal(gradients.length, 1)
  assert(gradients[0].includes('activity-skeleton__line'))
  assert(/menu-fill/.test(collected))
  assert.equal(LIGHT_TOKENS['menu-blur'], 'none')
  assert.equal(DARK_TOKENS['menu-blur'], 'none')
})
check('accent location selection and unchanged editor typography contract', () => {
  assert(collected.includes('background: var(--dsh-ui-selected)'))
  /* .cm-content 的排版只能来自作者设置（--paper-* 变量），不允许 sheet
     写死字号/字体/行高/行宽。 */
  for (const block of collected.matchAll(/\.cm-content\s*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/(font-size|font-family|line-height|max-width)\s*:\s*([^;]+)/g)) {
      assert(m[2].trim().startsWith('var(--paper-'), `.cm-content ${m[1]} must stay author-driven, got ${m[2].trim()}`)
    }
  }
  /* 内部 Button 的 primary 是唯一实色主题填充；disabled 走 hover 底 + muted 文，
     不再按 data-accent-color 分支。 */
  assert(collected.includes(".dsh-button[data-variant='primary'] { background: var(--dsh-ui-brand); color: var(--dsh-ui-on-brand); }"))
  assert(collected.includes('.dsh-button:disabled { background: var(--dsh-ui-hover); color: var(--dsh-ui-muted);'))
  assert(!collected.includes('rt-BaseButton'))
})
/* 产品源码边界：shell、manuscript 与私有面板。官方插件包和 seats/proofread
   的 standalone 兜底声明文件不在此列 —— 它们给没有本编辑器主题作用域的宿主
   提供字面量回退，是定义侧而不是消费侧。 */
const PRODUCT_STYLE_DIRS = [
  'packages/dsh-editor-shell/src',
  'packages/dsh-manuscript/src',
  'packages/dsh-editor-panel-base/src',
  'packages/dsh-editor-memory-panel/src',
  'packages/dsh-editor-overview-panel/src',
  'packages/dsh-editor-proofread-panel/src',
  'packages/dsh-editor-cards/src',
  'packages/dsh-editor-novel-kernel/src',
]
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
function collectProductSources() {
  const sources = []
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry)
      if (statSync(absolute).isDirectory()) {
        if (!/^(node_modules|__tests__|fixtures)$/.test(entry)) walk(absolute)
        continue
      }
      if (!/\.(ts|tsx|css)$/.test(entry)) continue
      if (/\.(spec|test)\.[^.]+$|\.d\.ts$/.test(entry)) continue
      sources.push(absolute)
    }
  }
  for (const dir of PRODUCT_STYLE_DIRS) walk(join(REPO_ROOT, dir))
  return sources
}

check('no Radix palette variables remain in product sources', () => {
  /* 6a-2：旧 Radix 调色板变量在产品源码里退役为 --dsh-ui-* 语义 token；
     6a-3 已把 tokens.ts 里的颜色桥也删掉（字号/间距度量别名仍保留，因为
     manuscript 挂件样式还在读）。seats/proofread 的 standalone 兜底链不在
     扫描范围（见 PRODUCT_STYLE_DIRS）。 */
  const palette = /--(?:accent|gray|red|green|amber|blue|iris|indigo|violet|teal|cyan|purple|plum|pink|crimson|tomato|ruby|orange|yellow|lime|mint|grass|sky|jade|brown|bronze|gold|slate|mauve|olive|sage|sand|color)-/
  for (const absolute of collectProductSources()) {
    const relative = absolute.slice(REPO_ROOT.length).split(sep).join('/')
    const hit = readFileSync(absolute, 'utf8').match(palette)
    assert(!hit, `${relative} still references Radix variable ${hit?.[0]}`)
  }
})
check('no @radix-ui/themes reference in any package source', () => {
  /* 包依赖在 6a-3 移除；这里先保证 src/ 里不再 import、resolve 或在注释里
     继续描述对它的依赖。 */
  const packages = join(REPO_ROOT, 'packages')
  const hits = []
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry)
      if (statSync(absolute).isDirectory()) {
        if (!/^(node_modules|lib|dist)$/.test(entry)) walk(absolute)
        continue
      }
      if (!/\.(ts|tsx|css|mts|cts)$/.test(entry)) continue
      if (readFileSync(absolute, 'utf8').includes('@radix-ui/themes')) hits.push(absolute.slice(REPO_ROOT.length).split(sep).join('/'))
    }
  }
  for (const entry of readdirSync(packages)) {
    const src = join(packages, entry, 'src')
    try { if (statSync(src).isDirectory()) walk(src) } catch { /* no src */ }
  }
  assert.deepEqual(hits, [])
})
check('no !important in product style sources beyond the listed exceptions', () => {
  /* !important 的绝对禁令（design-system-spec §5）：组件层不允许出现；增量
     drift 扫描只管改动文件，这里做全量兜底。下面列出的既有出现是唯一例外，
     只允许减少，不允许新增 —— 新增文件或新增条目都会失败。
     注释里的 !important 不计算（与 drift 扫描同一套注释剔除逻辑）。 */
  /* 6a-3 之后 shell 与 manuscript 的既有例外已全部归零，异常表留空 ——
     任何新增 !important 都会失败。 */
  const exceptions = new Map()
  for (const absolute of collectProductSources()) {
    const relative = absolute.slice(REPO_ROOT.length).split(sep).join('/')
    const found = findings(readFileSync(absolute, 'utf8')).filter(f => f.rule === 'cascade-override').length
    if (!found) continue
    const allowed = exceptions.get(relative)
    assert(allowed, `${relative}: !important ×${found} is not on the exception list`)
    assert(found <= allowed.max, `${relative}: !important grew to ${found} (allowed ${allowed.max}: ${allowed.reason})`)
  }
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
