import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkspaceView } from '../../dsh-compat.ts'
import { setLocale } from '../../i18n/index.ts'
import { UiRoot } from '../../ui/index.ts'
import { HomeScreen } from './home.tsx'

const works: WorkspaceView[] = [
  { workspaceId: 'one', title: '夜航船', path: 'C:/works/one', sessionIds: [], createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
  { workspaceId: 'two', title: '未完成的长篇草稿集', path: 'C:/works/two', sessionIds: [], createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
]
const noop = () => {}

function renderHome(overrides: Partial<ComponentProps<typeof HomeScreen>> = {}) {
  const props: ComponentProps<typeof HomeScreen> = {
    workspaceOpen: { kind: 'idle' }, openingWorkspace: false, newProjectBusy: false,
    onOpenWork: noop, onNewProject: noop, pathFallbackForm: null,
    onContinueIntent: noop, onCancelIntent: noop, homeNote: null, onDismissNote: noop,
    workspaces: works, onOpenWorkspace: noop, onRelocate: noop,
    removeRecentTarget: null, onRequestRemoveRecent: noop, onCancelRemoveRecent: noop,
    onConfirmRemoveRecent: noop, dialogs: null, onOpenPalette: noop,
    onOpenSettings: noop, onOpenPlugins: noop, ...overrides,
  }
  return renderToStaticMarkup(createElement(UiRoot, { theme: 'light' }, createElement(HomeScreen, props)))
}

function removeButtons(markup: string) {
  return markup.match(/<button\b[^>]*data-testid="dsh-home-remove-recent"[^>]*>[\s\S]*?<\/button>/g) ?? []
}

afterEach(() => setLocale('zh'))

describe('recent work removal entry', () => {
  it.each([['zh', '移除'], ['en', 'Remove']] as const)('offers a labelled button for each work without opening a menu (%s)', (locale, label) => {
    setLocale(locale)
    const buttons = removeButtons(renderHome())
    expect(buttons).toHaveLength(works.length)
    for (const button of buttons) {
      expect(button).toContain(`>${label}</span>`)
      expect(button).not.toContain('disabled=""')
      expect(button).not.toContain('aria-hidden="true"')
    }
  })

  it('disables the row action while a new work is being created', () => {
    const buttons = removeButtons(renderHome({ newProjectBusy: true }))
    expect(buttons).toHaveLength(works.length)
    for (const button of buttons) expect(button).toContain('disabled=""')
  })

  it('names the target and explains that files stay on disk before confirmation', () => {
    const markup = renderHome({ removeRecentTarget: works[0] })
    expect(markup).toContain('role="alertdialog"')
    expect(markup).toContain('只会从列表去掉「夜航船」')
    expect(markup).toContain('作品文件不会被删除，仍可重新打开。')
    expect(markup).toContain('>取消</span>')
  })

  it('has no removal action or continue card when no recent works remain', () => {
    const markup = renderHome({ workspaces: [] })
    expect(removeButtons(markup)).toHaveLength(0)
    expect(markup).not.toContain('dsh-home-continue__action')
    expect(markup).toContain('dsh-home__empty')
  })
})
