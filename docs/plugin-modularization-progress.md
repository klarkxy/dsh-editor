# 插件拆分实施与验收记录

> 本文是 2026-09-09 的当时快照。其后的声明式拼装、Shell 座位与垂直插件迁出见[声明式拼装记录](plugin-assembly-progress.md)；下文提到的 `/novel-kernel`、`zhihu.usage` 转发与 workbench 的 `cards.*` 已在该轮移除或迁出。

> 后续更新：已授权的 MiniMax-M3 在线实测及修复见[在线验证记录](minimax-live-validation.md)。本文件的原始回执保留为当时快照；当前仍有两项非 AI 交互待定位。

2026-09-09。已完成 [P0—P5 拆分计划](plugin-modularization-plan.md)在本仓库的实施、Windows 交付验证及宿主精简研究。P5 的“整个浏览器进程不加载 Agent”结论是需要上游解耦，符合原计划允许的研究退出条件；没有将它写成已实现。

使用方式见[组合指南](plugin-composition-guide.md)，接口细节见[架构手册](plugin-architecture.md)，直观边界见[交互图](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html)。[本轮汇总回执](verification/plugin-modularization-2026-09-09/summary.json)与之前 807 项测试的历史基线分开保存。全部改动及产物在本地，未提交、推送或发布。

## 按原计划逐项结算

| 阶段 | 结果 | 直接证据与验证范围 |
| --- | --- | --- |
| P0 兼容映射、依赖分类、接入探针 | 完成 | 下表固定原 channel/entry/domain 所有者；实际 Connection Host 无 Agent 探针；公开安装矩阵继续保留 manuscript/grill；缺 workbench/kernel 仍明确启动失败 |
| P1 独立非 AI 校对 | 完成 | `dsh-proofread` 含纯引擎、严格有界 RPC、自有 Client 和 tarball；同一句“我们以经做好准备。”在 Web、Shell、最终 EXE 均返回“已经”；原引擎 39 个函数/常量与基线 token 对比一致；原 card、跨文件 habit 与预算回归保留 |
| P2a AI 可选入口 | 完成 | manuscript 基础 Host 不再注入 llm，workbench 基础 Host 不再注入 tools；basic 不安装 kernel/知乎，不启用 assist/tools；真实创建、保存、搜索、扫描、卡片、快照通过，写作期间没有 FIM/patch/自动索引/聊天请求；smart/full 挂载原 Chat |
| P2b 独立知乎 | 完成 | 普通服务默认单独启用，Tool entry 由 full 显式加入；新 UI 不依赖 Shell 业务状态；旧 RPC 转发保持输入/取消信号，计量 domain/version 不变；13态矩阵中5次核对真实计量跨重启、移除与重装没有丢失/重复；Tool/RPC 卸载均取消并等待计量落盘 |
| P3 两个插件验证同一挂载面 | 完成 | proofread/zhihu 均使用 `dsh-editor.extensions` 与官方 `shell.overlay`；真实 Web/Shell 打开与关闭，纸/墨主题、焦点恢复、重载无重复贡献通过；校对加载/错误重试/编辑期间旧响应抑制通过；停用 proofread entry 后知乎及 workbench 引擎仍可用 |
| P4 可交付组合 | 完成（Windows） | 四个独立 tarball，basic/smart/full 配置，同一包清单驱动准备/开发/运行时/校验；13个配置状态、16次装卸、12次浏览器启动，零问题；basic/smart 用复制产物且确认无仓库包链接；最终 full 便携 EXE 实际完成校对、新建与磁盘保存 |
| P5 精简宿主 | 研究完成 | 无 dsh-web-app bundle 的真实 profile 已启动 UI、校对及页面重连；无 Agent 的纯 RPC Host 已运行及释放端口；整个浏览器组合缺 sessionPersistence、apiProxy 的 Agent 服务与 host-runner 的 tools，保留准确诊断和最小上游建议 |

### 兼容与所有权映射

| 原接口/数据 | 当前唯一所有者及迁移方式 |
| --- | --- |
| `manuscript`、`/manuscript` 文件/草稿/search/proposal/FIM/patch | 原 entry/channel 保留；FIM/patch 转发到同包 `manuscript-assist` 提供的 `manuscriptAssist`，没有第二个 channel 注册者 |
| `editor-workbench`、`/dsh-editor-workbench` | 原 entry/channel 保留；作品扫描仍加载词表/卡片并跨文件聚合；纯引擎来自 dsh-proofread；novel_overview 移到 `editor-workbench-tools` |
| `editor-novel-kernel`、`/novel-kernel` | 原 entry/channel 保留；9个小说工具、guard、prompt 保留；旧 `zhihu.knowledge.*` 转发到新服务 |
| `grill-tools`、`grill-workflow` | 旧公开包与安装行为保留 |
| `zhihu_search/global_search/hot_list/ask/knowledge_search` | `dsh-zhihu/tools` 唯一注册；普通安装不要求 tools，full 显式选择 |
| `dsh_editor_drafts` | manuscript；owner/revision/baseVersion 不变；实际双窗口冲突、重启恢复及另存冲突副本通过 |
| `dsh_editor_usage` | manuscript-assist；旧 usage.summary 经原 channel 转发；原模型/作者偏好/上下文/取消测试继续覆盖实际辅助服务 |
| `dsh_editor_zhihu_usage` version 1 | zhihu 唯一写入；原 zhihu.usage 转发；凭据引用仍为 ZHIHU_ACCESS_TOKEN；并发计量串行，无双重监听写入 |
| `dsh-editor-writing/progress/conversations` | 原设置 namespace 和所有者保持；不迁移用户配置 |
| Markdown、`.dsh-editor/*`、快照、导入 token/receipt | 原文件权限、版本门禁、恢复语义与数据格式不变，不建立新权限系统或存储 |

Shell 对业务 contracts 和 editor-core 使用构建时内联；它们不再是 Shell 的运行依赖。workbench 对稿件权限库和纯校对引擎仍是必需依赖。AI 服务注入可选不等于所有上游 AI 包均可不安装；基础写作继续使用 live session/workspace 权限。

## 实测回执

| 检查 | 本轮结果 |
| --- | --- |
| 全 workspace 类型检查 | 通过 |
| 全回归 | 96个测试文件，832项通过；移除只匹配源码字符串的新测试，保留能检测行为回归的测试 |
| 全构建与公开打包检查 | 通过；4个 tarball 的 exports、文件、资源及不应出现的依赖检查通过 |
| [公开安装矩阵](verification/plugin-modularization-2026-09-09/plugin-matrix.json) | 13态/16转换/12次浏览器验证，零问题；含双向移除、重装、空组合、四包组合和真实计量持久化 |
| [无 AI 校对 Host](verification/plugin-modularization-2026-09-09/proofread-host.json) | 不提供 agents/sessions/fs/llm/tools/systemPrompt；实际 HTTP、恶意 Origin 拒绝、卸载/重装与端口释放通过 |
| [basic](verification/plugin-modularization-2026-09-09/composition-basic.json) / [smart](verification/plugin-modularization-2026-09-09/composition-smart.json) / [full](verification/plugin-modularization-2026-09-09/composition-full.json) | 创建与保存、搜索、作品校对、人物卡、快照、可选入口、主题、重载通过；basic/smart 确认安装集合与复制交付 |
| [停用入口](verification/plugin-modularization-2026-09-09/entry-disable.json) | proofread Host/Client 消失；静态兜底与不存在路由同为405；知乎继续运行，workbench 扫描保留引擎 |
| [缺必需包](verification/plugin-modularization-2026-09-09/missing-private.json) | 完整组合缺 workbench 或 kernel 均退出1并标识缺包，未把坏组合当正常关闭 |
| [桌面原场景](verification/plugin-modularization-2026-09-09/desktop.json) / [核心写作](verification/plugin-modularization-2026-09-09/core-loop.json) | 首次/已有作品、双窗口冲突、草稿重启恢复、另存副本、导航/主题/聊天草稿与退出清理通过 |
| [最终包校验](verification/plugin-modularization-2026-09-09/desktop-package.json) / [便携实际运行](verification/plugin-modularization-2026-09-09/portable.json) | Windows 0.1.7 EXE与安装器已生成；整树哈希相符；便携 EXE 校对、知乎入口、新建与保存通过，应用端口/调试端口均释放 |
| [宿主精简](verification/plugin-modularization-2026-09-09/host-minimization.json) | 无 Web bundle 的 UI/RPC/重连通过；无 Agent 的完整浏览器组合未通过，准确缺依赖见回执 |
| 图示检查 | schema/layout 与多尺寸明暗 containment 通过；已目视检查1440×900浅色图及真实墨色插件面板；自动回执的 visualReview 字段按工具约定保持 pending，不把它等同人工检查 |

独立只读评审提出的三项问题已修复：知乎工具请求生命周期、知乎默认 patch 的 tools 依赖、workbench tools peer。后续限定范围复核无新增发现；完整集成由上述主代理实测验收。

## 交付位置与使用边界

- 公开包：仓库 `.pack/dsh-{manuscript,grill,proofread,zhihu}-0.1.0.tgz`。
- Windows 便携版：`.pack/desktop/DSH Editor-0.1.7-win-x64.exe`。
- Windows 安装器：`.pack/desktop/DSH Editor-Setup-0.1.7-win-x64.exe`。
- 组合、安装说明、Host/Client/manifest/patch 范本与复现命令：[组合指南](plugin-composition-guide.md)。

拆分初次验收没有执行在线模型或知乎付费调用（后续 MiniMax-M3 实测见上方更新）；这些合同用受控服务/响应验证，不能据此宣称线上账单、配额或长期服务可靠性通过。Windows 便携运行已实测；macOS 构建和运行仍是平台证据缺口，安装器完成构建/校验但没有执行安装向导。整个编辑器完全无 Harness 仍需上游工作，未绕过 live session、sandboxPolicy 或作者确认。

安装组合变更采用保存并关闭后重启；不承诺热卸载正在运行的模型任务。数据格式未改变，可切回之前代码/组合；保留作品、草稿和计量数据，不以删除数据解决迁移问题。
