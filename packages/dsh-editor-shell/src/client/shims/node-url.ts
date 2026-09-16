/*
 * 浏览器环境的 node:url 最小替身(vfile/minurl 用)。
 * fileURLToPath 只在 vfile 处理 file: 路径时调用;聊天渲染不触发,
 * 这里给语义上最保守的 file:// 剥离实现。
 */
export function fileURLToPath(url: string | URL): string {
  const text = typeof url === 'string' ? url : url.href
  return text.replace(/^file:\/\//, '')
}
