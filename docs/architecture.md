# 架构决策

## 运行时权威

DSH 管理 Agent、会话、模型、审批、文件权限与对话历史。Editor 提供写作界面，不另建这些状态的副本，避免出现两份真相。产品取舍见[产品原则](product-principles.md)。

桌面外壳替换官方界面依赖固定版本的兼容接缝，升级约束见 [shell](../packages/dsh-editor-shell/README.md)。

## 官方插件管理器与 native profile

已安装清单、官方插件页与 `pluginManager` / `pluginManager:*` RPC（添加插件、检查、进度、构建批准、取消、开关、卸载、配置）以钉住的 DSH `0.2.0-rc.2` 官方管理器为唯一权威。Editor 用私有座位 `dsh-editor.native-plugin-manager` 托管其主页面，不占用全局 `main`，以免激活原生对话输入条。私有适配只保留发现搜索、写作模式和有限核心守卫。

native profile 顶层依赖用 `link:` 指向仍保留的已编译制品。`composition.json` 的 `nativeDependencies` 是不可变发行基线，与 `package.json` 里实际已选依赖分开。重部署时核心包与 `dsh-editor-profile-config` 恢复为模板规格和 `link:./profile-config`；基线中已卸下的可选依赖不会复活；作者改过的规格保留。进程在 TEMP 建立仅含 SDK 投影的 install anchor（复制 DSH 清单并链接运行时 `node_modules`），避开仓库祖先解析阴影，带所有者标记，停止时只清理自有目录。插件操作钉住随包 pnpm `11.7.0`（`--pm-on-fail=ignore`），与仓库构建用的 pnpm `10.14.0` 分开；随包 Node 为 `26.10.0`。importer 规格变化时用官方插件操作离线 `--lockfile-only` reconcile 锁文件；失败则中止，并按变更前快照恢复 DSH_HOME 中的插件配置、原 profile 与应用自有写作模式。

## 信任与写入

本地单用户是部署边界。loopback RPC 没有面向远程或多用户的鉴权设计，不得直接暴露到网络。

Renderer 不持有凭据明文或文件权限；Host 依据真实会话判定访问范围。作者确认不能代替版本核对：文件变化后必须拒绝旧修改，部分完成也须如实报告。

作品是普通文件夹；备份或迁移作品时应包含隐藏的 `.dsh-editor/` 元数据。它不属于正文，不能把稿件只放在其中。

## 交付

commit、push、tag、release 与签名须获授权。桌面发布先建 draft Release，再推 `v*` 标签；两平台 CI、下载产物校验和与便携包启动验证通过后才公开。旧报告不能代替新版本的证据。

插件的发布流程见 [发布维护](../packages/PUBLISHING.md)。命令以根 [package.json](../package.json) 为准。

跨包关系见[架构图](diagrams/index.html)。接口与包配置从[插件目录](../packages/README.md)进入源码。

作者写作记忆由私有工作台与记忆面板维护。退役公共 Memory / Self-improvement 的设计历史见 [Dream / Self Improve 边界](portable-learning.md)，不再作为现行运行时依赖。

## 公共插件源码归属

公共插件由 dsh-plugins 维护。Editor 仅预装网页搜索，使用精确版本的外部 npm 制品参与离线组合；当前标题、需求记录、会话纪要与知乎按需经官方「添加插件」安装。AI Services、Model Center、Memory、Self-improvement 与 Fusion 已退役；写作模型选择使用原生 DSH 接口和现有写作偏好。仓库归属与随包交付独立；详见[迁移与发布交接](public-plugin-migration.md)。
