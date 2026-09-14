import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import {
  ActivityDots,
  ActivityRing,
  ActivityShimmer,
  ActivitySkeleton,
  ActivityText,
  SuccessMark,
} from './activity.tsx'

/* activity.tsx 的组件是纯函数:直接调用并检查返回的元素树,
   不需要 DOM 渲染器(shell 没有 react-dom 依赖)。 */
type Rendered = ReactElement & { props: Record<string, unknown> & { children?: ReactNode } }

function render(component: (props: never) => ReactNode, props: Record<string, unknown> = {}): Rendered {
  return (component as (input: Record<string, unknown>) => ReactNode)(props) as Rendered
}

function childrenOf(element: Rendered): ReactNode[] {
  const children = element.props.children
  const list = Array.isArray(children) ? children : children == null ? [] : [children]
  return list.filter((child) => child != null && child !== false)
}

describe('activity primitives', () => {
  it('renders three decorative pulse dots by default', () => {
    const element = render(ActivityDots)
    expect(element.props.className).toContain('activity-dots')
    expect(element.props.className).toContain('is-pulse')
    expect(element.props['aria-hidden']).toBe('true')
    expect(childrenOf(element)).toHaveLength(3)
  })

  it('supports the typing variant for reply/thinking states', () => {
    const element = render(ActivityDots, { variant: 'typing' })
    expect(element.props.className).toContain('is-typing')
  })

  it('renders the smooth-ring arc adapted from Amicro (dasharray 38 80)', () => {
    const element = render(ActivityRing, { size: 24 })
    expect(element.props['aria-hidden']).toBe('true')
    expect(element.props.style).toEqual({ width: 24, height: 24 })
    const [track, arc] = childrenOf(element) as Rendered[]
    expect(track.props.className).toBe('activity-ring-track')
    expect(arc.props.className).toBe('activity-ring-arc')
    expect(arc.props.strokeDasharray).toBe('38 80')
    expect(arc.props.strokeLinecap).toBe('round')
  })

  it('renders a stable skeleton with deterministic line widths', () => {
    const element = render(ActivitySkeleton, { lines: 4 })
    expect(element.props['aria-hidden']).toBe('true')
    const lines = childrenOf(element) as Rendered[]
    expect(lines).toHaveLength(4)
    expect(lines.map((line) => (line.props.style as { width: string }).width)).toEqual(['100%', '88%', '96%', '72%'])
  })

  it('announces ActivityText as a polite status with a cue', () => {
    const element = render(ActivityText, { children: '正在检查…' })
    expect(element.props.role).toBe('status')
    expect(element.props['aria-live']).toBe('polite')
    const [cue, label] = childrenOf(element) as Rendered[]
    expect(cue.type).toBe(ActivityDots)
    expect(label.props.children).toBe('正在检查…')
  })

  it('drops aria-live for alert role and honors cue: none', () => {
    const element = render(ActivityText, { role: 'alert', cue: 'none', children: '失败' })
    expect(element.props.role).toBe('alert')
    expect(element.props['aria-live']).toBeUndefined()
    expect(childrenOf(element)).toHaveLength(1)
  })

  it('renders shimmer line and success mark as decorative elements', () => {
    expect(render(ActivityShimmer).props['aria-hidden']).toBe('true')
    const mark = render(SuccessMark)
    expect(mark.props['aria-hidden']).toBe('true')
    const [path] = childrenOf(mark) as Rendered[]
    expect(path.props.fill).toBe('none')
  })
})
