# 公共插件仓库拆分

本次仅迁移源码所有权和构建依赖，不改变桌面预装、离线启动、插件 ID、数据位置或默认开关；不增加启动时网络安装。

## 唯一源码所有者

以下包的源码、独立测试与后续 npm 发布交由 [dsh-plugins](https://github.com/klarkxy/dsh-plugins) 维护：

- @klarkxy/dsh-ai-services@0.1.3
- @klarkxy/dsh-current-title@0.1.4
- @klarkxy/dsh-mood@0.1.4
- @klarkxy/dsh-recap@0.1.4
- @klarkxy/dsh-memory@0.1.4
- @klarkxy/dsh-self-improvement@0.1.4
- @klarkxy/dsh-model-center@0.1.3
- @klarkxy/dsh-fusion@0.1.0
- @klarkxy/dsh-web-search-manager@0.1.7
- @klarkxy/dsh-zhihu@0.1.7

知乎一并迁出；新仓库解除其按钮控件对 Editor 私有包的构建依赖，保留工具、凭据、RPC、存储和可选界面插槽。稿纸、校对与所有 dsh-editor-* 包仍留本仓库。

## 构建和交付

apps/desktop/resources/external-plugins.json 明确批准包名与精确版本，必须与根 package.json 一致；pnpm-lock.yaml 固定完整解析结果。构建从本地 workspace 和已安装 npm 包读取相同的 dshEditor / dsh.bundle 元数据，继续复制到离线 profile。构建不下载缺失包，失败时要求执行冻结安装；正常应用启动部署逻辑未修改。pnpm pack:plugins 仍生成完整公共插件 tarball 集合，外部包使用已构建制品重新打包且禁止生命周期脚本。开发 watcher 只构建本地源码，不尝试重建 node_modules。

公共插件测试随源码迁移；Editor 保留宿主集成测试，并通过公开入口测试已发布包，不再跨仓库引用 src。运行 pnpm test:external-plugins 检查版本、归属和制品解析边界。pnpm test:fusion 运行 Editor 侧 Fusion 宿主合同测试；公共 Fusion 的独立 Node 测试在新仓库运行。

## 合并及发布交接

先合并 dsh-plugins 的迁入 PR（迁入包保持 holdPublish），再合并本 PR。Editor 使用已有同名同版本 npm 包，不依赖先发布新版本。删除源码目录后，本仓库的发现式发布器不再发布这10个包。确认旧发布任务结束、每个包的 npm Trusted Publisher 切换到新仓库，并验证完整发布制品，再单独解除新仓库发布闸门。此 PR 不改凭据、不发布、不合并其他 PR。

## 后续方向

保留通过蓝图复现 Editor 写作环境的方向，本次不让蓝图接管桌面壳、升级、进程或用户数据，不要求 Editor 完全蓝图化。

## 知乎补充说明

Editor 仍锁定已发布的 @klarkxy/dsh-zhihu@0.1.7 制品，包含原有预装界面和 Agent 工具，不需要先发布新版本。新仓库中的独立按钮适配会在后续获准发布并更新 pin 后进入桌面版，不能把源码迁入当成 npm 已更新。原有知乎包测试及样式生命周期测试迁往 dsh-plugins，Editor 继续检查外部制品和组合顺序。没有变更密钥、设置或用户数据。
