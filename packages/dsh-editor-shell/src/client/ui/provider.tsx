import { LazyMotion, domAnimation } from 'motion/react'
import type { ReactNode } from 'react'
import { TooltipProvider } from './tooltip.tsx'

export function ShellUiProvider(props: { children?: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <TooltipProvider>{props.children}</TooltipProvider>
    </LazyMotion>
  )
}
