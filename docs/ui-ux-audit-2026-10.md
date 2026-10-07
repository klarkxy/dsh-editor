# UI/UX 实测记录（2026-10）

本文记录这一轮前端 UI/UX 改动**在真实前端里测出来的**结论、数字和仍未解决的问题。判断以本文和代码为准：早期草稿（`.artifacts/frontend-ux-20261007/analysis/`）里有 33 条没有复现的「问题」和若干没有执行过的「通过」，不作为依据。

## 测量方式

这些脚本都启动隔离的 DSH 运行时，用自己的 home 和项目目录，操作同一个真实前端，全程不请求模型、不读写真实作品：

| 脚本 | 作用 | 产物 |
| --- | --- | --- |
| `.dev/frontend-ux-20261007/observe.mjs <label>` | 走一遍首页、稿纸、对话、命令面板、设置、暗色与窄窗，逐屏截图并审计命中区、可访问名、溢出、覆盖层、小字号 | `.artifacts/frontend-ux-20261007/<label>/` |
| `.dev/frontend-ux-20261007/probe.mjs <label>` | 定点测量对话区、面板分隔条、命令面板、设置结构、窄窗接管 | `.artifacts/frontend-ux-20261007/<label>/` |
| `.dev/frontend-ux-20261007/rails.mjs <label>` | 真点顶栏开关，走完辅助栏的展开/收起/变宽恢复/重载读回 | `.artifacts/frontend-ux-20261007/<label>/` |
| `.dev/frontend-ux-20261007/narrow-boot.mjs <label>` | 只走窄窗启动这一段生命周期：两栏偏好都是 true，缩到 700 后手动开文件栏，**仍在窄窗直接 reload**，再看偏好与变宽恢复 | `.artifacts/frontend-ux-20261007/<label>/` |
| `.dev/frontend-ux-20261007/diag.mjs <label>` | 一次启动里集中量溢出元素、390px 作品菜单和设置开关命中区 | `.artifacts/frontend-ux-20261007/<label>/` |

运行前需要 `pnpm --filter dsh-editor-shell build` 与 `node scripts/prepare-desktop-dev.mjs`，否则浏览器加载的是上一次构建。

## 已修并且复测通过的问题

### 窄窗下的辅助栏让位（回归）

上一版把「窗口变窄导致收起」当成作者选择处理：`toggleSidebarChrome` 清空让位标记后，紧随其后的宽度结算立刻把刚展开的面板关掉。纯函数层面可直接复现：

```
railAtWidth(railByAuthor(true), crowded) → open:false
```

作者在窄窗点「文件」没有反应。修复在 `src/client/narrow-layout.ts`：状态补上 `crowded`（当前档位）与 `authored`（作者在当前档位下接管过），结算先看接管再看让位；换档后接管作废，规则重新接手。窄窗下两条栏互斥时走 `force`，压过接管。

`rails-final` 里 36 条断言全部通过，0 条 console error，覆盖：窄窗自动收起且不写坏偏好、窄窗手动展开后 1.2s 仍展开、窄窗手动收起后变宽不弹回、覆盖档搭档显式展开站得住、窄窗两条栏互斥、变宽双向恢复、刷新后按偏好读回、刷新后窄窗仍能让位且手动展开仍站得住。

同一处 `settleRail` 原来对两条栏都置 `skipPersist`，会让另一条栏的下一次真实开合不再落盘。现在只跳过自己那一条。

### 窄窗启动会永久篡改搭档栏布局偏好

这一条 `rails.mjs` 的 36 条断言全绿也没有覆盖到：它们只在宽窗重载（1440），窄窗重载是另一段生命周期。复现（`boot-before`，修复前）：

```
narrow-700-before-reload    files:true assistant:false storedFiles:true storedAssistant:true
narrow-700-after-reload     files:true assistant:false storedFiles:true storedAssistant:false   ← 偏好被写坏
wide-1440-after-reload      files:true assistant:true  storedFiles:true storedAssistant:false
```

原因是「跳过一次落盘」这个形状本身错了。`skipAssistantOpenPersist` 是一个待消费的布尔量，而挂载时宽度结算与落盘副作用在同一次提交里按声明顺序执行：结算先置 `true` 并 `setAssistantOpen(false)`，落盘副作用紧接着跑到，看到标记就把标记消费掉、跳过写入——可它这一轮拿到的还是**旧值** `true`，本来也无需写。下一轮提交让位后的 `false` 真正到达副作用时，标记已经没了，于是落盘 `false`。侧栏没被写坏，是因为换作品的读取副作用随后又把存下的 `true` 读了回来，等于自己修复了自己；搭档栏没有这条回读路径。

修法不在标记的用法上，在归属上：`src/client/root.tsx` 现在记录「当前这个 `open` 值是不是作者的选择」而不是「下一次要不要跳过」，`claimSidebar` / `claimAssistant`（作者显式开合）是唯一把落盘权交还作者的地方，宽度结算和单稿件自动收起只置位不清零。顺带补齐了此前没有声明归属的五处作者操作：Esc 关闭覆盖层抽屉、聊天区的隐藏按钮、搭档覆盖层与文件覆盖层的关闭按钮——它们在旧实现下会写入（因此不是新行为），现在只是把「作者的选择」这件事显式说清楚。

修复后（`boot-after`）：窄窗重载前后 `storedAssistant` 都是 `true`，变宽后搭档按偏好展开；紧接着在窄窗显式收起搭档仍然正常写入 `false`（19 条断言、0 console error），说明偏好没有被冻住，作者随时能改。

同一脚本补了只让搭档让位的档位：900px 下文件栏仍停靠、只有搭档收起，此时重载同样不写坏搭档偏好（`narrow-boot-final` 共 24 条断言，0 console error）。也就是说这段生命周期在两个档位上都验过，不是只验了 700。

### 390px 下够不到作品菜单

`@media (max-width: 760px)` 里 `min-width: 0 !important` 压掉了 `.workspace-chrome` 的 8.5rem 下限，而该元素还带着一份与样式表重复的内联 `minWidth`，普通规则压不动它。实测 390px 下 `.workspace-chrome` 只有 3px、作品菜单完全不可见——新建/切换作品/返回首页/导出都点不到。同时命令面板的 `Ctrl+Alt+K` 脚注是顶栏最宽也最不重要的元素。

修复：删掉重复的内联样式（宽度规则只留样式表一处），窄窗下先隐藏快捷键脚注，作品菜单保留 `min(7em, 22vw)` 的命中区、标题截断。修复后 390px 下 `.workspace-chrome` 86px，八个控件互不重叠。

### 字号与命中区

- 顶栏 `Ctrl+Alt+K` 实测 9px：`.palette-trigger-kbd` 是 Kbd 自己，之前的规则写在外层按钮上，没命中。改为 12px。
- 面板分隔条从 8px 加宽到 12px（绘制的分隔线仍是 1px），搜索框从 30px 高提到 32px。
- 对话输入框从 23px 高提到 48px 起步。
- 设置窗口改为按内容定高、上限封顶，短页面不再留 106px 空尾（实测 24px），设置导航分组标题改用字号与字重区分。
- 侧栏标题行：标题先截断，创建按钮与更多菜单不缩。

### 对话空状态

上一版在空对话时把输入框提到栏顶，输入框下方留一屏空白，并且第一条消息到达时输入框会从顶部跳到底部。已回退为空与非空一致的底部锚定，见 `ui-design.md` 的 Layout and hit targets。

## 仍然存在或无法确认的问题

- **设置里的开关只有 35x20px**，低于 32px 命中区下限。试过用伪元素扩展命中区，实测点击开关中心上方 9px 不触发，已回退；这一条没有解决。
- **`scrollWidth > clientWidth` 的审计噪声**：`.chat-header-actions`、`.side-title` 的操作组等是 `overflow: visible` 的 flex 行，盒模型上「溢出」，截图里没有裁切或重叠。这类条目按测量假象处理，不要当缺陷修。
- **模型流式、写入与审批**：本轮没有请求任何模型回合，提案/审批的交互没有实机验证。

## Electron 下的顶栏（主协调者补验，已通过）

前面所有窄窗测量都只在 Chromium 里做，Electron 顶栏还要让出窗口控制的宽度，这是当时唯一悬着的布局风险。最终构建已在真实 Windows/Electron 中补验，覆盖 1440 / 1024 / 760px 三档、长中文作品名，结果是三颗真实窗口控制按钮存在、顶栏所有入口都在窗口内且互不重叠、作品菜单每档都能实际打开：18 条断言全部通过，运行中 0 页面错误，自有 Electron 进程正常退出、DSH 端口释放。报告与截图在 `.artifacts/frontend-ux-20261007/acceptance/native-topbar-visible/`（`report.json`、`native-1440.png`、`native-1024.png`、`native-760.png`），原始日志 `native-topbar-final.log` 退出码 0。

这次只验证了**可见与可点**：最小化/最大化按钮的动作本身、物理输入法、DPI 缩放、安装版以及模型调用都不在这次范围内，仍属未验证。

## 最终验收收据

最终一次验收的事实如下（原始表在 `.artifacts/frontend-ux-20261007/acceptance/verification.md`；这些是本地构建产物路径，随工作区存在，不是发布后仍可访问的链接）：

- 全量测试 1659 通过、4 跳过；全包类型检查与构建通过；
- 设计检查 14 项、组件夹具（`e2e/ui-design.mjs`）通过；
- 真实 DSH 主流程通过，辅助栏 40 条断言全部通过，其中包含修复前失败过的窄窗启动偏好项（G2）；
- 源码摘要验证无变化：验收期间产品源码没有再被改动。

这份记录里仍然成立的两条边界：设置开关的 35x20px 命中区是现存改善项，没有解决；真实模型回合、提案与审批交互始终没有实机验证。

## 复现命令

```sh
pnpm --filter dsh-editor-shell build
node scripts/prepare-desktop-dev.mjs
node .dev/frontend-ux-20261007/observe.mjs after
node .dev/frontend-ux-20261007/probe.mjs probe-after
node .dev/frontend-ux-20261007/rails.mjs rails-final
node .dev/frontend-ux-20261007/narrow-boot.mjs narrow-boot-final
```

同轮的其他门禁：`node --test scripts/check-ui-drift.test.mjs`、
`node scripts/check-ui-drift.mjs --base <任务起点>`、
`node scripts/check-ui-design.mjs`、`node e2e/ui-design.mjs`、
`npx vitest run packages/dsh-editor-shell/src`。
