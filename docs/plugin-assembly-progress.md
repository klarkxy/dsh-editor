# 声明式拼装与 Shell 座位：实施与验收记录

> 历史记录：本文保留文中日期、版本和当时验证结果，不代表桌面 0.2.0 的当前入口或发布状态。当前说明见 [文档索引](README.md)，本轮验证见 [0.2.0 验收记录](release-0.2.0.md)。

2026-09-10。本轮在[上一轮拆分](plugin-modularization-progress.md)之后完成，目标是把“拼装”从硬编码清单变成声明式，把 Shell 从胖宿主变成布局宿主，并用垂直插件验证这条路径。使用方式见[组合指南](plugin-composition-guide.md)，接口见[插件架构](plugin-architecture.md)。

## 诊断结论

原有包级边界干净（无跨包 `src` 导入、依赖图无环、可选服务走 `ctx.provide/get`），但三处不满足高内聚 / 低耦合：

| 问题 | 证据 |
| --- | --- |
| 拼装靠硬编码 | 加一个插件要改约 35 处：`DESKTOP_PACKAGE_NAMES` / required 列表、两份重复的 `PROTECTED_PACKAGES`、`ENTRY_CATALOG`、`configureProfile` 写死的 `zhihu-tools` YAML、Shell 封闭的 `{assistant, completion, zhihu}` 三元组、e2e 复制的清单；不在目录里的新 entry 被插件管理器归为 hidden 且锁定 |
| Shell 是胖宿主 | 校对 / 卡片 / 概览 / 记忆面板与聊天卡片硬接 `/dsh-editor-workbench`；唯一座位 `dsh-editor.extensions` 只给空上下文；侧栏、命令、快捷键无注册表；`settings-zhihu.tsx` 535 行孤儿、记忆面板永远打不开 |
| Workbench 一根 channel 43 个 endpoint | if 链分发器、四份复制的 access bag、sidecar IO / no-replace move 散落、877 行 contracts barrel |

结论：继续拆，但方向不是更多 npm 包，而是拼装声明化、Shell 退化为布局宿主、按垂直切片迁出面板；archive / snapshot / proposal / memory 共用归档原语，保持一个变更核心不拆。

## 已落地

| 批次 | 内容 |
| --- | --- |
| A 声明式拼装 | `dshEditor` manifest；`scripts/plugin-manifest.mjs` resolver（校验声明与 `cordis.patch.yml` 一致、依赖闭包、`libraries`）；recipe 改 feature 集合；插件管理器运行时读 `dshEditor`；Shell `capabilities.get` → `{ features }`，源码零服务名 |
| B 清理与内聚 | 删 Shell 知乎孤儿与无引用 i18n/CSS；manuscript 测试不再导入 `dsh-zhihu`；kernel 删未注册工具；workbench 抽 `kit/`、contracts 按簇拆文件 |
| C Shell 座位 | `dsh-editor.sidebar.tools` 带上下文座位 + `dshEditorCommands`；作品校对面板迁出为 `dsh-editor-proofread-panel` |
| D workspace-kit | 私有进程内库位于 workbench / cards 之下；resolver 用 `libraries` 复制纯库但不作为 bundle |
| E cards 垂直包 | `dsh-editor-cards`：`/dsh-editor-cards` Host（与 workbench 共用 `withWorkspaceWrite` 同一模块实例）+ contracts + `host-api`（workbench 校对扫描调 `listCards`）+ 侧栏列表 / 中栏详情 / 两条命令；workbench 与 Shell 不再含 cards 代码 |
| F overlay 座位 | `dsh-editor.center.overlays`；`dsh-editor-overview-panel`、`dsh-editor-memory-panel` client-only 包；记忆维护面板重新可达 |
| G seats 库 | 座位合同独立为 `dsh-editor-seats`（浏览器安全、构建时内联），消除 shell↔cards 依赖环 |
| 收口 | workbench 分发器改 handler 表（端点、写入门禁、authority 顺序不变，派生的 mutation 集合与原列表逐项相等）；`dshEditorMessageCards` 注册表，`novel_memory_update` 卡由 memory-panel 贡献；删除 `/manuscript zhihu.usage` 与 `/novel-kernel` 旧转发 |

修复的一个既有回归：中栏 overlay 落在侧栏列且稿纸不隐藏。根因是稿纸根元素带内联 `display:flex`，样式表 `display:none` 永远输给它；渲染器包裹层为 `display:contents`，插件根元素成为网格项却无 `grid-row`。现在插件打开时给根元素加 `CENTER_OVERLAY_ATTRIBUTE`，Shell 用属性选择器放格并以 `!important` 隐藏稿纸，插件不再写 grid 规则或引用彼此类名。

## 验收

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` / 清空 lib 后 `pnpm build` | 通过（15 个工作区项目） |
| `pnpm vitest run` | 111 文件 / 878 项通过 |
| `pnpm pack:plugins` | 三个公开 tarball 校验通过；桌面私有包名自动列为公开产物禁用 token |
| `e2e/compositions.mjs` basic / full（真实 DSH + Chromium） | 通过：capabilities 为 `features` 映射、安装集合含新包与 kit、`cards.create` 走新 channel、basic 无 Chat/AI 请求、重载无重复贡献、无浏览器错误 |
| 运行时座位探针 | 11 项通过：Ctrl+Shift+L / Ctrl+Shift+O / Ctrl+Shift+C 分别打开校对、概览 overlay、卡片面板；命令面板列出注册命令；UI 新建人物卡并点选打开中栏详情（占稿纸列、稿纸隐藏）；`/dsh-editor-cards` 应答且 workbench 拒绝 `cards.*`；命令面板打开记忆维护 |
| 独立只读评审两轮 | 真实发现均已修复（inspect 座位白名单、`entry-collision-optional` 测试、孤儿 i18n、缺失 CSS、文档过期措辞）；两轮各报的“删除未发生”经磁盘核实为评审侧索引陈旧 |

未跑：Electron 版 e2e（`verify:desktop`、portable、feature-coverage）与 `pack:desktop`。上游 `renderSlot` 类型未承诺 owner→props 传递，靠运行时探针保证；升级 DSH 时重跑。

## 规模

Shell 21.3k → 约 18k 行，`root.ts` 不再含业务面板；Workbench 10.9k → 约 9.3k；新增 cards 2.5k、三个面板包 2.4k、kit 1.3k、seats 0.3k。工作区从 8 个包变为 15 个（含 2 个库）。

## 为什么到此为止

- 独立启停有意义的功能都已是独立包；再切 search、chapter-ops、snapshot / archive / import / proposal 会把一个交互或一个变更核心切成互相 import 的两半。
- 接缝已收敛：四个插件用同一条路径接入（`dshEditor` + 座位 + 注册表），新增功能应当以“再加一个垂直插件”而非“再拆一个现有包”进行。
- 运行时依赖无环，kit 在底、workbench / cards 在中、面板在上；Shell 剩余的业务知识只有稿纸、Chat 投影与三张 Shell 自有卡片、文件树状态标记、保存后计数、钉住面板只读调用。
