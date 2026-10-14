# Shell 界面重写规格（第 4 阶段）

本文是第 4 阶段的实施依据。依据有四份：[G1 决策](decision.md)、[视觉方案](visual-directions.md)「三套方案共用的信息架构」1 至 9 项、[设计系统规格](design-system-spec.md)、[行为契约](../ui-behavior-contracts.md)。B 方向的静态示意在本地 `.dev/redesign/proposals/b-yuangao/`，不入库，只作视觉参考；与本文冲突时以本文为准。

## 0. 总则

- **重写的对象**：所有渲染的 JSX 和样式都换成 `src/ui/` 组件，加上 `defineStyles('dsh.surfaces', …)` 注册的界面样式。新界面放在 `packages/dsh-editor-shell/src/app/<区域>/`。
- **复用不重写的部分**：`root-workspaces.tsx`、`root-documents.ts`、`root-file-actions.ts`、`root-desktop.ts`、`capabilities.ts` 这几个 hook 只返回状态和动作，与界面形态无关，而且背后有大量已验证的流程（打开作品、重定位、新建、导入、保存门、快照）。它们原样复用，只在调用方式上做必要调整，返回值的语义不变。`useRootLayout` 承载的是旧的信息架构，由第 2 节的新布局模型替换。
- **每完成一个子项**：删除被替换的旧组件；删除它在所属 sheet（`app/**/*.styles.ts`、`client/*.styles.ts`、`src/ui/*.styles.ts`）里的旧规则，包括影响它的 `!important`；更新 `e2e/helpers/selectors.mjs`；中英文案同步增删。新界面一律带 `data-testid` 钩子，命名为 `dsh-<区域>-<部件>`。
- **不变的接缝**：所有 DSH 接缝（`client.ts`、`root-registration.ts`、`official-layout.ts`、`official-surfaces.tsx`、`native-plugin-manager-seat.ts`、`ui-workspace.ts`、`official-shortcuts.ts`）的语义不变。旧的 `client/` 下仍在使用的接缝文件，在第 6 阶段统一移到 `app/host/`。
- **插槽**：所有插槽的名字、参数和 `[data-dsh-plugin-surface]` 包裹方式不变。插槽内容放在哪里，按第 2 节和第 4 节的规定。
- **提交与门禁**：每个子项单独提交，单独过门禁（见第 10 节）。

## 1. 外框（4.1）

```
┌──────────────────────────────────────────────────────────────────────┐
│ [作品名 ▾] 正文 / 第一章 ▾        (拖动区)     [文件][专注][辅助] [命令] [⚙] [窗口控件] │
├────────────┬──────────────────────────────────────────┬──────────────┤
│ 文件 | 搜索 │              稿纸（铺满中栏）               │ 搭档|资料|工具 │
│  …树…      │                                          │   …          │
└────────────┴──────────────────────────────────────────┴──────────────┘
```

### 顶栏（`app/shell/topbar.tsx`）

- 左组是位置：
  - 作品名菜单：保留现有作品菜单的全部操作，即切换最近作品、打开另一个作品、新建作品、导出稿件、返回首页。
  - 面包屑：显示当前文档的目录和标题。最后一段是章节切换器，下拉列出同目录下按自然顺序排列的文档。
- 中间是 `-webkit-app-region: drag` 的空白拖动区，双击拖动区沿用 `titleBarDoubleClick` 的行为。
- 右组：
  - 视图开关：三个仅图标的 `IconButton`，依次是文件栏、专注、辅助栏，都带 `pressed` 状态，按下时用黛蓝。
  - 「命令」按钮：图标加文字，760px 以上附带 `Kbd` 快捷键提示，点击打开命令面板。
  - extensions dock：沿用现有的 `EXTENSIONS_SLOT`，放在设置按钮之前。
  - 设置按钮：`IconButton`。
  - Electron 窗口控件。
- 主题切换从顶栏移除，改到设置的「外观」和命令面板。
- 760px 以下：隐藏面包屑和命令按钮的快捷键提示；作品名截断，但至少保留 `min(7em, 22vw)` 的宽度；所有入口仍须可点。
- 顶栏高 44px，背景为 `chrome`，没有底部分割线。

### 三栏

- 继续用 `react-resizable-panels`。
- 列为文件栏、稿纸、辅助栏。钉住栏不再是独立的一列，并入辅助栏的「资料」页。
- 宽度键与极值：
  - 文件栏：`dsh-editor.layout.sidebar-width`，200 至 440px，默认 260px。
  - 辅助栏：`dsh-editor.layout.assistant-width`，320 至 640px，默认 400px。
  - `dsh-editor.layout.pinned-width` 不再读写，旧值保留，不删除。
- 以下几项沿用现有实现：断点之后用作者记下的像素宽度重新校正（两帧）、`Layout not found` 的捕获、拖动只在 `isUserInteraction` 时写入宽度。
- 稿纸列最小 420px。

## 2. 布局模型（`src/model/workbench-layout.ts` + `app/shell/use-workbench-layout.ts`）

### 状态

```ts
type AuxTab = 'partner' | 'reference' | 'tools'
type WorkbenchLayout = {
  files: { open: boolean } & RailYieldState      // 复用 narrow-layout.ts
  aux: { open: boolean; tab: AuxTab } & RailYieldState
  focus: boolean
}
```

### 断点

- 1040px 以下，辅助栏改为右侧 `Drawer` 覆盖层。
- 760px 以下，文件栏也改为左侧 `Drawer`。
- 两个覆盖层互斥，打开一个时用 `force` 让另一个让位。
- 让位与接管的规则完全沿用 `narrow-layout.ts` 的 `railAtWidth` 和 `railByAuthor`。

### 持久化（契约 C31）

- 键名不变，`sidebar-open` 对应文件栏，`assistant-open` 对应辅助栏。
- 只有作者操作才写入：顶栏开关、快捷键、Drawer 的关闭按钮、Escape 关闭 Drawer、启动按钮。
- 宽度结算和单稿件自动收起都不写入（单稿件规则沿用 `sidebar-chrome.ts`）。
- 新增 `dsh-editor.layout.aux-tab`：作者手动切换页签时写入；由系统切换的页签不写入，切换来源见下文。
- **修复**：窄窗冷启动时文件栏必须让位，现行实现中换作品的回读效果会把它重新打开。修复后，把 `root-layout.spec.ts` 中「C31 divergence」那条断言改为期望让位。新模型的测试放在 `src/model/workbench-layout.spec.ts`，要覆盖 `root-layout.spec.ts` 里现有的全部 C31 和宽度场景，旧 spec 随旧 hook 一并删除。

### 辅助栏页签的切换来源

以下切换都不写 `aux-tab`。凡是打开辅助栏的操作都算作者操作，会写 `assistant-open`；唯一的例外是第 3 条，那是系统行为。

1. `Ctrl+L`（聚焦搭档输入）或点击启动按钮：打开辅助栏，切到「搭档」。
2. 钉住文件，包括右键「钉在旁边」、命令面板、seat 的 `togglePin`：打开辅助栏，切到「资料」。
3. 官方 `layout.openRightbar()`（点开图片、PDF 等资料预览）：打开辅助栏，切到「资料」。这是系统行为，不写 `assistant-open`。`closeRightbar()` 时，如果辅助栏是由它打开的，就收起辅助栏；否则停留在「资料」页。
4. seat 的 `revealSidebar()` 和 `when: 'workspace'` 命令（校对、记忆等工具）：打开辅助栏，切到「工具」。旧实现中「临时加宽到 336px」的规则对应到辅助栏：辅助栏宽度不足 336px 时临时加到 336px，不写入宽度（契约 C33 的语义平移到辅助栏）。

### 专注模式

- 同时收起文件栏、辅助栏（包括资料预览）和所有覆盖层。
- 退出专注模式后，恢复进入前的状态。
- 不写入任何偏好。

### 连续输入时淡化侧栏（G1 已批准）

- 触发：稿纸中连续两次不带修饰键的输入（`keydown`，排除组字过程）后，在外框根元素上设置 `data-typing="true"`。
- 生效：两侧栏的 `opacity` 变为 `var(--dsh-ui-dim-opacity)`，过渡时长为 `duration-base`。
- 解除，任一即可：`mousemove`、带修饰键的按键、焦点移出稿纸、打开任何菜单或对话框。
- 系统开启减少动态效果时，状态直接切换，没有过渡。
- 淡化期间控件仍可点击，命中区不变。
- 淡化状态放在 React 之外的 DOM 属性上，以免每次按键都触发重渲染。

## 3. 文件栏（4.2，`app/files/`）

- 栏头使用 `Tabs`，分「文件」和「搜索」两页，右侧有两个按钮：
  - 「新建」：一个 `IconButton` 加菜单，菜单项为新建文档、新建文件夹。
  - 「⋯」：菜单项为保存版本、历史版本。
- `Ctrl+Shift+F` 和命令面板中的「跨文件搜索」切换到「搜索」页。搜索页内是现有的跨文件搜索与替换（`search-panel`，用新组件重做外观），交互和保护规则不变（契约 C16）。这一页不会把树往下推。
- 树：
  - `.md`、`.txt` 不显示扩展名，只在显示层去掉，路径不变。其他类型的文件保留扩展名，并按类型显示图标（图片、PDF、Office、其他）。
  - 当前文档用 `selected` 填充、中等字重，名字前加一个朱色 `marker` 圆点。右键菜单的目标行另加 `line-strong` 内描边，和当前文档区分开。
  - 拖放移动、展开状态、`expandPath` 和 `highlightPath` 沿用现有逻辑。
- 自然排序：
  - 新增 `src/model/natural-order.ts`，导出 `compareDocumentPaths(a, b)`。它按路径逐段比较，段内识别中文数字（〇一二三四五六七八九十百千万，包括「第N章」「第N卷」）和阿拉伯数字，按数值比较，其余部分退回 `Intl.Collator('zh-CN', { numeric: true })`。
  - `project-files.ts` 的 `sortDocumentPaths` 改用它，`sortChapterPaths`、导出顺序、拆章与合章判断上一章和下一章，因此同时修正。树的 `orderTreeEntries` 也改用它。
  - 必须补测试：`第二章` 排在 `第一章` 之后，`第十章` 排在 `第九章` 之后，`第十一章` 排在 `第十章` 之后，`第2章` 排在 `第10章` 之前，中文数字与阿拉伯数字混排时数值相同就按原排序器比较。
  - Host 端（novel-kernel、workbench）的章节顺序不在本阶段范围内，交接报告里列出它们的现状。
- 右键菜单按对象类型给出，菜单从点击位置弹出：
  - 正文章节（`isManuscriptChapterPath`）：打开、钉在旁边、拆章、合并到上一章、与下一章合并、重命名、复制、剪切、粘贴、删除。
  - 其他文本文档：打开、钉在旁边（或取消钉住）、重命名、复制、剪切、粘贴、删除。
  - 图片和其他资料：在资料栏预览、重命名、复制、剪切、删除。
  - 目录：新建文档、新建文件夹、导出此目录、重命名、粘贴、删除。
  - 删除一律用 `tone: 'danger'`，并保留现有的确认流程。
- 窄窗：文件栏改为左侧 `Drawer`，标题「文件」，关闭按钮的可访问名称沿用现有文案。
- 状态提示（`createNote`、`workspaceWarning`、`workbenchNote`）改用 `Notice`，显示在树的上方，规则不变：失败时用 `role=alert`，成功提示短暂显示后自动消失。

## 4. 稿纸外围（4.3，`app/paper/` 与 `dsh-manuscript`）

- **稿纸列**：
  - 背景为 `paper`，不做成卡片。
  - 版心两侧各有一条 1px 的 `margin-rule` 竖线，用伪元素画，位置跟随版心宽度（`paperWidth` 为 narrow、medium、wide），不能遮挡选区和光标。
  - 标题下方有一条 `line` 天头线。
- **页眉**（在稿纸内）：
  - 页眉不显示标题文字，只在右侧放「⋯」稿纸菜单，即原标题栏菜单。2026-10-13 复核时修订：正文自己的一级标题已经是章节名，页眉再显示标题会重复。
  - live preview 中，一级标题（`#`）就是章节标题：`font-display` 26px，常规字重，居中，下方是天头细线。光标所在行仍然显示原文 `#`。二到四级标题保持无衬线、600 字重。
  - 页眉跟随稿纸滚动，不吸顶。
- **段间空行**：live preview 中，夹在两个非空行之间的空行，高度收为 `paragraphSpacing`（em）；光标落在空行上时恢复正常行高。审计第 4 条的段距失控主要来自这些空行。文本本身不改。
- **页脚**（在稿纸内）：
  - 吸附在可视区底部，居中，12px，`muted`。
  - 内容为「N 字」和保存状态（已保存、保存中、未保存、冲突），两段用间距分开，不用中点连接。
  - 冲突状态改用 `Notice`，提供「重新载入」和「另存冲突副本」两个操作，行为不变（契约 C14）。
- **稿纸右键菜单与「⋯」菜单**：
  - 顺序：光标处补全（`Ctrl+Enter`）、选段改写、查相关资料、选中当前段落、钉在旁边；分隔线；「编辑」子菜单（撤销、重做、剪切、复制、粘贴、全选）；查找（`Ctrl+F`）、替换（`Ctrl+H`）。
  - 每项都显示 `shortcut`。
  - 所有命令本身复用现有的 editor handle 方法，不改变行为。
- **选段改写**：
  - 用就近浮层代替现在的改写模态窗和预设栏。浮层是 `Popover`，锚点是 CodeMirror `coordsAtPos` 算出的选区下沿，以虚拟元素定位。
  - 浮层内容：一行预设标签（复用现有 `rewrite-presets`），一行指令输入框（`Input`，组字时按 Enter 不提交），以及「改写」和「取消」两个按钮。
  - 提交后的预览和接受流程不变。
  - 浮层不能遮住选区本身。下方空间不够时翻到上方。
- **默认排版**（只改默认值，作者已保存的值不受影响，契约 C41）：
  - `paragraphSpacing` 默认值从 0.4 改为 0.25。shell 的 `writing-config.ts` 与 `writing-settings.tsx`、manuscript 的 `typography.ts` 和 editor-core 的 `styles.ts` 都要改，对应 spec 同步更新。
  - 新增写作偏好 `firstLineIndent: boolean`，默认 `false`；为 `true` 时正文段落首行缩进 2em。
  - 新增写作偏好 `centerSectionMarks: boolean`，默认 `true`。
  - 两个新偏好的 schema 与 `paragraphSpacing` 写法一致，都标 `.volatile()`，并在 `writingTypography` 中透传。
- **分节符**：`centerSectionMarks` 开启时，live preview 把单独成段、且只含中文数字或「*」「＊」「※」「◇」的段落显示为居中的 `font-display` 18px，上下各留 1.5em。只改装饰，不改文本；光标进入该行时显示原文，与现在标题的 live preview 规则一致。实现在 `dsh-manuscript` 的 live preview 装饰里，需补 spec。
- **`dsh-manuscript` 的外观**：`editor-chrome.tsx`、`client/index.tsx`、`selection-diff.tsx` 不能依赖 shell 私有组件。按钮改用 seats 的 `SeatButton`，颜色只用 `--s-*` 或 `--dsh-ui-*`。`themes.tsx` 中独立 Web 模式的 Radix `Theme` 暂时保留（第 6 阶段处理），只把颜色降级值改为来自 seats 的降级 token。
- **`CENTER_OVERLAYS_SLOT`**：按 seats 合同，仍放在稿纸单元格里，覆盖稿纸。外框只提供底色和边距，不加标题栏。插件自带标题和关闭按钮，宿主再加一条会重复。外框不改变插件内容。
- **钉住对照**（`PinnedPane`）：移到辅助栏「资料」页。资料页顶部是一个 `SegmentedControl`，选项为「钉住」和「预览」，只在两者同时存在时显示。

## 5. 搭档栏（4.4，`app/assistant/`）

- **辅助栏外框**：
  - 顶部 `Tabs` 分「搭档」「资料」「工具」三页。只有当前没有任何工具插件时才隐藏「工具」页签。当前页签显示 2px 黛蓝下划线。
  - 底色为 `chrome`，栏内不再套白卡片。
- **搭档页头**：
  - 左侧是对话标题，后面跟一个箭头。点击打开 `Popover` 形式的对话列表，复用 `chat-history.tsx` 的逻辑：置顶在前，三种筛选，行内提供重命名、置顶、归档、恢复，规则不变。
  - 右侧是 `SplitButton`「新对话」：主按钮用上次使用的模式直接新建，菜单列出全部模式。上次模式记在 `localStorage` 的 `dsh-editor.chat.last-mode`；没有记录时，与现在第一项默认模式相同。
  - 原有的模式选择模态窗删除。
- **消息**：
  - 作者消息右对齐，`bubble` 底色，`radius-xl`。
  - 搭档回复是普通正文，不套卡片，`chat-markdown` 的排版规则保留。
  - 执行记录用 `Disclosure` 折叠成单行，显示真实状态（运行中、完成、失败），失败时默认展开。
  - 提案卡、回执、冲突与过期都用 `raised` 加 `line-strong` 的平面卡片。提案卡顶部写明操作类型、路径和摘要；中间是 diff；底部依次是主按钮「应用修改」、次按钮「放弃」，以及依据行。这些行为不变（契约 C10、C11）。
  - 原生提问和 `CHAT_EVENTS_SLOT` 保持原位置。
- **空状态**：
  - 显示三条起步建议，`《X》` 是当前文档标题，没有当前文档时用作品名：「审读《X》的节奏」「检查《X》里的人物称呼是否前后一致」「为《X》之后的情节列一份提纲」。
  - 点击建议只把文字填入输入框并聚焦，不发送。
  - 输入框始终锚定在底部（契约 C35，补测试）。
- **Composer**：
  - `TextArea`，自动增高到最多 8 行。
  - 工具条依次为：模型芯片（复用 `chat-model-picker`，名称过长时截断，`title` 显示全名）、思考档位芯片、`OFFICIAL_INPUT_SLOT` 语音位（沿用现有的单挂载点、双位置规则）、发送或停止按钮。
  - `shouldSubmitComposer` 和 `canSubmitComposer` 的规则不变（契约 C20、C21）。
  - 焦点时整体使用 `elevation-focus`。
- **草稿未发送就离开**：确认流程不变（契约 C17）。新增测试：有草稿时离开会弹出确认；取消后留在原处，草稿保留。
- **启动按钮**：辅助栏收起、又不在专注模式时，在稿纸右下角显示一个带文字「搭档」的 `Button`（`secondary`，加图标），取代没有文字的鲸鱼图标按钮。能力加载中和加载失败两种状态改用 `Notice`。

## 6. 首页（4.5，`app/home/`）

- 版式参考 B 示意 `home.html`：
  - 顶部是「继续写作」区，显示最近作品的名称（`font-display` 22px）、最后打开的章节标题和一行摘录，以及主按钮「继续」。
  - 下面是最近作品列表，样式像书的目录：作品名用楷体，点线引到右侧对齐的信息；第二行用 `muted` 显示最后编辑时间和章节，两段分开排，不用中点连接。
  - 右上角是「新建作品」和「打开作品」两个按钮。
- 移除、重定位、路径兜底、待处理的打开意图、导入，这些流程原样复用 `useRootWorkspaces`。
- 删除大吉祥物。品牌标识只在顶栏左侧保留一个小号标志。

## 7. 设置与插件（4.6、4.7，`app/settings/`）

- **形态**：
  - 设置是一个全页视图。打开时工作台保持挂载，但设为 `inert` 并隐藏，与现在 `PluginWorkspace` 的做法相同，编辑器实例不重建（契约 C40）。
  - 顶栏左侧是「返回写作」，后接页面标题；视图开关在这里隐藏。
  - Escape 关闭设置，焦点回到打开设置的按钮。
- **入口**：
  - 设置按钮、`Ctrl+,` 和 `openSettings(tab)` 打开对应分区。
  - `layout.selectPanel('plugins')` 打开「插件」分区，`selectPanel(null)` 关闭设置。`panelInfo` 的发布语义保持不变。
- **左侧导航**（`ListRow` 加分组标题）：
  - 写作
  - 模型
  - 助手
  - 外观与语言
  - 快捷键
  - 插件：已安装、发现、安装与卸载；插件配置项按现有规则列在下面，并附配置搜索
  - 用量
  - 关于
  - 高级：带警告图标，文字为中性色
- **内容归属**（只是搬家，控件行为和写入契约不变）：
  - 写作：现有写作设置，加上新增的首行缩进和分节符居中。右侧是实时预览栏，用一段示例正文实时反映字体、字号、行高、段距、纸宽、首行缩进、分节符。设置项改用 `Slider`、`SegmentedControl`、`Switch` 整行组件，开关命中区达标（审计第 18 条）。
  - 外观与语言：原通用设置里的界面语言、外观（浅色、深色、跟随系统）。
  - 助手：原有内容，加上原通用设置里的「搭档忙碌时的发送方式」。
  - 高级：原通用设置里的「审阅豁免」「破限模式」（保留卡片、常驻免责声明和开启确认框）、「开发者选项」。
  - 模型、快捷键（官方组件的宿主框）、用量、关于：内容不变，换外观。
- **插件**：
  - 「已安装」页是唯一的插件清单。它复用 `plugins-catalog` 的三类目录和写作模式分组，开关统一用 `Switch`。
  - 单字占位图标换成统一的类型图标：官方用 DSH 标志，内置用稿纸图标，用户插件用拼图图标。包名只显示在详情里。
  - 「发现」页是现在的发现插件；搜索词只在本页生效，不再影响「已安装」页（审计发现的问题）。
  - 「安装与卸载」页是官方管理器座位的宿主框，作为次级页保留，内部不改。顶栏的「添加插件」放到「已安装」页的右上角。
- 设置弹窗固定高度的契约（C36）随弹窗形态一起取消，在行为契约文档中更新这一条。

## 8. 全局浮层（4.8）

- **命令面板**：
  - 继续用 cmdk，外观换成新组件。
  - 分组顺序调整：当前文档相关的写作命令最前，然后依次是视图、作品、插件命令、文件跳转。
  - 主题切换作为一条命令放进去。
  - 最后一项被裁切的问题要修好，探针 `lastItemClipped` 应为 `false`。
- **对话框**：确认、文字输入、新建作品、导入、导出、历史与回滚、路径兜底、查相关资料，全部改用 `Dialog` 或 `ConfirmDialog`，交互不变。
- **导出预检**：
  - 按目录分组列出文档，每个目录一个 `Checkbox`，默认只勾选「正文」；没有「正文」目录时全选。
  - 顺序使用自然排序。
  - 格式改为一个 `SegmentedControl`，选项为 Markdown、TXT、DOCX、EPUB，再加一个主按钮「导出」。
  - `prepareExport` 只接收勾选的文档，函数本身不改。
- **更新提示与官方覆盖层**：更新提示改用 `Notice` 加 `Toast` 的位置规则；`shell.overlay` 原样保留。

## 9. 测试钩子与文案

- 新组件不再使用旧类名。e2e 只通过 `selectors.mjs` 定位元素。如果一条断言依赖的旧行为已按本文改变（例如主题切换移出顶栏、设置不再是弹窗），就按新行为改写，不能删除断言了事。
- 新增或修改的 i18n 键，中英文必须同时提供。产品文案用简短的平实中文，按钮写清楚动作，例如「应用修改」「继续」「导出」。

## 10. 每个子项的门禁

- 都要跑：shell 类型检查、相关 spec、`pnpm build`、`check-ui-drift`（以 `20a3558` 为基线，新增违规必须为 0）、`check-ui-design`、`e2e/ui-design.mjs`。
- 按子项加跑：
  - 4.1、4.2：`core-loop`、`writing-shortcuts`、`desktop`、`.dev/redesign/flows.mjs`。
  - 4.3：`core-loop`、`proposal-receipts`。
  - 4.4：`core-loop`、`proposal-receipts`。
  - 4.6、4.7：`settings-ui`（axe 违规数不得增加）、`settings-lifecycle`、`plugins-page`。
  - 4.8：`core-loop`。
- 截图：受影响的界面在 1440 浅色、1440 深色、1024、760、390 五种状态下各截一张，与基线并排，复制到 `%TEMP%\dsh-redesign\p4-<子项>\`。
