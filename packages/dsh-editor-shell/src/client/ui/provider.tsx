import { LazyMotion, domAnimation } from 'motion/react'
import type { ReactNode } from 'react'
import type { ThemeValue } from '../../model/theme.ts'
import { ShellTheme } from './theme-root.tsx'
import { TooltipProvider } from './tooltip.tsx'

export function ShellUiProvider(props: {
  theme: ThemeValue
  children?: ReactNode
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <TooltipProvider>
        <ShellTheme appearance={props.theme === 'dark' ? 'dark' : 'light'}>
          {props.children}
        </ShellTheme>
      </TooltipProvider>
    </LazyMotion>
  )
}
