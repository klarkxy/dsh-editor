import { LazyMotion, domAnimation } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const useIsoLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect
import { DshPortalContext } from './shared.ts'
import { TooltipProvider } from './tooltip.tsx'
import './root.styles.ts'

export type ThemeName = 'light' | 'dark'

/*
 * §3：新组件树的主题根。data-dsh-theme 让 token 选择器（第 3 节）对
 * 预览页里并排的两个根各自生效；portal-root 子层是所有新组件 Portal 的
 * container，避免落到 body 丢掉 --dsh-ui-* 覆盖。
 */
export function UiRoot(props: { theme: ThemeName; children?: ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null)
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  useIsoLayoutEffect(() => setPortal(portalRef.current), [])
  return (
    <TooltipProvider>
      <LazyMotion features={domAnimation} strict>
        <div className="dsh-root" data-dsh-theme={props.theme}>
          <DshPortalContext.Provider value={portal}>
            {props.children}
            <div data-dsh-portal-root="" ref={portalRef} />
          </DshPortalContext.Provider>
        </div>
      </LazyMotion>
    </TooltipProvider>
  )
}
