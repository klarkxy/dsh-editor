/*
 * 浏览器环境的 node:path 最小替身(vfile/minpath 用)。
 * 只实现 vfile 在路径字符串处理里用到的 POSIX 形态函数;
 * 聊天渲染从不传入文件路径,这些函数主要是存在性兜底。
 */

function basename(path: string, suffix?: string): string {
  const clean = path.replace(/\/+$/, '')
  const name = clean.slice(clean.lastIndexOf('/') + 1)
  return suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

function dirname(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const at = clean.lastIndexOf('/')
  if (at < 0) return '.'
  return at === 0 ? '/' : clean.slice(0, at)
}

function extname(path: string): string {
  const name = basename(path)
  const at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at) : ''
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/')
}

function resolve(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/')
  return joined.startsWith('/') ? joined : `/${joined}`
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

const pathShim = {
  sep: '/',
  delimiter: ':',
  basename,
  dirname,
  extname,
  join,
  resolve,
  isAbsolute,
}

export default pathShim
