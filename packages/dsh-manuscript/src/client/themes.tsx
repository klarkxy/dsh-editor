import { Theme } from '@radix-ui/themes'
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
  style.setAttribute('data-dsh-manuscript-themes', '')
  style.textContent = radixThemesStyles
  document.head.appendChild(style)
}

export function ManuscriptTheme(props: { children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [needsTheme, setNeedsTheme] = useState(false)

  useLayoutEffect(() => {
    const node = hostRef.current
    if (!node) return
    setNeedsTheme(!node.closest('.radix-themes'))
  }, [])

  const body = (
    <div ref={hostRef} style={{ display: 'contents' }}>
      {props.children}
    </div>
  )
  if (!needsTheme) return body
  const appearance = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
  return (
    <Theme
      appearance={appearance}
      grayColor="auto"
      radius="medium"
      scaling="100%"
      panelBackground="solid"
      style={{ display: 'contents' }}>
      {body}
    </Theme>
  )
}
