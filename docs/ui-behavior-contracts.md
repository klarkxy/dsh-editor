# 界面行为契约

本文登记前端必须保持的行为，供界面重写（`redesign/ui-v2`）和以后的界面改动核对。外观可以重做，下列行为不随外观改变；确需改变时须有用户的明确授权，并同步更新本表和对应测试。

「覆盖」列只登记现在能证明该行为的自动化检查；「缺口」表示目前只靠人工或仓库外的本地脚本（`.dev/`）验证，重写前须补上仓库内的测试。以 `src/` 开头的路径指 `packages/dsh-editor-shell/src/`，其余路径相对仓库根目录。

## 运行时与数据权威

| ID | 契约 | 实现位置 | 覆盖 | 缺口 |
| --- | --- | --- | --- | --- |
| C01 | DSH 是会话、模型、审批、权限与对话历史的唯一来源；前端不复制这些状态 | `packages/dsh-editor-shell/src/client.ts`、`src/client/ui-workspace.ts` | 架构约束，无单一测试 | 重写时以代码审查保证 |
| C02 | `client.ts` 的 `inject` 列表、`registerRoot` 声明的子插槽与 `layout` 服务形状不变 | `src/client.ts`、`src/root-registration.ts`、`src/client/official-layout.ts` | `src/root-registration.spec.ts`、`src/index.spec.ts` | 无 |
| C03 | seats 公开 API（插槽常量、服务、`CENTER_OVERLAY_ATTRIBUTE`、`Shell*Props`、注册表工厂、`./tokens`、`./seat-button`）向后兼容 | `packages/dsh-editor-seats/src/index.ts` | `packages/dsh-editor-seats/src/index.spec.ts`、`tokens.spec.ts` | 无 |
| C04 | 传给插件的 HOST_UI（Select、Dialog、Button、Input、TextArea）props 接口不变；控件由 `src/ui/` 原语实现 | `src/client/root.tsx` 的 `HOST_UI_OWNER`、`src/client/select.tsx`、`src/client/ui/controls.tsx`、`src/client/ui/dialog.tsx` | `src/client/host-ui.spec.tsx`（全 props 组合冒烟 + 可访问名）、类型约束、`src/ui/focus-return.spec.ts`、`e2e/layout-invariants.mjs` | 无 |
| C05 | CSS 变量兼容面：`--dsh-ui-*` 名称保留，`--s-*` 别名链保留，外部与官方插件使用的 `--dsw-*` 全部有值 | `src/design-system/tokens.ts`、`src/design-system/dsw-vars.ts`、`src/design-system/compat.ts`、`packages/dsh-editor-seats/src/tokens.ts` | `scripts/check-ui-design.mjs`（每个已扫描变量必须落入 DSW_MAP 或 DSW_PENDING，且清单经 `scripts/scan-dsw-vars.mjs --check` 复核为最新） | 无 |
| C06 | shell 的组件规则不进入 `[data-dsh-plugin-surface]`；插槽外层布局归宿主 | `src/client/root-columns.tsx`、`src/client/plugin-surfaces.tsx` | `src/client/plugin-surface-boundaries.spec.ts`、`plugin-surfaces.spec.ts`、`e2e/ui-design.mjs` | 无 |

## 写入与审批

| ID | 契约 | 实现位置 | 覆盖 | 缺口 |
| --- | --- | --- | --- | --- |
| C10 | 正文与大纲的修改先以提案呈现，作者确认后才写入 | `src/client/chat-proposal.tsx`、`packages/dsh-editor-workbench/src/proposals/` | `src/client/chat.spec.ts`、`src/client/planning-flow.spec.ts`、`packages/dsh-editor-workbench/src/proposals/proposal-ops.spec.ts`、`e2e/proposal-receipts.mjs` | 无 |
| C11 | 文件变化后拒绝旧提案与旧写入；部分完成如实报告 | `src/client/shared.ts` 的 `isStaleFailure`、workbench RPC | `src/client.spec.ts`、`packages/dsh-editor-workbench/src/index.spec.ts`、`rpc/index.spec.ts` | 无 |
| C12 | 离开文档、切章、离开作品前先保存；组字、冲突、失败与保存期间的新输入阻止离场 | `packages/dsh-manuscript/src/client/editor-core/save-before-leave.ts` | `save-before-leave.spec.ts` | 无 |
| C13 | 自动保存与草稿同步只保留最新一次排程 | `editor-core/draft-sync.ts` | `draft-sync.spec.ts` | 无 |
| C14 | 磁盘冲突提供重新载入与另存冲突副本 | `src/client/editor.tsx` | `e2e/core-loop.mjs`（部分） | 缺少不经界面的冲突处理测试 |
| C15 | 模型设置写入使用原设置 revision，冲突时阻止旧草稿写入 | `src/client/settings-models-state.ts` | `settings-models-state.spec.ts` | 无 |
| C16 | 搜索替换逐文件确认，跳过版本或匹配已变化的文件 | `src/search-replace.ts`、`src/client/search-panel.tsx` | `src/search-replace.spec.ts`、`src/client/search-panel.spec.ts` | 无 |
| C17 | 搭档草稿未发送时，切换作品或会话须确认丢弃 | `src/client/root.tsx` 的 `canLeaveAssistantDraft` | 无 | 缺少测试 |

## 输入与焦点

| ID | 契约 | 实现位置 | 覆盖 | 缺口 |
| --- | --- | --- | --- | --- |
| C20 | 输入法组字中（`isComposing` 或 `keyCode 229`）按 Enter 不发送、不提交搜索；`Shift+Enter` 换行 | `src/client/shared.ts` 的 `shouldSubmitComposer`、`src/client/ui/ime.ts` | `src/client.spec.ts`、`src/client/ui/ime.spec.ts` | 新 composer 与搜索框须接入同一判断 |
| C21 | 发送前置条件：已连接、会话存在、无进行中的发送；失败可重试 | `src/client/shared.ts` 的 `canSubmitComposer` | `src/client.spec.ts` | 无 |
| C22 | 弹窗保留焦点限制、Escape 关闭、关闭后焦点回到触发者或指定目标 | `src/client/ui/focus-return.ts`、`ui/dialog.tsx` | `src/client/ui/focus-return.spec.ts`、`e2e/ui-design.mjs` | 无 |
| C23 | 全局快捷键不抢占打开中的模态、重复按键与组字 | `src/client/official-shortcuts.ts`、`src/palette-shortcut.ts` | `official-shortcuts.spec.ts`、`src/palette-shortcut.spec.ts` | 无 |
| C24 | 原生输入框选区按最新可见选区与原生 revision 绑定，只恢复自己的绑定 | `src/client/official-input-selection.ts` | `official-input-selection.spec.ts` | 无 |

## 布局与偏好

| ID | 契约 | 实现位置 | 覆盖 | 缺口 |
| --- | --- | --- | --- | --- |
| C30 | 窄窗让位：窗口放不下时收起辅助栏并记住作者原选择，变宽后恢复；作者在当前档位的显式开合优先，换档后规则重新接手；两条覆盖栏互斥 | `src/client/narrow-layout.ts` | `narrow-layout.spec.ts` | 无 |
| C31 | `dsh-editor.layout.sidebar-open` / `assistant-open` 只能由作者操作写入；宽度结算与单稿件自动收起不写入；窄窗启动与重载不改写偏好 | `src/client/root.tsx`、`root-layout.ts` | 仅 `.dev/frontend-ux-20261007/rails.mjs`、`narrow-boot.mjs`（仓库外） | 缺少仓库内测试 |
| C32 | 跨断点后两条栏恢复作者记下的像素宽度；面板刚挂回时 `Layout not found` 不击穿渲染树 | `src/client/root-layout.ts` | `root-layout.spec.ts`、`narrow-layout.spec.ts` | 无 |
| C33 | 工具入口临时把承载工具的栏加宽到 336px，不写入宽度偏好；作者拖动后以新宽度为准。第 4 阶段起工具移到辅助栏「工具」页，本条改为作用于辅助栏 | `src/client/root-layout.ts`（第 4 阶段后为 `src/model/workbench-layout.ts`） | `root-layout.spec.ts`（第 4 阶段后为 `workbench-layout.spec.ts`） | 无 |
| C34 | 单稿件作品自动收起文件栏，直到作者选择；按作品记住 | `src/client/sidebar-chrome.ts` | `sidebar-chrome.spec.ts` | 无 |
| C35 | 空对话与非空对话的输入框都锚定在底部 | `src/client/chat.tsx` | 无 | 缺少测试 |
| C36 | （已取消）设置窗口在各页保持同一高度。第 4 阶段起设置改为全页视图，本条随弹窗形态一并取消，见 [Shell 重写规格](redesign/shell-rewrite-spec.md) 第 7 节 | — | — | — |
| C37 | 设置与插件共用同一全页视图：工作台原位保留但 inert+hidden，编辑器实例不重建；Escape 或「返回写作」关闭并把焦点还给触发者；`layout.selectPanel('plugins')` 打开插件分区、`selectPanel(null)` 关闭，`panelInfo` 发布语义不变 | `src/app/settings/settings-page.tsx` 的 `SettingsWorkspace`、`src/model/settings.ts`、`src/client/root.tsx` | `settings.spec.ts`、`e2e/layout-invariants.mjs`（编辑器身份 + Escape/焦点 + 溢出）、`e2e/settings-ui.mjs`、`e2e/plugins-page.mjs` | 无 |

## 稿纸与主题

| ID | 契约 | 实现位置 | 覆盖 | 缺口 |
| --- | --- | --- | --- | --- |
| C40 | 切换主题或主题色不更换编辑器 key，不重置草稿、滚动、选区或排版偏好 | `src/client/editor.tsx`、`src/client/theme.tsx` | `e2e/ui-design.mjs`（输入节点稳定） | 缺少稿纸实例级测试 |
| C41 | 作者的稿纸字体、字号、行距、段距、纸宽与补全设置不被外观改动重置；shell 与 manuscript 默认值一致 | `src/writing-settings.tsx`、`src/writing-config.ts`、`packages/dsh-manuscript/src/client/editor-core/typography.ts` | `src/writing-settings.spec.ts`、`src/writing-config.spec.ts`、`packages/dsh-manuscript/src/client/typography.spec.ts` | 无 |
| C42 | 主题偏好与宿主 `ui-theme` 双向同步；旧 paper/ink 值迁移 | `src/client/theme.tsx` | `src/theme.spec.ts` | 无 |
| C43 | 主色填充与其文字、正文与次要文字与所在表面、链接与稿纸之间，在明暗两种模式下对比度都不低于 4.5:1。G1 起主色固定为黛蓝，作者旧的主题色设置不再生效，但存储键保留不删 | `src/design-system/tokens.ts` | `scripts/check-ui-design.mjs`（重写后覆盖新 token） | 缺少测试：旧主题色存储键不被删除 |
| C44 | 设计作用域标记引用计数安装，卸载时恢复先前值，StrictMode 下正确 | `src/design-system/scope.ts` | `scripts/check-ui-design.mjs`、`design-system.spec.ts` | 无 |
| C45 | `dsh-manuscript` 在没有 shell 宿主的独立 Web 模式下仍有完整的降级 token 与控件 | `packages/dsh-manuscript/src/client/themes.tsx`、`packages/dsh-editor-seats/src/tokens.ts` | `packages/dsh-manuscript/src/client/themes.spec.ts`、`e2e/ai-plugins-standalone.mjs` | 无 |

## 状态呈现

| ID | 契约 | 实现位置 | 覆盖 | 缺口 |
| --- | --- | --- | --- | --- |
| C50 | 加载、失败、空、禁用、成功都有真实状态；不虚构进度或“已写入” | 各界面 | 分散在各 spec | 新界面逐个补状态夹具 |
| C51 | 错误、冲突、待确认的信息不只靠颜色，不被折叠隐藏 | 各界面 | 无 | 新组件库的 Notice 与提案卡补测试 |
| C52 | 可选 AI 能力加载完成前不挂载对话与补全；失败显示可重试的错误态 | `src/client/capabilities.ts` | `capabilities.spec.ts` | 无 |
| C53 | 图标按钮都有可访问名称；禁用与加载状态在语义上不可操作 | 各界面 | `.dev` 实测脚本（仓库外） | 新组件库补测试 |
| C54 | 减少动态效果与 forced-colors 下状态仍可辨认 | `src/client/ui/motion.ts`、样式 | `e2e/ui-design.mjs`（reduced motion） | 缺少 forced-colors 检查 |
