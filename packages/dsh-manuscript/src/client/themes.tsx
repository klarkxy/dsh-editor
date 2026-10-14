import { dshUiStandaloneAliases, scopedFallbackTokens } from 'dsh-editor-seats/tokens'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/*
 * 独立宿主（不在 .radix-themes 内）渲染自己的 .radix-themes 包装层，
 * 那份作用域让 seats 的 :root 兜底失效，所以由这里的打包样式在同一
 * 作用域上补齐：Radix 命名的字阶/色板字面量，加上把 --dsh-ui-* 直读
 * 桥到 --dsw-* 与这些字面量的别名表（editor-core 已改读 原稿 token）。
 */
const THEME_ATTR = 'data-dsh-manuscript-theme'
const THEME_SCOPE = `.radix-themes[${THEME_ATTR}]`
export const manuscriptStandaloneStyles = `${scopedFallbackTokens(THEME_SCOPE, `${THEME_SCOPE}.dark`)}
${THEME_SCOPE} {
${dshUiStandaloneAliases}}`

export function ensureManuscriptThemes(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-dsh-editor-shell-styles], style[data-dsh-manuscript-themes]')) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-manuscript')
  style.setAttribute('data-dsh-manuscript-themes', '')
  style.textContent = manuscriptStandaloneStyles
  document.head.appendChild(style)
}

export function manuscriptHostAppearance(doc: {
  documentElement: { getAttribute(name: string): string | null }
  body: { hasAttribute(name: string): boolean } | null
}): 'dark' | 'light' {
  if (doc.documentElement.getAttribute('data-theme') === 'dark') return 'dark'
  if (doc.body?.hasAttribute('data-ds-dark-theme')) return 'dark'
  return 'light'
}

function readManuscriptAppearance(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'light'
  return manuscriptHostAppearance(document)
}

export function ManuscriptTheme(props: { children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [needsTheme, setNeedsTheme] = useState(false)
  const [appearance, setAppearance] = useState<'dark' | 'light'>(readManuscriptAppearance)

  useLayoutEffect(() => {
    const node = hostRef.current
    if (!node) return
    const standalone = !node.closest('.radix-themes')
    setNeedsTheme(standalone)
    if (!standalone) return
    const sync = () => setAppearance(readManuscriptAppearance())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])

  const body = (
    <div ref={hostRef} style={{ display: 'contents' }}>
      {props.children}
    </div>
  )
  if (!needsTheme) return body
  /* 与旧 Radix <Theme> 渲染出的 DOM 结构相同；`.radix-themes` 仍是 tokens
     与 seats 兜底的作用域标记，`data-dsh-manuscript-theme` 锚定上面的
     standalone token 表。 */
  return (
    <div
      className={`radix-themes ${appearance} ${appearance}-theme`}
      {...{ [THEME_ATTR]: true }}
      style={{ display: 'contents' }}>
      {body}
    </div>
  )
}
