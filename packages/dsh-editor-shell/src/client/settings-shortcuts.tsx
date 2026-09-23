import { useEffect, useState } from 'react'
import { Card, Heading, Kbd, Table, Text } from '@radix-ui/themes'
import { useLocale } from '../i18n/index.ts'
import { runtimeShortcutHint, runtimeShortcutPlatform } from '../palette-shortcut.ts'
import type { ShellCommandRegistry } from '../seats.ts'

type Row = [keys: string, zh: string, en: string]
const groups = (platform: string): { title: [string, string]; rows: Row[] }[] => [
  { title: ['全局与工作区', 'App and workspace'], rows: [
    ['Ctrl+Shift+N', '新建窗口（仅桌面版）', 'New window (desktop only)'],
    ['Mod+,', '打开设置', 'Open settings'],
    ['Mod+K', '命令面板 / 快速打开文件', 'Command palette / open a file'],
    ['Mod+B', '显示 / 隐藏侧栏', 'Toggle sidebar'],
    ['Mod+J', '显示 / 隐藏助手', 'Toggle assistant'],
    ['Mod+L', '聚焦助手输入框', 'Focus assistant input'],
    ['Mod+\\', '切换专注模式', 'Toggle focus mode'],
    ['Mod+Shift+F', '搜索整个作品', 'Search the workspace'],
    ['Mod+Alt+T', '切换打字机模式', 'Toggle typewriter mode'],
    ['Mod+Alt+P', '切换段落聚焦', 'Toggle paragraph focus'],
  ] },
  { title: ['稿纸与补全', 'Manuscript and completion'], rows: [
    ['Mod+S', '保存文稿', 'Save manuscript'],
    ['Mod+Enter', '手动补全；有改写预览时接受改写', 'Request completion; accept an open rewrite preview'],
    ['Tab', '接受光标处的补全建议', 'Accept the inline suggestion'],
    ['Esc', '取消补全 / 改写生成或建议', 'Cancel completion / rewrite generation or suggestions'],
    ['Shift+F10 / Menu', '稿纸或文件树：打开右键菜单', 'Manuscript or file tree: open context menu'],
    ['Mod+Z', '撤销', 'Undo'],
    [platform === 'darwin' ? 'Mod+Shift+Z' : platform === 'linux' ? 'Ctrl+Y / Ctrl+Shift+Z' : 'Ctrl+Y', '重做', 'Redo'],
    ['Mod+A', '全选', 'Select all'],
    ['Mod+C / Mod+X / Mod+V', '复制 / 剪切 / 粘贴', 'Copy / cut / paste'],
    ['Alt+↑ / Alt+↓', '上移 / 下移当前行', 'Move line up / down'],
    ['Alt+Shift+↑ / Alt+Shift+↓', '向上 / 向下复制当前行', 'Copy line up / down'],
    ['Mod+Shift+K', '删除当前行', 'Delete line'],
    ['Mod+[ / Mod+]', '减少 / 增加缩进', 'Indent less / more'],
  ] },
  { title: ['稿纸查找与替换', 'Find and replace in the manuscript'], rows: [
    ['Mod+F', '打开查找', 'Open find'],
    ['Mod+H', '打开替换（macOS 也可用查找栏内的替换按钮）', 'Open replace (also available in the find bar on macOS)'],
    ['F3 / Mod+G', '下一个匹配', 'Next match'],
    ['Shift+F3 / Mod+Shift+G', '上一个匹配', 'Previous match'],
    ['Enter / Shift+Enter', '查找栏中：下一个 / 上一个匹配', 'In the find bar: next / previous match'],
    ['Esc', '查找栏中：关闭并返回稿纸', 'In the find bar: close and return to the manuscript'],
  ] },
  { title: ['对话与弹窗', 'Chat and dialogs'], rows: [
    ['Enter / Shift+Enter', '助手输入框：发送 / 换行', 'Assistant input: send / new line'],
    ['Mod+Enter', '自定义改写 / 校对输入框：提交', 'Custom rewrite / proofread input: submit'],
    ['Enter', '知乎搜索框 / 人物卡与世界书输入框：提交', 'Zhihu search / character and worldbook input: submit'],
    ['↑ / ↓ / Enter', '命令面板：选择并执行', 'Command palette: select and run'],
    ['Tab / Shift+Tab', '移动到下一个 / 上一个控件', 'Focus next / previous control'],
    ['← / → / Home / End', '标签页：切换 / 首项 / 末项', 'Tabs: switch / first / last'],
    ['Esc', '关闭当前菜单或可关闭的弹窗', 'Close the current menu or dismissible dialog'],
  ] },
]

export function ShortcutsSettings({ commands }: { commands?: ShellCommandRegistry }) {
  const locale = useLocale()
  const [registered, setRegistered] = useState(() => commands?.list() ?? [])
  useEffect(() => {
    const refresh = () => setRegistered(commands?.list() ?? [])
    refresh()
    return commands?.subscribe(refresh)
  }, [commands])
  const language = locale === 'en' ? 1 : 0
  const platform = runtimeShortcutPlatform()
  const mac = platform === 'darwin'
  const builtin = groups(platform)
  const plugins: Row[] = registered.flatMap(command => {
    if (!command.shortcut) return []
    const key = command.shortcut
    return [[
      [key.ctrl ? 'Mod' : '', key.alt ? 'Alt' : '', key.shift ? 'Shift' : '', key.key.toUpperCase()].filter(Boolean).join('+'),
      command.label.zh, command.label.en || command.label.zh,
    ] as Row]
  })
  const advanced: Row[] = [
    ['← / → / ↑ / ↓', '移动光标；加 Shift 扩展选区', 'Move cursor; hold Shift to extend selection'],
    [mac ? 'Alt+← / Alt+→' : 'Ctrl+← / Ctrl+→', '按词移动；加 Shift 选词', 'Move by word; hold Shift to select'],
    ['Home / End', '移到行首 / 行尾；加 Shift 选择', 'Line start / end; hold Shift to select'],
    ['Mod+Home / Mod+End', '移到文首 / 文末；加 Shift 选择', 'Document start / end; hold Shift to select'],
    ['PageUp / PageDown', '上下翻页；加 Shift 选择', 'Page up / down; hold Shift to select'],
    ['Enter / Shift+Enter', '换行并保持缩进', 'New line with indentation'],
    ['Backspace / Delete', '向前 / 向后删除', 'Delete backward / forward'],
    [mac ? 'Alt+Backspace / Alt+Delete' : 'Ctrl+Backspace / Ctrl+Delete', '按词删除', 'Delete by word'],
    ['Mod+U', '撤销选区变化', 'Undo selection change'],
    [mac ? 'Mod+Shift+U' : 'Alt+U', '重做选区变化', 'Redo selection change'],
    ['Mod+Alt+↑ / Mod+Alt+↓', '在上一行 / 下一行添加光标', 'Add cursor above / below'],
    ['Esc', '没有建议时：收起多个选区', 'With no suggestion: simplify multiple selections'],
    [mac ? 'Ctrl+← / Ctrl+→' : 'Alt+← / Alt+→', '按语法单元移动；加 Shift 选择', 'Move by syntax unit; hold Shift to select'],
    ['Mod+I', '扩大语法选区', 'Select parent syntax'],
    ['Mod+Alt+\\', '整理选区缩进', 'Reindent selection'],
    ['Mod+Shift+\\', '跳转到匹配括号', 'Jump to matching bracket'],
    ['Mod+/', '切换注释', 'Toggle comment'],
    [mac ? 'Ctrl+Shift+A' : 'Alt+Shift+A', '切换块注释', 'Toggle block comment'],
    [mac ? 'Alt+Shift+M' : 'Ctrl+M', '切换 Tab 焦点模式', 'Toggle Tab focus mode'],
    ...(!mac ? [['Alt+L', '选中当前行', 'Select current line'] as Row] : [
      ['Mod+← / Mod+→', '移到行首 / 行尾；加 Shift 选择', 'Line start / end; hold Shift to select'],
      ['Mod+↑ / Mod+↓', '移到文首 / 文末；加 Shift 选择', 'Document start / end; hold Shift to select'],
      ['Ctrl+↑ / Ctrl+↓', '上下翻页；加 Shift 选择', 'Page up / down; hold Shift to select'],
      ['Mod+Backspace / Mod+Delete', '删除至行首 / 行尾', 'Delete to line start / end'],
      ['Ctrl+F / Ctrl+P / Ctrl+N / Ctrl+A / Ctrl+E', 'macOS：右移 / 上移 / 下移 / 行首 / 行尾', 'macOS: right / up / down / line start / line end'],
      ['Ctrl+D / Ctrl+H / Ctrl+Alt+H', 'macOS：向后删字 / 向前删字 / 向前删词', 'macOS: delete forward / backward / previous word'],
      ['Ctrl+O / Ctrl+T / Ctrl+V', 'macOS：拆行 / 交换相邻字符 / 下一页', 'macOS: split line / transpose characters / page down'],
    ] as Row[]),
  ]
  const all = plugins.length ? [...builtin, { title: ['已启用的插件', 'Enabled plugins'] as [string, string], rows: plugins }] : builtin
  const renderRows = (rows: Row[]) => <Table.Root size="1">
    <Table.Header><Table.Row><Table.ColumnHeaderCell>{locale === 'en' ? 'Action' : '操作'}</Table.ColumnHeaderCell><Table.ColumnHeaderCell>{locale === 'en' ? 'Shortcut' : '快捷键'}</Table.ColumnHeaderCell></Table.Row></Table.Header>
    <Table.Body>{rows.map(([keys, zh, en]) => <Table.Row key={keys + zh}>
      <Table.RowHeaderCell>{locale === 'en' ? en : zh}</Table.RowHeaderCell>
      <Table.Cell>{keys.split(' / ').map((key, i) => <span key={key}>{i > 0 ? ' / ' : ''}<Kbd>{runtimeShortcutHint(key)}</Kbd></span>)}</Table.Cell>
    </Table.Row>)}</Table.Body>
  </Table.Root>
  return <section aria-label={locale === 'en' ? 'Keyboard shortcuts' : '快捷键'}>
    <Text as="p" size="2" color="gray" mb="4">{locale === 'en'
      ? 'Shortcuts apply to the focused area. Workspace commands require an open project; AI features must be enabled. Keys below follow your platform.'
      : '快捷键按当前焦点生效。工作区操作需要打开作品，AI 操作需要启用对应功能。下方按键随系统显示。'}</Text>
    {all.map(group => <Card className="settings-block" key={group.title[0]}>
      <Heading as="h3" size="3" mb="3">{group.title[language]}</Heading>
      {renderRows(group.rows)}
    </Card>)}
    <Card className="settings-block"><details>
      <summary>{locale === 'en' ? 'More editing and navigation shortcuts' : '更多编辑与光标快捷键'}</summary>
      {renderRows(advanced)}
    </details></Card>
    <Text as="p" size="2" color="gray">{locale === 'en'
      ? 'Some keys may be reserved by your browser or OS. Use the command palette or menus if a shortcut is intercepted.'
      : '部分组合键可能被浏览器或系统占用；遇到冲突时可从命令面板或菜单执行。'}</Text>
    {mac ? <Text as="p" size="2" color="gray">{locale === 'en'
      ? 'App and plugin commands also accept Ctrl on macOS. Ctrl+B, Ctrl+K and Ctrl+L therefore control the sidebar, palette and assistant instead of cursor movement.'
      : 'macOS 的全局与插件命令也接受 Ctrl；Ctrl+B、Ctrl+K、Ctrl+L 分别控制侧栏、命令面板和助手，会覆盖同键的光标操作。'}</Text> : null}
  </section>
}
