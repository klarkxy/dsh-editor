import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ShellTheme, radixThemesStyles } from '../src/client/ui/theme-root.tsx'
import { redesignedStyles } from '../src/styles.ts'
import { componentStyles, officialResourceStyles, responsiveStyles } from '../src/design-system/styles.ts'
import { tokenStyles } from '../src/design-system/tokens.ts'
import { collectStyles, defineStyles } from '../src/design-system/layers.ts'
import {
  GalleryColumn,
  GalleryRow,
  GalleryScales,
  GallerySection,
  GallerySectionButtons,
  GallerySectionFeedback,
  GallerySectionInputs,
  GallerySectionLists,
  GallerySectionOverlays,
  GallerySectionSelection,
  GallerySwatches,
} from '../src/design-system/gallery.tsx'
import { LIGHT_TOKENS, DARK_TOKENS } from '../src/design-system/tokens.ts'
import {
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  Drawer,
  Field,
  IconButton,
  Input,
  ListRow,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  PlusIcon,
  Popover,
  Select,
  SplitButton,
  Tooltip,
  UiRoot,
  type ThemeName,
} from '../src/ui/index.ts'
import { DshPortalContext } from '../src/ui/shared.ts'

/* 与 design-system.tsx fixture 相同的注册次序；组件样式经各自 .styles.ts
   的 defineStyles 进入同一张 collectStyles() 输出。 */
defineStyles('legacy', 'radix-themes', radixThemesStyles)
defineStyles('legacy', 'shell-legacy', redesignedStyles)
defineStyles('legacy', 'yuangao-components', componentStyles)
defineStyles('legacy', 'yuangao-responsive', responsiveStyles)
defineStyles('legacy', 'yuangao-official-resource', officialResourceStyles)
defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
const shellCss = collectStyles()

/* G2 评审页：生产 gallery 的独立全页渲染。
   ?theme=light|dark → 单根全宽；缺省 → 浅深并排。
   ?section=tokens|buttons|inputs|selection|menus|dialogs|feedback|lists → 只渲染该小节。
   菜单/气泡/提示在页面内常开；对话框/抽屉用局部 portal 容器嵌进演示框。 */

function DemoFrame(props: { label: string; children?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setEl(ref.current), [])
  return (
    <div className="dsh-gal-frame" data-wide={props.wide || undefined}>
      <div className="dsh-gal-frame__label">{props.label}</div>
      <div className="dsh-gal-frame__stage" ref={ref}>
        <DshPortalContext.Provider value={el}>{props.children}</DshPortalContext.Provider>
      </div>
    </div>
  )
}

function MenusDemo() {
  const ctxRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const el = ctxRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    // 合成右键事件展开 ContextMenu（Radix 监听 DOM contextmenu）。
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.x + 12, clientY: box.y + 12 }))
  }, [])
  return (
    <GallerySection title="菜单与浮层">
      <GalleryRow>
        <Menu open modal={false}>
          <MenuTrigger><Button variant="secondary">下拉菜单</Button></MenuTrigger>
          <MenuContent aria-label="示例菜单">
            <MenuLabel>章节</MenuLabel>
            <MenuItem icon={<PlusIcon size="sm" />} shortcut="Ctrl+N">新建章节</MenuItem>
            <MenuItem shortcut="F2">重命名</MenuItem>
            <MenuSub>
              <MenuSubTrigger>移动到</MenuSubTrigger>
              <MenuSubContent aria-label="移动到">
                <MenuItem>第二章</MenuItem>
                <MenuItem>第三章</MenuItem>
              </MenuSubContent>
            </MenuSub>
            <MenuSeparator />
            <MenuItem tone="danger" shortcut="Del">删除</MenuItem>
          </MenuContent>
        </Menu>
        <ContextMenu>
          <ContextMenuTrigger>
            <span ref={ctxRef} className="dsh-gallery__ctx-target">右键区域（已展开）</span>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label="右键菜单">
            <ContextMenuItem shortcut="Ctrl+C">复制</ContextMenuItem>
            <ContextMenuItem>重命名</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem tone="danger">删除</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <Popover
          open
          side="right"
          aria-label="详情"
          trigger={<Button variant="secondary">气泡</Button>}
          content={<div className="dsh-gallery__popover-body"><strong>资料</strong><span>上下文气泡内容，随锚点定位。</span></div>}
        />
        <Tooltip open content="快捷提示内容" side="bottom">
          <IconButton label="带提示的图标按钮"><PlusIcon /></IconButton>
        </Tooltip>
      </GalleryRow>
    </GallerySection>
  )
}

function DialogsDemo() {
  const filename = useRef<HTMLInputElement | null>(null)
  return (
    <GallerySection title="对话框">
      <div className="dsh-gal-frames">
        <DemoFrame label="Dialog">
          <Dialog open modal={false} onOpenChange={() => {}} title="导出章节"
            description="示例对话框：标题、说明、表单与底部按钮。"
            closeLabel="关闭"
            initialFocusRef={filename}
            footer={<><Button variant="secondary">取消</Button><Button>导出</Button></>}
          >
            <Field label="文件名" description="导出后的文件名">
              <Input ref={filename} defaultValue="第二章-来信" aria-label="文件名" />
            </Field>
          </Dialog>
        </DemoFrame>
        <DemoFrame label="ConfirmDialog · danger">
          <ConfirmDialog open onOpenChange={() => {}} title="删除章节？"
            message="删除后不可恢复，确认键使用危险色。"
            confirmLabel="删除" cancelLabel="取消" tone="danger"
            onConfirm={() => {}}
          />
        </DemoFrame>
        <DemoFrame label="Drawer · right">
          <Drawer open modal={false} onOpenChange={() => {}} title="辅助栏" closeLabel="关闭">
            <ListRow label="第一章　雨夜" meta="2.1k" />
            <ListRow label="第二章　来信" meta="3.4k" selected />
          </Drawer>
        </DemoFrame>
      </div>
    </GallerySection>
  )
}

function SectionBody(props: { section: string; theme: ThemeName }) {
  switch (props.section) {
    case 'tokens':
      return <><GallerySwatches tokens={props.theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS} /><GalleryScales /></>
    case 'buttons': return <GallerySectionButtons />
    case 'inputs': return (
      <>
        <GallerySectionInputs />
        <GallerySection title="下拉展开">
          <Select
            aria-label="字体（展开）"
            open
            value="kai"
            onValueChange={() => {}}
            options={[
              { value: 'kai', label: '楷体', description: '手稿标题' },
              { value: 'song', label: '宋体' },
              { value: 'system', label: '系统默认' },
            ]}
          />
        </GallerySection>
      </>
    )
    case 'selection': return <GallerySectionSelection />
    case 'menus': return <MenusDemo />
    case 'dialogs': return <DialogsDemo />
    case 'feedback': return <GallerySectionFeedback />
    case 'lists': return (
      <>
        <GallerySectionLists />
        <GallerySection title="SplitButton">
          <SplitButton label="新对话" menuLabel="对话模式" onClick={() => {}}
            items={[{ label: '续写', shortcut: 'Ctrl+J' }, { label: '头脑风暴' }]} />
        </GallerySection>
      </>
    )
    case 'overlays': return <GallerySectionOverlays />
    default: return <GallerySection title="未知小节"><p>section={props.section}</p></GallerySection>
  }
}

function Page() {
  const params = new URLSearchParams(window.location.search)
  const themeParam = params.get('theme')
  const section = params.get('section')
  const themes: ThemeName[] = themeParam === 'light' || themeParam === 'dark' ? [themeParam] : ['light', 'dark']
  return (
    <ShellTheme appearance={themeParam === 'dark' ? 'dark' : 'light'}>
      <style>{shellCss}{`
        body { background: #F7F8F4; font-family: var(--dsh-ui-font-ui); }
        .dsh-gal-page { padding: 24px; }
        .dsh-gal-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(460px, 1fr)); gap: 24px; }
        .dsh-gal-one .dsh-gallery__col { min-height: 0; }
        .dsh-gal-frames { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
        .dsh-gal-frame__label { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); margin-bottom: 6px; }
        .dsh-gal-frame__stage { position: relative; height: 320px; overflow: hidden; border-radius: var(--dsh-ui-radius-lg); background: var(--dsh-ui-bg); box-shadow: var(--dsh-ui-elevation-soft); }
        .dsh-gal-frame__stage .dsh-overlay { position: absolute; }
        .dsh-gal-frame__stage .dsh-dialog { position: absolute; width: min(440px, calc(100% - 24px)); max-height: calc(100% - 20px); }
        .dsh-gal-frame__stage .dsh-drawer { position: absolute; width: min(280px, 88%); }
      `}</style>
      <div className={`dsh-gal-page ${section ? 'dsh-gal-one' : ''}`}>
        <div className="dsh-gal-cols">
          {themes.map(theme => (
            <UiRoot key={theme} theme={theme}>
              <GalleryColumn theme={theme} label={section ? `${theme === 'light' ? '浅色' : '深色'} · ${section}` : undefined}>
                {section ? <SectionBody section={section} theme={theme} /> : undefined}
              </GalleryColumn>
            </UiRoot>
          ))}
        </div>
      </div>
    </ShellTheme>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
