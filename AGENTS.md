# DSH Editor: instructions for coding agents

适用整个仓库。更深目录的 AGENTS.md 补充本文件；用户明确的新要求优先于旧设计约定。

## 开工前

- 实现或修改产品行为前，先阅读 [产品原则](docs/product-principles.md) 和 [架构决策](docs/architecture.md)，再读修改目录下的指南。纯文档、注释或局部文案任务按涉及内容阅读相关指南；涉及产品或信任边界时仍须阅读对应原则与决策。
- **凡涉及可见界面，包括插件面板、设置、消息卡片，先读 [UI 施工约定](docs/ui-agent-guide.md) 和 [设计说明](docs/ui-design.md)。** 不能只凭“做得更现代”重新设计。
- 本仓库固定 React / Electron / CodeMirror，交互原语用 Radix primitives；界面样式走自有「原稿」设计系统（`@radix-ui/themes` 已移除）。普通功能任务不迁移框架、不新增第二套 UI 库或主题系统。

## 不随功能任务改变的边界

DSH 是会话、模型、权限与运行时状态的权威；Editor 保持稿纸中心。不要为美化复制状态、改变审批/写入契约、重置作者排版或按主题重新挂载编辑器。尊重插件边界和中文输入法。

视觉基准是当前仓库的生产 tokens、组件和设计系统预览；官方来源、固定版本与历史许可证以 [设计说明](docs/ui-design.md) 为准。不要另取“最新主题”覆盖现行设计契约。

## 文档与文案

以下包级文档要求适用于本仓库维护的包。外部公共插件的源码、包级文档与发布由其所属仓库维护；Editor 负责发行组合与宿主集成说明，归属见 [公共插件迁移说明](docs/public-plugin-migration.md)。

- **声明必须与代码核实。** 写或改 README、用户指南前，对照源码验证功能、命令、快捷键、默认值、限额与版本号；禁止凭印象或旧说法撰写。发现代码与文档冲突，按代码事实改文档（或先修代码再改文档），不两边各说各话。
- **私有包与公开包分开。** `dsh-editor-*` 等私有包的 README 用简体中文；发布到 npm 的公开包（`@klarkxy/` scope、`publishConfig.access: public`）根 `README.md` 用英文，中文放 `docs/README.zh-CN.md`，两者互链且信息量对等（详见 [PUBLISHING](packages/PUBLISHING.md)）。
- **公开包必须声明安装命令。** 每个公开包 README 的安装小节写出 `npm install @klarkxy/<包名>`；需要宿主显式加载的，并列 `dsh plugin --profile web add @klarkxy/<包名>`。
- **公开包文档不得专属于本编辑器。** 公开插件面向任意 DSH 宿主，README 不写"DSH Editor 预装/内置/在 Editor 中"这类说法，一律用宿主（host）、发行版（distribution）、应用私有包（application-private packages）等通用措辞。预装关系只写在本仓库自己的顶层文档（根 README、packages/README、docs/）里。
- **命名统一。** 使用产品内真实名称：「文档概览」（不是"作品概览"）、「文稿校对」、「小说工具」；模型档位只有 Quick／Chat／Thinking／Fantasy（快速／对话／思考／幻想），不借用其他产品的档位命名。
- **发行组合变化同步顶层文档。** 新插件进入 Editor 发行组合时，同一改动内更新：根 README 插件表、packages/README 表格、docs/README 索引、CHANGELOG、docs/user-guide.md。其他插件变化按实际影响更新相关说明；外部插件独立首次发布不自动要求更新这些文档。
- **公开面要文档化。** 公开包的 README 列出 agent 工具名、子路径导出（`./contracts`、`./client` 等）与 RPC 端点概览；私有核心包至少写清入口、命令与权限边界。
- **历史文档加标注。** 已完成使命的升级审计、预生产方案等保留时，在文首加历史留档说明并仍登记进 docs/README 索引；文档间链接与锚点保持有效。
- 文档与代码注释一律不用表情符号，保持 LF 换行与既有 Markdown 风格。

## 交付

UI 改动使用 `.github/pull_request_template.md` 的清单，报告改动范围、检查命令、截图和未验证事项。先运行 `node --test scripts/check-ui-drift.test.mjs`、`node scripts/check-ui-drift.mjs --base <任务起点或目标分支>`，再按 UI 指南执行设计检查、构建和适用的浏览器/桌面验证。未运行不能写“通过”。

开工时记录任务起点提交和已有工作区改动；增量检查覆盖既有改动时，区分任务变更与先前工作，不重置或覆盖用户修改。纯文档或注释改动且不影响产品界面时，检查文档事实、链接和格式，无需为此执行完整 UI 验证；产品界面文案变化仍按实际影响验证。

修改授权不自动包含提交、推送或发布授权；提交、推送、合并、标签、发布与签名须有相应授权。已获授权在本次任务内持续有效，无需重复询问；只获本地提交授权时，在任务分支提交，不自行推送或发布。不要为了让 CI 变绿删除断言、移动文件到检查范围外或自动重置视觉基准。
