/*
 * 样式分层（design-system-spec §4）：层顺序在注入的样式表开头声明一次，
 * 同一 id 只保留一份。全部产品样式进 dsh.* 层；插件样式不进任何层，
 * 在自身作用域内天然优先。dsh.state 是最后一层：原本靠 !important 的
 * hidden/降级规则用层序表达。
 */
export const STYLE_LAYERS = ['dsh.reset', 'dsh.tokens', 'dsh.components', 'dsh.surfaces', 'dsh.state'] as const
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
