/*
 * 浏览器环境的 node:process 最小替身。react-markdown 依赖链
 * (unified → vfile/minproc) 在模块加载期就会 require node:process,
 * DSH 插件运行时的模块表不提供它;这里给一个惰性替身,
 * 仅覆盖 vfile 在构建期读到的 cwd/env 形状,不承载真实语义。
 */
const processShim = {
  env: {} as Record<string, string | undefined>,
  argv: [] as string[],
  platform: 'linux',
  version: '',
  versions: {} as Record<string, string>,
  cwd(): string {
    return '/'
  },
}

export default processShim
