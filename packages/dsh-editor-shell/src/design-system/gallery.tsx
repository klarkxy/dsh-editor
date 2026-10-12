import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DESIGN_SOURCE, LIGHT_TOKENS, DARK_TOKENS } from './tokens.ts'
import {
  ActivityDots,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Disclosure,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
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
  Notice,
  PlusIcon,
  Popover,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Select,
  Slider,
  Spinner,
  SplitButton,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  UiRoot,
} from '../ui/index.ts'
import './gallery.styles.ts'

/** §5 组件库的活体参考：浅深两个 UiRoot 并排，token 色板与字级/圆角/投影标尺。 */
const SWATCH_KEYS = [
  'bg', 'surface', 'raised', 'chrome', 'sidebar', 'sunken',
  'text', 'muted', 'faint', 'line', 'line-strong',
  'brand', 'brand-hover', 'accent-soft', 'selected', 'hover', 'bubble',
  'marker', 'success', 'warning', 'danger',
  'menu-fill', 'scrim', 'link',
] as const

const TEXT_SCALE = ['text-xs', 'text-sm', 'text-base', 'text-md', 'text-lg', 'text-xl', 'text-2xl'] as const
const RADIUS_SCALE = ['radius-xs', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'radius-2xl', 'radius-full'] as const
const ELEVATION_SCALE = ['elevation-soft', 'elevation-panel', 'elevation-prominent'] as const

function Row(props: { children?: ReactNode }) {
  return <div className="dsh-gallery__row">{props.children}</div>
}

function Section(props: { title: ReactNode; children?: ReactNode }) {
  return (
    <section className="dsh-gallery__section">
      <h3 className="dsh-gallery__section-title">{props.title}</h3>
      {props.children}
    </section>
  )
}

function Swatches(props: { tokens: Record<string, string> }) {
  return (
    <Row>
      {SWATCH_KEYS.map((name) => (
        <div key={name} className="dsh-gallery__swatch">
          <span aria-hidden="true" className="dsh-gallery__swatch-fill" style={{ '--swatch': props.tokens[name] } as Record<string, string>} />
          <span className="dsh-gallery__caption">{name}</span>
        </div>
      ))}
    </Row>
  )
}

function Scales() {
  return (
    <>
      <Section title="字级">
        {TEXT_SCALE.map((name) => (
          <div key={name} className="dsh-gallery__type" style={{ '--t': `var(--dsh-ui-${name})` } as Record<string, string>}>{name} · 原稿排版样例</div>
        ))}
        <div className="dsh-gallery__type-display">font-display · 第二章　来信</div>
        <div className="dsh-gallery__type-mono">font-mono · npm:@klarkxy/dsh-zhihu</div>
      </Section>
      <Section title="圆角">
        <Row>
          {RADIUS_SCALE.map((name) => (
            <div key={name} className="dsh-gallery__radius">
              <span aria-hidden="true" className="dsh-gallery__radius-box" style={{ '--r': `var(--dsh-ui-${name})` } as Record<string, string>} />
              <span className="dsh-gallery__caption">{name}</span>
            </div>
          ))}
        </Row>
      </Section>
      <Section title="投影">
        <Row>
          {ELEVATION_SCALE.map((name) => (
            <div key={name} className="dsh-gallery__radius">
              <span aria-hidden="true" className="dsh-gallery__elevation-box" style={{ '--e': `var(--dsh-ui-${name})` } as Record<string, string>} />
              <span className="dsh-gallery__caption">{name}</span>
            </div>
          ))}
        </Row>
      </Section>
    </>
  )
}

function OverlayShowcase() {
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const filename = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <Row>
        <Menu>
          <MenuTrigger><Button variant="secondary">菜单</Button></MenuTrigger>
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
        <Popover
          aria-label="详情"
          trigger={<Button variant="secondary">气泡</Button>}
          content={<div className="dsh-gallery__popover-body"><strong>资料</strong><span>上下文气泡内容。</span></div>}
        />
        <Button variant="secondary" onClick={() => setDialog(true)}>对话框</Button>
        <Button variant="secondary" onClick={() => setConfirm(true)}>确认框</Button>
        <Button variant="secondary" onClick={() => setDrawer(true)}>抽屉</Button>
      </Row>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="导出章节"
        description="对话框示例：Escape 关闭，关闭后焦点返回触发按钮。"
        closeLabel="关闭"
        initialFocusRef={filename}
        footer={<><Button variant="secondary" onClick={() => setDialog(false)}>取消</Button><Button onClick={() => setDialog(false)}>导出</Button></>}
      >
        <Field label="文件名" description="导出后的文件名">
          <Input ref={filename} defaultValue="第二章-来信" aria-label="文件名" />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="删除章节？"
        message="删除后不可恢复。busy 时两个按钮都禁用、确认键进入加载态。"
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        busy={busy}
        onConfirm={() => { setBusy(true); setTimeout(() => { setBusy(false); setConfirm(false) }, 600) }}
      />
      <Drawer open={drawer} onOpenChange={setDrawer} title="辅助栏" closeLabel="关闭">
        <ListRow label="第一章　雨夜" meta="2.1k" />
        <ListRow label="第二章　来信" meta="3.4k" selected />
      </Drawer>
    </>
  )
}

function ComponentShowcase() {
  const [on, setOn] = useState(true)
  const [check, setCheck] = useState<boolean | 'indeterminate'>('indeterminate')
  const [width, setWidth] = useState('mid')
  const [radio, setRadio] = useState('manual')
  const [select, setSelect] = useState('kai')
  const [fontSize, setFontSize] = useState([17])
  const [query, setQuery] = useState('来信')
  const [tab, setTab] = useState('body')
  return (
    <>
      <Section title="按钮">
        <Row>
          <Button>主要</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="danger">危险</Button>
        </Row>
        <Row>
          <Button size="sm">小号</Button>
          <Button loading>加载中</Button>
          <Button disabled>禁用</Button>
          <Button variant="secondary" data-demo-state="hover">悬停态</Button>
          <SplitButton
            label="新对话"
            menuLabel="对话模式"
            onClick={() => {}}
            items={[{ label: '续写', shortcut: 'Ctrl+J' }, { label: '头脑风暴' }]}
          />
        </Row>
        <Row>
          <IconButton label="新建章节"><PlusIcon /></IconButton>
          <IconButton label="已固定" variant="secondary" pressed><PlusIcon /></IconButton>
          <IconButton label="不可用" disabled><PlusIcon /></IconButton>
        </Row>
      </Section>
      <Section title="标识与反馈">
        <Row>
          <Badge>默认</Badge><Badge tone="accent">黛蓝</Badge>
          <Badge tone="success">完成</Badge><Badge tone="warning">待确认</Badge><Badge tone="danger">冲突</Badge>
          <Spinner /><ActivityDots />
          <Kbd>Ctrl+Alt+T</Kbd>
        </Row>
        <Notice tone="info" title="提示">普通状态信息，role=&quot;status&quot;。</Notice>
        <Notice tone="success">操作已完成。</Notice>
        <Notice tone="warning" title="警告">需要注意的状态，role=&quot;alert&quot;。</Notice>
        <Notice tone="danger" action={<Button variant="secondary" size="sm">重试</Button>}>操作失败。</Notice>
        <EmptyState
          title="暂无作品"
          body="新建一部作品开始写作。"
          actions={<Button size="sm">新建作品</Button>}
        />
      </Section>
      <Section title="输入">
        <Input aria-label="单行输入" placeholder="单行输入" />
        <Input aria-label="聚焦态演示" data-demo-state="focus" defaultValue="聚焦态" />
        <Field label="必填字段" error="不能为空" description="错误与字段通过 aria 关联">
          <Input aria-label="必填字段" invalid defaultValue="" />
        </Field>
        <Input aria-label="禁用输入" disabled placeholder="禁用输入" />
        <SearchField aria-label="搜索" value={query} onChange={setQuery} onClear={() => setQuery('')} clearLabel="清空" />
        <TextArea aria-label="多行输入" minRows={2} maxRows={4} defaultValue={'多行输入随内容自动增高。\n第二行。'} />
        <Select
          aria-label="字体"
          value={select}
          onValueChange={setSelect}
          options={[
            { value: 'kai', label: '楷体', description: '手稿标题' },
            { value: 'song', label: '宋体' },
            { value: 'system', label: '系统默认' },
          ]}
        />
      </Section>
      <Section title="开关与选择">
        <Switch checked={on} onCheckedChange={setOn} label="打字机滚动" description="光标保持在屏幕中部" shortcut="Ctrl+Alt+T" />
        <Switch checked={false} onCheckedChange={() => {}} label="禁用开关" disabled />
        <Checkbox checked={check} onCheckedChange={setCheck} label="分节标记居中" description="支持半选状态" />
        <RadioGroup
          aria-label="补全方式"
          value={radio}
          onValueChange={setRadio}
          options={[
            { value: 'manual', label: '仅手动', description: '按快捷键触发' },
            { value: 'idle', label: '停顿后提示' },
          ]}
        />
        <SegmentedControl
          aria-label="纸宽"
          value={width}
          onValueChange={setWidth}
          options={[{ value: 'narrow', label: '窄' }, { value: 'mid', label: '中' }, { value: 'wide', label: '宽' }]}
        />
        <Slider aria-label="字号" label="字号" value={fontSize} onValueChange={setFontSize} min={14} max={24} format={(v) => `${v}px`} />
      </Section>
      <Section title="列表与标签页">
        <ListRow label="第一章　雨夜" meta="2.1k" onSelect={() => {}} />
        <ListRow label="第二章　来信" meta="3.4k" selected onSelect={() => {}} />
        <Tabs value={tab} onValueChange={setTab}>
          <TabList aria-label="示例标签页">
            <Tab value="body">正文</Tab>
            <Tab value="cards">人物卡</Tab>
          </TabList>
          <TabPanel value="body">正文面板内容。</TabPanel>
          <TabPanel value="cards">人物卡面板内容。</TabPanel>
        </Tabs>
        <Disclosure summary="高级信息" defaultOpen={false}>
          <div className="dsh-gallery__disclosure-body">折叠区域内容。</div>
        </Disclosure>
      </Section>
      <Section title="浮层">
        <OverlayShowcase />
      </Section>
    </>
  )
}

export function DesignSystemGallery() {
  const [open, setOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  /* 初始焦点放内容容器：自动落到关闭 IconButton 会展开它的 Tooltip，
     按 Escape 时先消耗在关闭提示上，框体要按两次才能关。 */
  const initialFocus = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || !event.ctrlKey || !event.altKey || !event.shiftKey || event.code !== 'KeyD') return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      event.preventDefault()
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOpen(true)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="DSH UI · 原稿设计系统"
      description="组件库活体参考：浅深两个 UiRoot 并排；预览态，不写入工作区。"
      size="lg"
      closeLabel="关闭"
      initialFocusRef={initialFocus}
      returnFocusRef={returnFocus}
      footer={<span className="dsh-gallery__footnote">Source: {DESIGN_SOURCE.repository} · {DESIGN_SOURCE.revision}</span>}
    >
      <div ref={initialFocus} tabIndex={-1} className="dsh-gallery" data-dsh-gallery="">
        {(['light', 'dark'] as const).map((theme) => (
          <UiRoot key={theme} theme={theme}>
            <div className="dsh-gallery__col">
              <h3 className="dsh-gallery__col-title">{theme === 'light' ? '浅色' : '深色'}</h3>
              <Section title="Tokens"><Swatches tokens={theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS} /></Section>
              <Scales />
              <ComponentShowcase />
            </div>
          </UiRoot>
        ))}
      </div>
    </Dialog>
  )
}
