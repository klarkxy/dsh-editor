export function rewriteRadixThemesCss(css: string): string {
  const rewritten = css
    .replaceAll(':root, .light, .light-theme {', '.radix-themes, .light, .light-theme {')
    .replaceAll(':root {', '.radix-themes {')
  if ((css.includes(':root') && rewritten === css) || /:root\s*[{,]/.test(rewritten)) {
    console.error('[theme-root] Radix Themes CSS rewrite matched no `:root` selector; theme variables will not apply. The upstream styles.css format has likely changed.')
  }
  return rewritten
}
