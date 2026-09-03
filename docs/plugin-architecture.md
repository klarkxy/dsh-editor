# DSH Editor 插件架构与接口

本文是修改、替换或新建 DSH Editor 插件的权威手册。通用产品边界见 [architecture.md](architecture.md)，开发和验收命令见 [development.md](development.md)。

当前兼容基线固定为 DSH `0.1.1-rc.2`。私有 `root` 接口尤其不是上游公共承诺；升级 DSH 前必须重新验证本文列出的全部桌面能力。

## 交互架构图

| 图 | 说明 | 打开 |
| --- | --- | --- |
| 插件拓扑 | 公开 Web 与桌面私有包、loopback RPC、DSH 权威 | [dsh-editor-plugins.html](diagrams/dsh-editor-plugins.html) |
| 确认写入 | 预览提案不写文件；作者确认后才 `proposal.apply` | [author-confirm-write.html](diagrams/author-confirm-write.html) |
| 桌面运行时 | 进程、profile 与写作主路径 | [dsh-editor-runtime.html](diagrams/dsh-editor-runtime.html) |

规范源文件在 [diagrams/](diagrams/) 下的同名 `.json`。

## 运行拓扑与所有权

一个 Electron 进程只启动一个 loopback DSH Host。所有插件共享 DSH 的 session、workspace、model、tools、approval 和 connection 权威，不创建第二套状态。

```text
Electron bootstrap（不可插件化：窗口、内置运行时、profile 部署、子进程监督）
└─ profiles/dsh-editor
   ├─ @deepseek-ai/dsh-base
   ├─ @deepseek-ai/dsh-web-app
   ├─ dsh-manuscript
   │  ├─ Host: /manuscript、draft storage、稿件安全读写
   │  └─ Client: shell.overlay（公开 Web 插件）
   ├─ dsh-editor-workbench
   │  └─ Host: /dsh-editor-workbench、项目/导入/快照/归档/context
   ├─ dsh-editor-novel-kernel
   │  └─ Host: novel_knowledge、novel_propose、guard、system prompt、知识卡
   └─ dsh-editor-shell
      ├─ Host: 仅保留加载 client 的最小入口
      └─ Client: 唯一 root GUI、DshChatPort、编辑状态、作者确认

普通 profiles/web
├─ dsh-manuscript（可独立安装）
└─ dsh-grill（可独立安装、可与 manuscript 共存）
```

依赖方向固定如下；禁止跨包导入另一个包的 `src`：

```text
dsh-editor-shell/client
├─ dsh-editor-workbench/contracts（构建时内联）
├─ dsh-editor-novel-kernel/contracts（构建时内联）
└─ dsh-manuscript/client/editor-core（共享稿纸核心：editor / state / completion-preference / styles）

dsh-editor-workbench/host
└─ dsh-manuscript/host-api

dsh-editor-novel-kernel/host
└─ Cordis + DSH tools
```

## 插件与入口目录

| 包 / Cordis entry | 接口与职责 | 稳定级别 | 交付范围 |
| --- | --- | --- | --- |
| `dsh-manuscript` / `manuscript` | `/manuscript`、`shell.overlay`、draft/FIM/patch/proposal | public | 公开 tarball；Web 与桌面 |
| `dsh-grill/tools` / `grill-tools` | `scaffold_novel` Tool 与 guard | public | 公开 tarball；Web |
| `dsh-grill/workflow` / `grill-workflow` | `grill:workflow` prompt | public | 公开 tarball；Web |
| `dsh-editor-workbench` / `editor-workbench` | 私有工作区生命周期 RPC | private host-only | 桌面 profile 必需 |
| `dsh-editor-novel-kernel` / `editor-novel-kernel` | 私有小说工具、guard、prompt、知识卡 | private host-only | 桌面 profile 必需 |
| `dsh-editor-shell` / `editor-shell` | 唯一 `root` client | fixed-version private | 桌面 profile 必需 |

各包 `cordis.patch.yml` 中的 entry id：

| 包 | entry id | name |
| --- | --- | --- |
| `dsh-manuscript` | `manuscript` | `dsh-manuscript` |
| `dsh-grill` | `grill-tools` | `dsh-grill/tools` |
| `dsh-grill` | `grill-workflow` | `dsh-grill/workflow` |
| `dsh-editor-workbench` | `editor-workbench` | `dsh-editor-workbench` |
| `dsh-editor-novel-kernel` | `editor-novel-kernel` | `dsh-editor-novel-kernel` |
| `dsh-editor-shell` | `editor-shell` | `dsh-editor-shell` |

`dsh-editor-workbench/contracts` 与 `dsh-editor-novel-kernel/contracts` 是 browser-safe 内部兼容面：只能包含常量、类型、解析器和纯函数，不能导入 Node、Cordis Host 或文件系统。Shell 的 client 构建必须内联它们，浏览器产物不得在运行时解析私有 Host 包。

`dsh-manuscript/host-api` 是公开但狭窄的 Host 子入口，只提供 live-session workspace authority、受约束文件/路径原语与标准 Host 错误映射。它不是任意文件系统 SDK，也不包含桌面 workbench endpoint。

## Host、Client、inject 与生命周期

- Host 入口导出 `name`、`inject`、`apply(ctx)`；只声明实际使用的 service。
- Cordis entry 由包内 `cordis.patch.yml` 插入，entry id 和 prompt section name 必须全局唯一。
- 所有 `handle`、`guard`、事件订阅或资源必须通过 `ctx.effect` 或等价 disposer 清理。
- Client 只能使用 DSH 注入的 runtime、connection 和 slots；Renderer 不得访问 Node、凭据、绝对路径或进程。
- 普通附加界面使用 `shell.overlay` 等 additive slot。`root` 只能有一个所有者；替换 Shell 时必须先移除 `editor-shell`，不能并存两个 root。
- DshChatPort 只投影官方 `SessionFace`、`ConversationSnapshot`、send/cancel、model/permission、approval/questions。插件不得复制 Chat、启动第二次 connection 或自行执行 Tool。

当前 inject 清单（必须与源码保持一致）：

| 包 | `name` | `inject` |
| --- | --- | --- |
| `dsh-manuscript` Host | `dsh-manuscript` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `llm`, `storageDomain` |
| `dsh-editor-workbench` | `dsh-editor-workbench` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy` |
| `dsh-editor-novel-kernel` | `dsh-editor-novel-kernel` | `tools`, `systemPrompt` |
| `dsh-editor-shell` Host | `dsh-editor-shell` | （空） |
| `dsh-editor-shell` Client | `dsh-editor-shell-client` | `slots`, `sessions`, `workspaces`, `connection`, `settingsScope`, `settingsSchema`, `remote` |
| `dsh-grill/tools` | `dsh-grill-tools` | `tools` |
| `dsh-grill/workflow` | `dsh-grill-workflow` | `systemPrompt` |

Shell 以 `root` slot id `dsh-editor-shell-root`、priority `-100`、label `DSH 编辑器` 注册。manuscript client 只注册 `shell.overlay`（id `manuscript`，order `100`，label `稿纸`），禁止占用 `root` 或 `conversation.view`。

## RPC 通用契约

两个 channel 都只以 `{ authority: 'loopback' }` 注册。loopback 限制网络暴露，但不是调用者身份；每个文件请求仍必须携带 live `sessionId` 并由 Host 重建 authority。

```ts
type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: unknown } }
```

Host 处理文件请求的固定顺序：

1. `sessions.get(sessionId)` 取得 live session。
2. 只读取 immutable `session.header.cwd`，忽略 Renderer 伪造的 cwd。
3. `workspaceRegistry.resolveByPath(cwd)` 取得 registered workspace，并确认 session 仍属于它。
4. 解析 sandbox policy 和 canonical root。
5. 拒绝 absolute、device、traversal、symlink/junction 与越界 target。
6. 创建使用 create-if-absent；覆盖使用 version/hash/token/no-clobber 门禁。
7. 将同一 `AbortSignal` 传到底层调用。

标准错误码包括 `bad-request`、`cancelled`、`session-not-found`、`workspace-attach-failed`、`workspace-not-found`、`workspace-invalid-path`、`directory-unreadable`、`directory-exists`、`internal`。UI 映射固定的可操作文案，不直接显示异常堆栈或未约束的 reason。

## `/manuscript`：公开稿件接口

Channel：`/manuscript`。除特别注明外，请求都包含 `sessionId`，路径均为 workspace-relative。

| Endpoint | 请求字段 | 成功值 / 写入语义 |
| --- | --- | --- |
| `tree.list` | `sessionId`, `path` | `{ entries }`，有界目录项 |
| `file.read` | `sessionId`, `path` | `{ text, version }`，文本上限 2 MB |
| `file.create` | `sessionId`, `path`, `text` | create-if-absent |
| `file.write` | `sessionId`, `path`, `text`, `version` | replace-if-version |
| `draft.get` | `sessionId`, `path` | `{ draft }`，来自 DSH storage domain |
| `draft.put` | `sessionId`, `path`, `text`, `baseText`, `baseVersion` | 只保存草稿，不改正文 |
| `draft.delete` | `sessionId`, `path` | 删除对应草稿 |
| `search.text` | `sessionId`, `query`, `scope: project\|manuscript` | 有界字面量搜索；不接受正则 |
| `proposal.prepare` | `sessionId`, `kind`, `path`, `summary`；edit 加 `oldText`, `newText`；create 加 `text` | 只读预检和作者确认信息 |
| `proposal.apply` | prepare 的全部字段；edit 另加 `expectedVersion` | 作者确认后按版本门禁创建或修改 |
| `fim.complete` | `sessionId`, `prefix`, `suffix`，可选 `authorPreferences` | `{ text, route: 'dsh-llm' }`，只返回候选 |
| `patch.complete` | `sessionId`, `path`, `selectedText`, `before`, `after`，可选 `authorPreferences` | `{ text, route: 'dsh-llm' }`，只返回候选 |

不得把导入、快照、归档或任意 Node FS 能力加入这个公开 channel。

## `/dsh-editor-workbench`：私有桌面接口

Channel：`/dsh-editor-workbench`（常量 `WORKBENCH_RPC_CHANNEL`）。类型面在 `dsh-editor-workbench/contracts`。

| Endpoint | 请求字段 | 成功值 / 语义 |
| --- | --- | --- |
| `project.createHome` | `title` | `{ path }`，在「文档/dsh-editor」下独占创建同名空文件夹；不接受调用方传入的父路径 |
| `project.init` | `sessionId`, `newProject` | `{ created, skipped }`，只建立空的 `正文`、`大纲`、`人物卡`、`世界书` 目录，不写入 Markdown 模板 |
| `project.prepareIndex` | `sessionId` | 索引准备回执 |
| `project.overview` | `sessionId` | 章节/大纲摘要、字数统计、最近编辑项和有界扫描警告 |
| `structure.groupCreate` | `sessionId`, `path` | 只在 `正文` 下建立一级卷/部目录 |
| `directory.create` | `sessionId`, `path` | 在任意已存在的父目录下建一个可见目录（通用，无 正文 特化） |
| `context.compile` | `sessionId`, `userRequest`，可选 `activePath`, `authorPreferences`, `authorMemory` | `{ serialized, receipt }`，有界 V2 context 信封 |
| `project.importProbe` | `targetSessionId`，可选 `sourceSessionId` | token、统计、预览或恢复状态；不写入 |
| `project.importApply` | `targetSessionId`, `sourceSessionId`, `probeToken` | 重新 probe 后执行 no-clobber 导入 |
| `project.importCleanup` | `targetSessionId`, `receiptId` | 只清理 manifest/hash 证明归属的中断写入 |
| `snapshot.list` | `sessionId` | 快照列表；不包含未保存 buffer |
| `snapshot.create` | `sessionId`，可选 `label` | 原子发布后的 snapshot view；简易提交流程的 label 即当前时间 |
| `snapshot.rollback` | `sessionId`, `snapshotId` | 原地回滚：覆盖/删除回到快照状态，先自动创建安全快照（可再回滚撤销）；非文本文件不动 |
| `snapshot.restoreProbe` | `targetSessionId`，可选 `sourceSessionId`, `snapshotId` | 只恢复到新空 workspace 的 token/状态（跨作品恢复，与原地回滚不同） |
| `snapshot.restoreApply` | `targetSessionId`, `sourceSessionId`, `snapshotId`, `token` | no-clobber 恢复统计 |
| `snapshot.restoreCleanup` | `targetSessionId`, `receiptId` | hash-protected 中断清理 |
| `file.rename` | `sessionId`, `path`, `newName`, `expectedVersion` | 同目录、保留扩展名后的新路径 |
| `file.moveManuscript` | `sessionId`, `path`, `targetDirectory`, `expectedVersion` | 仅在 `正文` 树内 no-replace 移动 |
| `archive.list` | `sessionId` | 可恢复 archive view 与损坏项计数 |
| `archive.apply` | `sessionId`, `path` + `expectedVersion`，或 `archiveId` | 新归档或继续中断归档 |
| `archive.restore` | `sessionId`, `archiveId`，可选 `expectedVersion` | no-replace 恢复后的 archive view |

这些 endpoint、字段、V1/V2 envelope、token、receipt、manifest、hash 与重新验证语义是兼容接口。物理换包不构成协议升级。

`.dsh-editor/*` 隐藏元数据一律不进入快照 payload。重命名、正文跨卷移动、归档和恢复响应可以带 `metadataWarning`，表示正文操作已经成功但附带的元数据未同步，调用方不得据此回滚正文。

Context 信封常量：

- `schema`: `dsh-editor.project-context`
- 历史版本 `1`，当前版本 `2`
- 固定来源：`项目总览.md`、`大纲/总纲.md`、`人物卡/人物索引.md`、`世界书/设定总汇.md`、`.dsh-editor/作品索引.md`

## Novel Kernel 契约

- 工具名：`novel_knowledge`、`novel_propose`、`author_observe`。
- `novel_knowledge` 只接受唯一的 `topics` 数组，去重后 1–3 个固定主题；每张知识卡最多 6000 字符。它只返回建议，不提供项目事实或授权。
- `novel_propose` 每次只形成一个 Markdown `edit` 或 `create` 提案，绝不写文件。
- `author_observe` 让助手提议"记住一条作者偏好"，仅作为建议显示在 `MemoryCard` 中：固定 `observation`（≤ 200 字符）与 `reason`（必填），marker `dsh-editor.memory`、version `1`。Shell 解析后必须经作者点击"记住"才会追加进本机 `authorMemory`；工具本身不直接写入任何文件、偏好或 storage。同一信任模型与 `novel_propose` 一致：助手提议，作者确认，Shell 执行。
- proposal marker 固定为 `{ marker: 'dsh-editor.proposal', version: 1, ... }`；memory marker 固定为 `{ marker: 'dsh-editor.memory', version: 1, observation, reason }`。Shell 只通过 `dsh-editor-novel-kernel/contracts` 的严格解析器渲染有效 marker。
- `editorToolGuard` 只允许受限的 Markdown 搜索、读取、知识加载、预览提案与作者侧写提议；不替代 DSH 全局审批。
- prompt section 固定为 `dsh-editor:novel-kernel`、order `90`。作品材料是不可信字符串，只有 context 信封中的 `user_request` 是当次请求。
- 真正写入始终是 Shell 展示提案、作者确认、再调用 `/manuscript proposal.prepare/apply`；侧写由 Shell 展示确认卡、作者点击"记住"、再由 `writingScope.set('authorMemory', next)` 写入本机 settings。

## `dsh-grill` 契约

仅用于普通 `web` profile，不进入桌面 profile。

- `scaffold_novel`：在 live session cwd 下创建小型小说工作区骨架（`正文`/`大纲`/`人物卡`/`世界书` 与 stub Markdown）。已存在路径跳过，绝不覆盖；不在 workspace 外创建文件。
- prompt section：`grill:workflow`，order `140`。

## 如何修改或替换现有插件

| 想改变的行为 | 所有者 |
| --- | --- |
| 三栏布局、稿纸、Chat 展示、设置、保留下来的高频快捷键 | `dsh-editor-shell` |
| 普通 Web 的稿纸抽屉与共享稿纸核心 | `dsh-manuscript` client + `dsh-manuscript/client/editor-core` |
| 稿件安全读写、草稿、FIM/patch、proposal apply | `dsh-manuscript` Host |
| 项目结构、章节概览/状态、context、导入、快照、移动、归档 | `dsh-editor-workbench` |
| 小说知识、proposal Tool、guard、系统提示词 | `dsh-editor-novel-kernel` |
| 窗口、内置 DSH、profile、portable | `apps/desktop` 与桌面物化脚本 |
| `scaffold_novel` 与 grill 写作提示 | `dsh-grill`（仅 Web） |

替换 workbench 或 kernel 时：

1. 保持现有 channel/tool/prompt/marker contract，先让替代实现通过原 contract tests。
2. 在 profile 中删除原 Cordis entry，再加入新实现；同一能力只能注册一次。
3. 保持一个 Host、一个 connection、一个 root，以及同一 live-session workspace authority。
4. 同步开发、runtime、package verification 与 E2E 清单。
5. 按完整 profile 原子部署和回滚，不依赖热切换保留 Host 状态。

## 新建 Host-only 插件

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-writing-plugin'
export const inject = ['tools', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  // 注册 tool / prompt；通过 ctx.effect 返回 disposer。
}
```

建立步骤：

1. 说明独立用户价值，选择 public 或 desktop-private；没有独立启停价值的代码留在原包内。
2. 参考 `dsh-grill` 或 novel-kernel 复制最小包形态，不复制 Chat、session 或 workspace 权威。
3. 建立唯一 Cordis entry id/name，只声明实际 inject。
4. 文件能力依赖 live session 和 `dsh-manuscript/host-api`；不接收 Renderer 提供的 cwd/provider/model。
5. 增加 package-local unit/contract tests，再接入对应 profile、复制、校验和 E2E。
6. 公开包加入 `pack:plugins` 与 fresh-home 安装矩阵；私有包只加入桌面 profile，不进入公开 tarball。

## 新建 overlay 插件

dual-face Web 插件参考 `dsh-manuscript`：Host 为 ESM，client 通过 `wrap-client.mjs` 生成 DSH lazy CJS 包装，manifest 声明 `dsh.client.platform: "web"`、inject 与 `./client` export。

Client 只能注册 additive slot，例如 `shell.overlay`；不得使用 `root` 或 `conversation.view`。若需求确实是替换整个产品根界面，应派生并替换 `dsh-editor-shell`，而不是同时安装第二个 root。

## 兼容、卸载、失败与数据保留

- 两个私有 Host 插件是桌面 profile 必需组件，不提供运行时安装/禁用 UI。缺包属于无效交付，由物化和包内容验证阻止。隔离负向 smoke 已确认：在 DSH `0.1.1-rc.2` 中移除任一包时，Host 在发布 loopback URL 前以退出码 `1` 失败，并在错误中指出缺失包；`pnpm test:e2e:missing-private` 固化该行为。
- workbench/kernel 运行失败沿用现有 RPC/tool fail-closed 路径；不增加备用执行面、重试守护或健康检查 RPC。
- 卸载插件不删除 workspace 文件、home credentials、settings、sessions 或 storages。
- `dsh-manuscript` 卸载前应保存正文并处理需保留草稿；插件不会主动清除 DSH storage domain。
- Kernel 卸载不删除知识卡之外的任何数据；proposal 从未直接写正文。
- 私有 profile 按整套精确版本原子替换。回滚也替换整套 profile，不混用不同版本的 contracts 与 Host。
- `root` seam 只兼容精确 DSH `0.1.1-rc.2`。

## 限额、取消与幂等性

- 稿件文本和单份 draft 上限 2,000,000 bytes；创建 create-if-absent，保存 replace-if-version。
- `patch.complete` 的 selectedText 最多 12,000 字符，before/after 各 4,000，候选最多 1,200。
- project context 固定来源单份 4,000、合计 12,000；动态世界书另有 6,000 总预算。
- `AbortSignal` 必须贯穿 RPC、文件和模型调用；超时不能被当作“必定未执行”。
- 导入、恢复、移动、归档必须先重新 read/probe，再继续、清理或重试。

## 集成清单与验收

新增或删除私有包时必须同步：

- `apps/desktop/resources/profile/package.json`
- `scripts/prepare-desktop-dev.mjs`
- `scripts/prepare-desktop-runtime.mjs`
- `scripts/verify-desktop-package.mjs`
- `scripts/dev.mjs`
- 包内 `cordis.patch.yml`、manifest、build、tests

最低验收：

| 变化 | 必须通过 |
| --- | --- |
| Host-only Tool/prompt | package unit、typecheck、build、真实 Tool/prompt smoke |
| 公开 dual-face 插件 | 上述检查 + `pack:plugins` + `test:e2e:matrix` |
| 私有 workbench/kernel | contract tests + `verify:desktop` + desktop package verification + portable E2E |
| root shell 或 DSH client contract | `verify:desktop` + desktop package + portable E2E |
| DSH 版本变化 | 全部检查，并重新审计 root、SessionFace、RPC、bundle/profile 和 portable runtime |

静态门禁还必须证明：无跨包 `src` 导入；依赖图无环；Shell client 无 Node 和私有包裸依赖；公开 manuscript tarball 不含私有包名、workbench channel、小说工具或知识卡。
