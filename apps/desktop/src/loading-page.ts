/** 启动加载页:React 挂载前的纯内联 CSS。看板娘以内嵌 data: webp 放入，
 * 避免 data: 页面读不到 asar 里的文件。微光行改写自 Amicro
 * (MIT License, Copyright (c) 2026 Syed Subhan Uddin) 的 shimmer-line。
 * CSP 为 default-src 'none'; style-src 'unsafe-inline'; img-src data:。
 * reduced-motion 停掉循环，保留静态微光段。 */

export function loadingPageHtml(input: {
  firstLaunch: boolean
  mascotBytes: Uint8Array
}): string {
  const message = input.firstLaunch
    ? '首次启动正在复制本地写作环境，可能需要一分钟…'
    : '正在启动本地写作环境…'
  const mascotSrc = `data:image/webp;base64,${Buffer.from(input.mascotBytes).toString('base64')}`
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>DSH Editor</title><style>body{font-family:system-ui;display:grid;place-content:center;height:100vh;margin:0;background:#faf9f5;color:#393832;-webkit-app-region:drag}main{display:grid;justify-items:center;gap:18px;text-align:center}h1{margin:0;font-size:22px}p{margin:0;color:#77746c;max-width:22rem}.mascot{width:min(260px,48vw);height:auto;display:block;user-select:none;pointer-events:none}.shimmer{position:relative;width:96px;height:3px;border-radius:999px;background:rgba(20,20,19,.12);overflow:hidden}.shimmer i{position:absolute;top:0;bottom:0;left:0;width:33%;border-radius:inherit;background:#1b365d;opacity:.5;animation:shimmer-sweep 1.5s ease-in-out infinite}@keyframes shimmer-sweep{from{transform:translateX(-100%)}to{transform:translateX(300%)}}@media (prefers-reduced-motion:reduce){.shimmer i{animation:none}}</style><main><img class="mascot" src="${mascotSrc}" alt="" width="260" height="347" decoding="async" draggable="false" aria-hidden="true"><h1>DSH Editor</h1><p>${message}</p><span class="shimmer" aria-hidden="true"><i></i></span></main>`
}

export function loadingPageDataUrl(input: {
  firstLaunch: boolean
  mascotBytes: Uint8Array
}): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(loadingPageHtml(input))}`
}
