/*
 * 样式分层（design-system-spec §4）：层顺序在注入的样式表开头声明一次，
 * 同一 id 只保留一份。迁移期旧样式整体进 legacy 层；新组件样式进
 * dsh.* 层后稳定优先；插件样式不进任何层，在自身作用域内天然优先。
 * 注意：层内 !important 反过来压过后面层的普通声明，迁移界面时先删掉
 * 影响该界面的旧 !important。
 */
export const STYLE_LAYERS = ['legacy', 'dsh.reset', 'dsh.tokens', 'dsh.components', 'dsh.surfaces', 'dsh.state'] as const
export type StyleLayer = (typeof STYLE_LAYERS)[number]

export const LAYER_ORDER_STATEMENT = `@layer ${STYLE_LAYERS.join(', ')};`

const entries = new Map<string, { layer: StyleLayer; css: string }>()

export function defineStyles(layer: StyleLayer, id: string, css: string): void {
  if (!entries.has(id)) entries.set(id, { layer, css: '' })
  entries.get(id)!.css = css
}

export function collectStyles(): string {
  const parts = [LAYER_ORDER_STATEMENT]
  for (const layer of STYLE_LAYERS) {
    const css = [...entries.values()].filter(entry => entry.layer === layer && entry.css)
      .map(entry => entry.css).join('\n')
    if (css) parts.push(`@layer ${layer} {\n${css}\n}`)
  }
  return `${parts.join('\n\n')}\n`
}
