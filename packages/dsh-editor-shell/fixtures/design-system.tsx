import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge, Button, Card, Dialog, DropdownMenu, Flex, IconButton, ScrollArea, Text, TextArea } from '@radix-ui/themes'
import { ShellTheme, radixThemesStyles } from '../src/client/ui/theme-root.tsx'
import { redesignedStyles } from '../src/styles.ts'

/** Browser contract fixture, not an Electron/runtime simulation. */
function Preview() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light')
  const [draft, setDraft] = useState('帮我把这段对话写得更自然。')
  const [selected, setSelected] = useState(2)
  const [sent, setSent] = useState(false)
  return <ShellTheme appearance={appearance} accent="blue">
    <style>{radixThemesStyles}{redesignedStyles}{`
      .preview-panels { display:grid; grid-template-columns:248px minmax(0,1fr) 384px; min-height:0; }
      .preview-paper { width:100%; height:100%; resize:none; padding:32px; border:0; background:transparent; color:inherit; font:17px/1.9 serif; }
      .preview-sidebar { padding:8px 12px; }
      .preview-copy { padding:16px; }
      @media(max-width:1000px) { .preview-panels { grid-template-columns:minmax(0,1fr) 340px; } .preview-panels>.sidebar { display:none; } }
      @media(max-width:640px) { .preview-panels { grid-template-columns:1fr; } .preview-panels>.editor-stack { display:none; } }
    `}</style>
    <div className="shell">
      <Flex className="chrome" align="center" justify="between" px="3">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger><Button className="workspace-menu-trigger" variant="ghost" color="gray">DSH Editor · 长夜来信 ▾</Button></DropdownMenu.Trigger>
          <DropdownMenu.Content><DropdownMenu.Item>Open workspace</DropdownMenu.Item><DropdownMenu.Item>Export manuscript</DropdownMenu.Item><DropdownMenu.Separator/><DropdownMenu.Item color="red">Archive</DropdownMenu.Item></DropdownMenu.Content>
        </DropdownMenu.Root>
        <Flex gap="2" align="center">
          <Badge color="gray">UI fixture</Badge>
          <Button variant="ghost" color="gray" onClick={() => setAppearance(x => x === 'light' ? 'dark' : 'light')}>Toggle theme</Button>
          <Dialog.Root>
            <Dialog.Trigger><Button variant="ghost" color="gray">Settings</Button></Dialog.Trigger>
            <Dialog.Content className="file-dialog">
              <Dialog.Title>Writing settings</Dialog.Title><Dialog.Description>Real Radix portal, theme and focus return.</Dialog.Description>
              <TextArea aria-label="Settings sample" placeholder="Author preferences" mt="4"/>
              <Flex gap="2" justify="end" mt="4"><Dialog.Close><Button variant="outline">Cancel</Button></Dialog.Close><Dialog.Close><Button>Save</Button></Dialog.Close></Flex>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      </Flex>
      <div className="preview-panels">
        <aside className="sidebar">
          <Flex className="side-title" align="center" justify="between" px="4"><Text className="side-title-label">作品</Text><IconButton variant="ghost" color="gray" aria-label="New chapter">＋</IconButton></Flex>
          <div className="tree preview-sidebar">
            {['故事大纲', '第一章　雨夜', '第二章　来信', '第三章　访客', '人物与世界设定'].map((label, index) => <div key={label} className="tree-file-row"><button className="tree-row" aria-current={selected === index ? 'page' : undefined} onClick={() => setSelected(index)}>{label}</button></div>)}
          </div>
          <div data-dsh-plugin-surface="test" className="preview-copy"><button className="rt-BaseButton plugin-sentinel">Plugin-owned button</button></div>
          <style>{`.plugin-sentinel { border-radius:2px; border:1px dashed currentColor; padding:4px; font-size:13px; }`}</style>
        </aside>
        <div className="editor-stack"><main className="editor">
          <Flex className="editor-header" align="center"><Text className="editor-doc-title">第二章　来信</Text><Text data-testid="paper-save-state">已保存</Text></Flex>
          <textarea aria-label="Manuscript fixture" className="preview-paper" defaultValue={'第二章　来信\n\n雨停的时候，信还没有拆。\n\n她将台灯向桌边移了半寸。信封上的字迹很轻，最后一笔却划破了纸，露出一道细白的口子。\n\n“你确定是今天送来的？”\n\n门口的人没有回答，只把湿透的外套搭在椅背上。\n\n窗外最后一滴雨，从檐角落下。'} />
          <Flex className="editor-tools"><Button size="1" variant="ghost" color="gray">补全</Button><Button size="1" variant="ghost" color="gray">改写</Button><Button size="1" variant="ghost" color="gray">校对</Button></Flex>
        </main></div>
        <aside className="chat">
          <Flex className="chat-header" align="center" justify="between" px="3"><Text weight="medium">写作搭档</Text><Badge className="composer-mode" color="gray">小说创作</Badge></Flex>
          <div className="chat-history"><ScrollArea style={{height:'100%'}}><Flex direction="column" gap="4" p="4">
            <div className="chat-row user"><Card>保留悬念，让人物说话更自然一点。</Card></div>
            <div className="chat-process"><button className="chat-process-toggle" onClick={event => { const target = event.currentTarget.nextElementSibling as HTMLElement; target.hidden = !target.hidden }}>已阅读 2 份资料 · 展开过程</button><div className="chat-process-body" hidden><Text size="1">章节正文、人物设定。该夹具没有连接模型服务。</Text></div></div>
            <div className="chat-row assistant"><div className="chat-markdown"><p>我会保留“来信者是谁”这个悬念，把解释移到人物的动作里。</p></div></div>
            <Card className="proposal-card"><Text weight="medium">正文提案 · 第二章</Text><Text as="p" size="2" mt="2">“今天？”她抬起头。\n\n门口的人把湿外套挂好，才说：“信上是这么写的。”</Text><Flex className="proposal-actions" justify="end" gap="2"><Button size="1" variant="outline">查看修改</Button><Button size="1">采用</Button></Flex></Card>
            {sent ? <Text role="status">Fixture message submitted. No model request.</Text> : null}
          </Flex></ScrollArea></div>
          <form className="composer" onSubmit={event => { event.preventDefault(); setSent(true); setDraft('') }}>
            <Flex direction="column" gap="2"><TextArea aria-label="Chat input" value={draft} onChange={event => setDraft(event.target.value)} placeholder="写下你的想法…" />
              <Flex className="composer-toolbar" justify="between" align="center"><Text size="1" color="gray">写作模型 · 标准</Text><div className="composer-actions"><IconButton className="send" type="submit" disabled={!draft.trim()} aria-label="Send message">↑</IconButton></div></Flex>
            </Flex>
          </form>
        </aside>
      </div>
    </div>
  </ShellTheme>
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing preview root')
createRoot(root).render(<Preview />)
