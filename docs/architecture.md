# DSH Editor 架构与边界

## 当前决策

本仓库只包含两个可独立安装的 DSH 插件。它不实现另一套应用外壳、Chat、Agent runtime、审批系统、provider store 或会话数据库。

```text
官方 DSH
├─ Chat / Agent / tools / approvals / providers / sessions
├─ dsh-manuscript
│  ├─ 默认收起的 shell.overlay 稿纸抽屉
│  ├─ 通用工作区文件树与正文 buffer
│  └─ loopback RPC → live session → registered workspace → DSH fs/sandbox
└─ dsh-grill
   ├─ 通过官方工具/审批流程执行 scaffold_novel
   └─ additive 四模式写作提示
```

当前公共 DSH API 只提供 additive overlay，没有插件重组官方根布局的稳定接口。因此 Manuscript 使用可关闭的 360px 抽屉；关闭后不拦截全屏 pointer。真正的编辑器加 Chat 永久三栏需要上游 shell composition API。

## 所有权边界

- 官方 DSH：Chat、Agent 执行、工具调度、审批 UI、权限 preset、会话生命周期、模型/provider、streaming 和对话持久化。
- `dsh-manuscript`：稿件界面、本地编辑状态、loopback 文件/FIM RPC adapter。
- `dsh-grill`：一个 scaffold 工具和一个 additive prompt section。
- 两个插件没有互相 import、RPC、文件、schema 或运行时状态。安装或卸载任意一个不得改变另一个的契约。

## Manuscript Host 边界

浏览器文件请求携带 `{ sessionId, path, ... }`；浏览器提供的 `cwd`、provider 和 model 会被忽略。

每个请求按以下顺序处理：

1. 解析 live session ID；
2. 读取 immutable `session.header.cwd`；
3. 解析 registered workspace，并确认 session membership；
4. 解析该 session 的 sandbox policy；
5. 规范化工作区相对路径，拒绝绝对/device/traversal 输入；
6. 使用 DSH `ctx.fs` 做 canonical resolution、containment、逐组件 symlink 拒绝、stat/list/read/write；
7. 创建使用 `createIfAbsent`，保存使用 `replaceIfVersion`，并把 policy 传给原子写入。

文本 I/O 上限为 2 MB。binary、非普通文件、父目录不存在、stale version、symlink、read-only 写入、未知 session 和 workspace mismatch 都 fail closed。

GUI 刻意不提供 rename、delete、move 和目录创建，因为当前公共 DSH 文件契约无法以相同的原子安全级别实现它们。

RPC channel 是 `loopback`。当前 DSH generic RPC handler 没有 connection/session principal；传入的 session ID 只能选择一个 live session，不能证明浏览器 caller 拥有它。因此这个边界只适用于本地单用户 DSH。远程或多用户暴露必须等上游提供 caller-bound identity 或 capability。

## Manuscript 客户端状态

- 抽屉默认关闭，可随时重新打开，不修改官方 root surface。
- 每个文档跟踪 saved text、local text、opaque filesystem version，以及 `loading | saved | dirty | conflict | error`。
- 未保存文本按 workspace path 存入当前浏览器会话；恢复后仍需显式保存。
- 切换文件/session/workspace 前必须保存或明确放弃当前 buffer。
- 保存失败或 stale write 保留 buffer；target 变化后的晚到 read/FIM 会被丢弃。
- “改这段”只复制提示到剪贴板，不读取或修改官方 Chat DOM。

FIM 只从 live session request header 派生 provider/model，并调用官方 `llm.stream`。缺少选择或服务时返回空；候选只修改本地 buffer，磁盘写入仍需 `Ctrl+S`。

## Grill v1

`dsh-grill` 只注册 `scaffold_novel` 和一个含 `planning`、`drafting`、`review`、`first-reader` 的 additive prompt section。

scaffold 使用调用 Agent 的 session workspace，检查 sandbox policy，经 DSH 官方 pre-execute seam 请求审批，不覆盖已有路径，并保持幂等。prompt 只指导官方 Chat，不写稿、不扫描 scene、不编译隐藏 context、不访问 Web、不排队 proposal，也不依赖 Manuscript。

## 非目标

- 第二套 Chat/Agent 或替代对话界面；
- 自动把 Chat 文本写入磁盘；
- proposal store 或跨插件协议；
- Manuscript rename/delete/move/建目录、watch、index、Git 或 migration UI；
- Grill scene/AI-flavor scanner、外部模型生成、canon state 或复制 Skill 资产；
- 未经单独授权的 commit、push、tag、publish 或 release。

## 验证闸门

- 两个包 build 和 typecheck；
- unit 覆盖 workspace authority、路径攻击、symlink、原子 create/save、stale version、read-only、dirty/conflict/draft、晚到响应、FIM routing、scaffold approval/idempotence 和四模式 prompt；
- source/packed artifact 搜索已移除功能、Manuscript 的 Node 文件直写/provider credential 读取，以及任何跨插件耦合；Grill 的审批式 scaffold 刻意使用 Node FS，并由 workspace containment、逐组件 symlink 检查和 exclusive create 约束；
- 恰好打包两个 tarball，核对 exports、loader patch、client wrapper、license、dependency closure，并生成 SHA-256；
- fresh `DSH_HOME` 安装矩阵验证单装、共存和双向卸载；
- credentialed live E2E 验证 scaffold 审批、tree refresh、editor save、dirty close guard、drawer collapse 和可选 FIM。

标准交付闸门是 `pnpm verify:delivery`；发布仍是另一项需要授权的动作。

## 已知限制与兼容风险

- 当前只验证 `@deepseek-ai/dsh` `0.1.1-rc.1`，部分内置包为 `0.1.1-rc.2`。未作为稳定第三方类型导出的 Host seam 使用 structural typing 和 contract tests；每次 DSH 升级必须重跑真实加载和文件测试。
- DSH userspace filesystem sandbox 不是 kernel isolation boundary。本插件在 canonical resolution 前后检查路径组件，并依赖官方 sandbox backend 在原子写前复核，但仍必须留在 DSH 的本地信任模型内。
- 永久三栏布局需要上游 shell composition API。
- FIM 是可选能力；模型无候选时安全降级为空。
