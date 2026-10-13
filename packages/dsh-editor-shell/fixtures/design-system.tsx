import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, ScrollArea } from '@radix-ui/themes'
import { ShellTheme, radixThemesStyles } from '../src/client/ui/theme-root.tsx'
import { redesignedStyles } from '../src/styles.ts'
import { componentStyles, officialResourceStyles, responsiveStyles } from '../src/design-system/styles.ts'
import { tokenStyles } from '../src/design-system/tokens.ts'
import { collectStyles, defineStyles } from '../src/design-system/layers.ts'
import { Markdown } from '../src/client/markdown.tsx'
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PlusIcon,
  SendIcon,
  Switch,
  TextArea,
} from '../src/ui/index.ts'

/* 与 client/root.tsx injectShellStyles 相同的注册次序；fixture 直接注入
   collectStyles() 输出，层序声明也一并覆盖。 */
defineStyles('legacy', 'radix-themes', radixThemesStyles)
defineStyles('legacy', 'shell-legacy', redesignedStyles)
defineStyles('legacy', 'yuangao-components', componentStyles)
defineStyles('legacy', 'yuangao-responsive', responsiveStyles)
defineStyles('legacy', 'yuangao-official-resource', officialResourceStyles)
defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
const shellCss = collectStyles()

/** Browser contract fixture, not an Electron/runtime simulation. */
function Preview() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light')
  const [draft, setDraft] = useState('帮我把这段对话写得更自然。')
  const [selected, setSelected] = useState(2)
  const [sent, setSent] = useState(false)
  const [settings, setSettings] = useState(false)
  const [typewriter, setTypewriter] = useState(true)
  const settingsFocus = useRef<HTMLTextAreaElement | null>(null)
  return <ShellTheme appearance={appearance}>
    <style>{shellCss}{`
      .preview-panels { display:grid; grid-template-columns:248px minmax(0,1fr) 384px; min-height:0; }
      .preview-paper { width:100%; height:100%; resize:none; padding:32px; border:0; background:transparent; color:inherit; font:17px/1.9 serif; }
      .preview-sidebar { padding:8px 12px; }
      .preview-copy { padding:16px; }
      @media(max-width:1000px) { .preview-panels { grid-template-columns:minmax(0,1fr) 340px; } .preview-panels>.sidebar { display:none; } }
      @media(max-width:640px) { .preview-panels { grid-template-columns:1fr; } .preview-panels>.editor-stack { display:none; } }
    `}</style>
    <div className="shell">
      <header className="chrome" role="banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <Menu>
          <MenuTrigger>
            <button type="button" className="workspace-menu-trigger">DSH Editor · 长夜来信 ▾</button>
          </MenuTrigger>
          <MenuContent aria-label="工作区">
            <MenuItem>打开工作区</MenuItem>
            <MenuItem shortcut="Ctrl+E">导出文稿</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger">归档</MenuItem>
          </MenuContent>
        </Menu>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge>UI fixture</Badge>
          <Button variant="ghost" onClick={() => setAppearance(x => x === 'light' ? 'dark' : 'light')}>Toggle theme</Button>
          <Button variant="ghost" onClick={() => setSettings(true)}>Settings</Button>
          <Dialog
            open={settings}
            onOpenChange={setSettings}
            title="Writing settings"
            description="Real portal, theme inheritance and focus return."
            closeLabel="关闭"
            initialFocusRef={settingsFocus}
            footer={<><Button variant="secondary" onClick={() => setSettings(false)}>Cancel</Button><Button onClick={() => setSettings(false)}>Save</Button></>}
          >
            <Switch
              checked={typewriter}
              onCheckedChange={setTypewriter}
              label="打字机滚动"
              description="整行可点击；行高不小于 40px。"
              shortcut="Ctrl+Alt+T"
            />
            <TextArea ref={settingsFocus} aria-label="Settings sample" placeholder="Author preferences" style={{ marginTop: 12 }} />
          </Dialog>
        </div>
      </header>
      <div className="preview-panels">
        <aside className="sidebar">
          <div className="side-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
            <span className="side-title-label">作品</span>
            <IconButton label="New chapter"><PlusIcon /></IconButton>
          </div>
          <div className="tree preview-sidebar">
            {['故事大纲', '第一章　雨夜', '第二章　来信', '第三章　访客', '人物与世界设定'].map((label, index) => <div key={label} className="tree-file-row"><button className="tree-row" aria-current={selected === index ? 'page' : undefined} onClick={() => setSelected(index)}>{label}</button></div>)}
          </div>
          <div data-dsh-plugin-surface="test" className="preview-copy"><button className="rt-BaseButton plugin-sentinel">Plugin-owned button</button></div>
          <style>{`.plugin-sentinel { border-radius:2px; border:1px dashed currentColor; padding:4px; font-size:13px; }`}</style>
        </aside>
        <div className="editor-stack"><main className="editor">
          <div className="editor-header" style={{ display: 'flex', alignItems: 'center' }}>
            <span className="editor-doc-title">第二章　来信</span><span data-testid="paper-save-state">已保存</span>
          </div>
          <textarea aria-label="Manuscript fixture" className="preview-paper" defaultValue={'第二章　来信\n\n雨停的时候，信还没有拆。\n\n她将台灯向桌边移了半寸。信封上的字迹很轻，最后一笔却划破了纸，露出一道细白的口子。\n\n“你确定是今天送来的？”\n\n门口的人没有回答，只把湿透的外套搭在椅背上。\n\n窗外最后一滴雨，从檐角落下。'} />
          <div className="editor-tools" style={{ display: 'flex' }}><Button size="sm" variant="ghost">补全</Button><Button size="sm" variant="ghost">改写</Button><Button size="sm" variant="ghost">校对</Button></div>
        </main></div>
        <aside className="chat">
          <div className="chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
            <span>写作搭档</span><span className="preset-badge">预设</span><span className="models-credential-dot" /><span className="activity-dots"><i /><i /><i /></span><Badge>小说创作</Badge>
          </div>
          <div className="chat-history"><ScrollArea style={{height:'100%'}}><div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
            <div className="chat-row user"><Card>保留悬念，让人物说话更自然一点。</Card></div>
            <div className="chat-process"><button className="chat-process-toggle" onClick={event => { const target = event.currentTarget.nextElementSibling as HTMLElement; target.hidden = !target.hidden }}>已阅读 2 份资料 · 展开过程</button><div className="chat-process-body" hidden><span style={{ fontSize: 12 }}>章节正文、人物设定。该夹具没有连接模型服务。</span></div></div>
            <div className="chat-row assistant"><Markdown text={'## 阅读与修订建议\n\n先保留正文的叙述节奏，再逐项核对资料和修改范围。长回复需要清楚的段落边界，作者应能在正文和建议之间来回阅读。\n\n- **段落层级：** 普通叙述保持正常字重，重点只标在关键句上，避免整段都变成强调文字。\n- **资料说明：** 来源、限制与结论分开写，让读者能逐项判断，而不是挤成连续的信息墙。\n- **修改范围：** 保留人物动机与已有事件，只调整本次讨论中的表达和节奏。\n\n### 下一步\n\n可以先对照第二段，再决定是否采用下方提案。代码、引用与链接仍保留各自的语义。'} /></div>
            <Card className="proposal-card"><strong>正文提案 · 第二章</strong><p>“今天？”她抬起头。门口的人把湿外套挂好，才说：“信上是这么写的。”</p><div className="proposal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><Button size="sm" variant="secondary">查看修改</Button><Button size="sm" variant="danger">撤回</Button><Button size="sm" variant="secondary">归档</Button><Button size="sm" disabled>暂不采用</Button><Button size="sm">采用</Button></div></Card>
            {sent ? <span role="status">Fixture message submitted. No model request.</span> : null}
          </div></ScrollArea></div>
          <form className="composer" onSubmit={event => { event.preventDefault(); setSent(true); setDraft('') }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><TextArea aria-label="Chat input" value={draft} onChange={setDraft} placeholder="写下你的想法…" minRows={1} maxRows={6} />
              <div className="composer-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 12, color: 'var(--dsh-ui-muted)' }}>写作模型 · 标准</span><div className="composer-actions"><IconButton className="send" type="submit" variant="primary" disabled={!draft.trim()} label="Send message"><SendIcon /></IconButton></div></div>
            </div>
          </form>
        </aside>
      </div>
      <Button className="dsh-launcher" aria-label="Assistant launcher" tabIndex={-1} style={{ pointerEvents: 'none' }}>搭档</Button>
    </div>
  </ShellTheme>
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing preview root')
createRoot(root).render(<Preview />)
