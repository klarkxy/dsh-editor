import { createContext, useContext } from 'react'

/*
 * §3：portal 容器由 UiRoot 内联提供。DSH 官方 token 写在 body 内联样式上，
 * 直接挂 body 的 portal 拿不到 shell 的 --dsh-ui-* 与覆盖后的 --dsw-*。
 */
export const DshPortalContext = createContext<HTMLElement | null>(null)

export function useDshPortalContainer(): HTMLElement | undefined {
  return useContext(DshPortalContext) ?? undefined
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
