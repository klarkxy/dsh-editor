import { LazyMotion, domAnimation } from 'motion/react'
import type { ReactNode } from 'react'
import type { AccentValue, ThemeValue } from '../theme.tsx'
import { ShellTheme } from './theme-root.tsx'
import { TooltipProvider } from './tooltip.tsx'

export function ShellUiProvider(props: {
  theme: ThemeValue
  accent: AccentValue
  children?: ReactNode
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <TooltipProvider>
        <ShellTheme appearance={props.theme === 'dark' ? 'dark' : 'light'} accent={props.accent}>
          {props.children}
        </ShellTheme>
      </TooltipProvider>
    </LazyMotion>
  )
}
