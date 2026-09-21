# 架构决策

## 运行时权威

DSH 管理 Agent、会话、模型、审批、文件权限与对话历史。Editor 提供写作界面，不另建这些状态的副本，避免出现两份真相。产品取舍见[产品原则](product-principles.md)。

桌面外壳替换官方界面依赖固定版本的兼容接缝，升级约束见 [shell](../packages/dsh-editor-shell/README.md)。

## 信任与写入

本地单用户是部署边界。loopback RPC 没有面向远程或多用户的鉴权设计，不得直接暴露到网络。

Renderer 不持有凭据明文或文件权限；Host 依据真实会话判定访问范围。作者确认不能代替版本核对：文件变化后必须拒绝旧修改，部分完成也须如实报告。

作品是普通文件夹；备份或迁移作品时应包含隐藏的 `.dsh-editor/` 元数据。它不属于正文，不能把稿件只放在其中。

## 交付

commit、push、tag、release 与签名须获授权。桌面发布先建 draft Release，再推 `v*` 标签；两平台 CI、下载产物校验和与便携包启动验证通过后才公开。旧报告不能代替新版本的证据。

插件的发布流程见 [发布维护](../packages/PUBLISHING.md)。命令以根 [package.json](../package.json) 为准。

跨包关系见[架构图](diagrams/index.html)。接口与包配置从[插件目录](../packages/README.md)进入源码。
