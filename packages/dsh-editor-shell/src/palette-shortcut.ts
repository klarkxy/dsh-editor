/*
 * 命令面板触发器上的可见快捷键：Windows/Linux 用 Ctrl+K，macOS 用 ⌘K。
 * 客户端 bundle 的 node:process 替身把 platform 写死成 linux，运行时用
 * navigator 判断；单测直接喂 win32/linux/darwin。
 */

export function paletteShortcutHint(platform: string): string {
  return platform === 'darwin' ? '⌘K' : 'Ctrl+K'
}

export function detectShortcutPlatform(input: {
  processPlatform?: string
  navigatorPlatform?: string
  userAgent?: string
} = {}): string {
  const processPlatform = input.processPlatform
  if (processPlatform === 'darwin' || processPlatform === 'win32' || processPlatform === 'linux') {
    return processPlatform
  }
  const nav = `${input.navigatorPlatform ?? ''} ${input.userAgent ?? ''}`
  if (/mac/i.test(nav)) return 'darwin'
  if (/win/i.test(nav)) return 'win32'
  return 'linux'
}

export function runtimePaletteShortcutHint(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return paletteShortcutHint(detectShortcutPlatform({
    navigatorPlatform: nav?.platform,
    userAgent: nav?.userAgent,
  }))
}
