import radixThemesCss from '@radix-ui/themes/styles.css'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function rewriteRadixThemesCss(css: string): string {
  return css
    .replaceAll(':root, .light, .light-theme {', '.radix-themes, .light, .light-theme {')
    .replaceAll(':root {', '.radix-themes {')
}

export const radixThemesStyles = rewriteRadixThemesCss(radixThemesCss)

export function ensureManuscriptThemes(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-dsh-editor-shell-styles], style[data-dsh-manuscript-themes]')) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-manuscript')
  style.setAttribute('data-dsh-manuscript-themes', '')
  style.textContent = radixThemesStyles
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
  /* 与 Radix <Theme> 渲染出的 DOM 相同：注入表里的 accent/gray 变量与
     .rt- 选择器以它为作用域，直到 6a 的变量退役完成。 */
  return (
    <div
      className={`radix-themes ${appearance} ${appearance}-theme`}
      data-is-root-theme="true"
      data-accent-color="indigo"
      data-gray-color="auto"
      data-has-background="true"
      data-panel-background="solid"
      data-radius="medium"
      data-scaling="100%"
      style={{ display: 'contents' }}>
      {body}
    </div>
  )
}
