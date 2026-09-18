# DSH Editor 架构决策

本文只记录源码看不出来的决定与理由。接口与命令以源码为准：入口、`inject`、feature 与各包职责看 `package.json` 的 `dshEditor` 声明和 `src/contracts.ts`；组合 recipe 看 `apps/desktop/resources/compositions/` 与 `scripts/plugin-manifest.mjs`；命令看根 `package.json` scripts。产品边界见 [product-principles.md](product-principles.md)，操作见 [user-guide.md](user-guide.md)。

## 信任模型

一切 RPC 只在 `127.0.0.1` 随机端口上服务本机单用户。这个模型允许 Host 信任 loopback 对端，代价是**永远不要**把这些通道暴露成远程或多用户接口——它们没有为此设计的鉴权。

Renderer 是被防范的一方：不读凭据明文、不直接调 Node 文件系统，文件请求的权限由 Host 按 live session 重建。浏览器传来的 cwd、provider、model 一律不被信任。

## 为什么不自己造运行时

Agent 循环、会话、模型、审批、权限和文件 API 全部属于 DSH。本仓库只补作者看得见的写作体验。因此没有、也不允许长出：BFF、第二份 Chat 历史、provider registry、数据库、工作流引擎、索引服务、云同步。一旦某层开始复制 DSH 的权威，作品状态就会有两份真相。

同理，升级 DSH 时如果发现某处依赖了上游私有 UI 的内部实现，应该停下升级，而不是把上游内部代码复制进来。

## root 遮蔽是兼容接缝，不是扩展 API

shell 以较低 root priority 遮蔽官方 AppFrame。上游已明确告诫普通插件不要注册 root；本产品只把它当作固定版本、专用 profile 下的兼容接缝。升级 DSH 前必须取得受支持的 shell replacement seam，否则重新完成全部桌面验收。

## 写入纪律

正文只在作者确认后写入，所有写操作带版本基线并 fail closed：目标变了就报 `STALE`，不覆盖、不降级、不假装没写。同一作品的写入经单一队列串行，防止多窗口交错；磁盘版本与哈希检查负责发现外部编辑器的改动。部分完成必须如实回报，不自动重试。

## `.dsh-editor/` sidecar

作品的私有元数据（快照、归档、写作日志、敏感词名单）收在作品目录的 `.dsh-editor/` 下，对作者隐藏但不删除，损坏时 fail-open 到默认值，绝不让元数据问题挡住写作。

## Legacy preset

历史 `dsh-editor` preset 保留，只为让旧会话继续打开和迁移；新对话看不到它。退出判据记录在 [product-principles.md](product-principles.md)。

## 发布纪律

任何 commit、push、tag、release、签名都必须另行授权。发布先建 draft Release 再推 `v*` 标签，等两平台 CI 成功、下载产物与 `sha256sums.txt` 核对一致、下载后的便携包实际启动验证通过，才公开。历史报告和本地旧包都不能当作新标签的证据。

## 架构图

五张交互图（桌面运行时、插件分级、组合边界、作者确认写入、提案版本门禁）发布在 [GitHub Pages](https://klarkxy.github.io/dsh-editor/)，规范源在 [diagrams/](diagrams/)。读图时把 Host 插件看成 DSH 进程里的 Cordis 入口，不是旁边的独立服务。
