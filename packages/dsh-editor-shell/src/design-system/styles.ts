/**
 * 原稿视觉适配助手：uiRule() 把产品外观规则限定到主题作用域并排除插件面
 *（[data-dsh-plugin-surface] 及其后代——插件拥有自己的内部布局与变体）。
 * 具体规则已迁入所属 sheet（app 与 client、src/ui 下的 .styles.ts 文件，
 * 进 dsh.* 层）。上游归属声明：
 * resources/third-party/deepseek-harness-MIT.txt；
 * 早期 Kimi Web 声明在 resources/third-party/kimi-web-MIT.txt。
 */
import { SCOPE } from './tokens.ts'

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
