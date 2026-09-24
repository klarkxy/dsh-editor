# 给施工 Agent 的 UI 约定

目标：增加功能时沿用现有界面语言，避免每个 Agent 做出自己的皮肤。不是禁止改布局，也不是要求所有像素永久冻结。

## 1. 参考顺序与改动预算

用户明确的新要求 > 本仓库生产 tokens/基础组件及设计契约 > 当前 gallery 的真实渲染 > `ui-design.md` 锁定的官方 Kimi Web 历史来源。旧截图和示意图不覆盖现行代码；代码与已批准目标不符时修正偏差，不追着历史截图改。

**普通功能任务**：可按现有网格调整局部布局、增加必需控件/状态/文案、改善溢出和可访问性；不要顺带换配色、全局字号、圆角、阴影、图标体系、加载风格或工作台信息架构。

**跨页或全局外观任务**：需有用户明确目标。在 PR 中解释涉及哪些表面，改集中定义，补双主题示例及证据。未经请求不要借“统一风格”重写整个前端；也不必为每个正常局部间距修正反复请求确认。

## 2. 开工时的最短路径

1. 读根 `AGENTS.md`、相关包的指南和 `docs/ui-design.md`。用一句话记录使用场景与主操作，例如“在右侧给作者审阅改写提案，不打断稿纸输入”。
2. 在 `packages/dsh-editor-shell/src/client/ui/`、现有调用点、`src/design-system/gallery.tsx` 找最近的组件。工作台按 `Ctrl+Alt+Shift+D` 看生产组件的预览。
3. 将变化限定到必要的组件/原样式规则。先保存受影响页面的改前截图，再实现并对照。
4. 根据本页验收清单提交证据。不能运行界面时，明确标记视觉未验证，不用想象截图代替。

## 3. 有且只有一套视觉语言

完整数值以 `packages/dsh-editor-shell/src/design-system/tokens.ts` 为准，本指南不重复抄一份色表或尺寸表。

| 意图 | 使用现有语义 |
| --- | --- |
| 正文/辅助说明 | `--dsh-ui-text` / `--dsh-ui-muted`；必要说明不使用 faint |
| 内容/导航/浮层 | `--dsh-ui-bg` / `--dsh-ui-sidebar` / `--dsh-ui-raised` |
| 我在哪/鼠标经过 | `--dsh-ui-selected` / `--dsh-ui-hover` |
| 主操作与焦点 | 现有 primary 变体；焦点使用 accent，禁止整页染色 |
| 边框、圆角、留白、阴影、动效 | 现有 `--dsh-ui-line*`、`radius-*`、`space-*`、`shadow-*`、`duration-*` / `ease-*` |

不新增页面专属 hex/rgb 色、字体、字号、圆角、阴影、z-index 魔法数、远程字体、装饰渐变/玻璃/发光/持续跳动。不是所有值都得变 token：`min-width: 0`、`1px` 发丝边框、尺寸计算、拖动命中区、断点等结构性值可以保留，需说明其布局用途。

使用既有 `client/ui/index.ts` 封装或页面已经使用的 Radix 控件。不再造 `NewButton` / `FancyCard`，不为单页引入组件库。直接使用 Radix 的 `size`、`variant`、`color` 语义 props 是允许的；不要以裸控件重新实现 Dialog/Select 的键盘行为。

### 可沿用的写法

在 `src/client/` 内，以下 props 对应现有封装；`onChange` 接收字符串，不是 DOM Event：

```tsx
import { Button, Input } from './ui/index.ts'

<Input value={name} onChange={setName} aria-label={t('chat.conversationName')} />
<Button variant="primary" disabled={!canSave || saving} onClick={save}>
  {t('chat.saveName')}
</Button>
```

在现有 `src/design-system/styles.ts` 中为新部件增加语义映射，而不是复制一段全局 CSS：

```ts
uiRule(['.proposal-summary'],
  'color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);')
```

不采用 `style={{ color: '#777777', borderRadius: 11, zIndex: 99999 }}`，也不靠重复选择器或 `!important` 压过旧规则。布局计算可局部表达；产品外观仍归集中适配层。

## 4. 交互与布局不能悄悄退化

稿纸是主体；辅助区变窄时处理换行、截断/完整提示、抽屉，不压缩关键操作到不可用。普通回复用文本与留白；工具细节可折叠；失败、审批、冲突和作者必须决策的信息始终有明确入口。加载、失败、空、禁用和成功都要有真实状态；不虚构百分比或“已写入”。

主题切换不更换编辑器 key；不重置草稿、滚动或排版偏好；中文组字中的 Enter 不发送。不改审批、版本校验和自动保存来迁就外观。状态同时有文字/图形，不只靠颜色。

弹窗/菜单沿用焦点、Escape、焦点返回与 portal 契约。覆盖层和工具栏不能挡住正文输入或原生窗口命中区。减少动态效果与 forced-colors 保留可用状态。

插件也遵守同一视觉语义，但 shell 的 `uiRule()` 不能穿透 `[data-dsh-plugin-surface]`。插件内部通过已有主题/控件接入，独立 DSH 宿主继续使用该宿主可用的 token，不强制依赖 Editor 私有包。不要以“插件隔离”为理由另造装饰主题。

## 5. 防偏移检查与限制

```sh
# 检查器本身的回归用例，不请求模型或修改工作区
node --test scripts/check-ui-drift.test.mjs

# 比较任务起点/目标分支与当前工作树，含 staged、unstaged、untracked
node scripts/check-ui-drift.mjs --base origin/main

# 比较明确的提交，CI 使用 PR base SHA 与已检出的 HEAD
node scripts/check-ui-drift.mjs --base <base-sha> --head HEAD

node --experimental-strip-types scripts/check-ui-design.mjs
pnpm build
pnpm typecheck
pnpm test --maxWorkers=2
pnpm exec playwright install chromium
node e2e/ui-design.mjs
```

增量检查覆盖 `packages/` 与 `apps/` 下的产品 TSX/CSS 和 client/style/theme 相关 TS/JS；跳过测试、夹具、产物。它对比同一文件的规则/字面量次数：现存问题不要求此时全清，但新增相同坏写法、换一个新字面值仍会失败。重命名按新文件对待，不能借移动保留新违规。

集中 `design-system/tokens.ts` 和 `design-system/styles.ts` 由原设计契约测试与视觉审查负责，不受局部字面量检查约束。检查器是启发式防线，不是完整 CSS/TS 语义分析或像素差异审查；不能捕获所有 named color、计算样式、DOM/信息层级或布局退化。字体/布局的真实观感仍需下节人工检查。

基准不存在时会失败，不自动忽略。没有自动“接受当前全部变化”、内联忽略注释或重置基准的命令。误报先核对语义和 token；确需新增例外时，在专门的设计变更中说明范围并补测试，不能删除规则、移入被排除目录或降低断言来通过。

## 6. 完成定义与交接

截图来自实际浏览器/应用，不是生图；注明提交、页面、视口、主题、状态。对同一受影响页面比较改前/改后，浅色和深色都看。截图基准更新必须解释差异，不能批量覆盖后宣布通过。

检查：正常/hover/focus/active/disabled/loading/error/empty；键盘操作、焦点返回、长中文标题、超长内容、插件与 portal；1440/1024/760/390 宽度中适用的布局。全局变动还要检查非目标页面，例如新增工具卡不能改变设置按钮或文件树。

涉及完整写作/桌面流程时，另查 CodeMirror 中文 IME、实际流式会话、保存冲突、100/125/150% 系统缩放和窗口控件。`e2e/ui-design.mjs` 的组件夹具及其截图不能冒充完整桌面验证。

PR 交接必须有：场景/主操作、复用组件与 tokens、涉及表面、检查结果、改前/改后截图、未验证项、必要的例外理由。UI 无改动则写清依据，不要勾选未做的检查。新增基础变体同步 gallery 和测试；普通业务组件按需加入既有夹具，不另建展示应用。
