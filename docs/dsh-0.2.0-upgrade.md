# DSH 0.2.0 升级与能力审计

日期：2026-09-29。目标版本 **0.2.0-rc.2**，仍不是无后缀稳定版。上游依据为官方发布 [dsh-v0.2.0-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1) 与 [dsh-v0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)，以及对比区间 [dsh-v0.1.7-rc.2...dsh-v0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.2...dsh-v0.2.0-rc.2)。前一轮升级（0.1.7-alpha.1 → 0.1.7-rc.2）的审计见 docs/dsh-0.1.7-upgrade.md。

## 升级范围

- 版本切换由 `node scripts/upgrade-dsh.mjs` 完成（rc 通道自动解析 0.2.0-rc.2），共改写 48 个文件 123 处版本钉住；未改全局 CLI，未提交、推送或发布。
- 工作区插件 peerDependencies 上限 `<0.2.0` 放开为开放下限（`>=0.1.7-alpha.1`，与上游插件作者现行约定一致），涉及 dsh-editor-workbench 与 dsh-editor-novel-kernel；否则 pnpm auto-install-peers 会为它们装出一套 0.1.7 旧副本。
- `@klarkxy/*` 外部插件全部升到最新小版本（ai-services 0.1.4、current-title 0.1.5、mood 0.1.5、recap 0.1.5、memory 0.1.5、self-improvement 0.1.5、model-center 0.1.4、fusion 0.1.1、web-search-manager 0.1.9、zhihu 0.1.9）；最新版的 peer 均为开放下限，兼容 0.2.0。`apps/desktop/resources/external-plugins.json` 与 `scripts/external-plugins.test.mjs` 的钉住同步更新。
- 依赖闭包：0.2.0 各包的内部 peer 仍有一批指向上一个预发布版本（0.1.7-rc.2），沿用上一轮的做法——根 `package.json` 的 overrides 扩到全部受影响的 `@deepseek-ai/dsh-*` 包（新增 dsh-timeout、dsh-brand、dsh-llm、dsh-session-format 系列、dsh-session-query、dsh-session-projection-cache、dsh-storage-domain、dsh-typert-protocol、dsh-util-crypto、dsh-util-values、dsh-web-fetch-http、dsh-web-search-deepseek、dsh-web-search-exa、dsh-compaction-image-offload 等 19 个），删除 `pnpm-lock.yaml` 与 `node_modules/.pnpm/lock.yaml` 后重新解析。最终锁文件中 0.1.7 版本快照为 0（残留的 `0.1.7` 字符串仅为 peer 范围表达式与无关的 partial-json@0.1.7）。
- `dsh-timeout` 是 0.2.0 新增包，大量工具包新增了指向它的 peer，必须进 overrides，否则闭包里会同时出现 0.1.7-alpha.1 / 0.1.7-rc.2 / 0.2.0-rc.2 三个副本。
- 升级脚本修正：`docs/dsh-0.1.7-upgrade.md` 这类历史留档被上一轮的盲替换改坏过，本次恢复原文并把两个升级文档加入 `SKIP_REWRITE_PREFIXES`。

## 上游新能力的吸收与关闭

依据两个 rc 的发布说明与 `dsh-base` / `dsh-web-app` 0.1.7-rc.2→0.2.0-rc.2 的组合 diff（web-app 新增 desktop-product-telemetry、product-analytics、ui-settings-session-log，移除 schedule、time-context、ui-schedule；base 新增 otel）。

### 吸收（免费获得或已启用）

| 能力 | 说明 |
| --- | --- |
| 工具调度异常修复 | 对话不再因调度失败卡死；未知副作用的操作要求先核实再重试。宿主行为，直接获得。 |
| 图片失效自动重传 | 会话请求可靠性改进，直接获得。 |
| Bash/PowerShell 删除前核对路径 | 工具提示加强，直接获得。 |
| 持久 PowerShell 完成标记修复 | 直接获得。 |
| Windows 沙箱权限诊断技能 | 宿主内置技能，直接获得（诊断与修复合并为一次授权运行，留备份）。 |
| 模型目录更新（pi-ai 0.87.1） | 旧模型 ID 被移除；仓库无硬编码模型 ID，无需改动。用户已保存的模型选择若指向被移除的 ID，需重新选择——属用户态数据，不自动迁移。 |
| 计划审阅/Agent 预设/终端菜单等修复 | 直接获得。 |

### 关闭或保持关闭

| 能力 | 处理 |
| --- | --- |
| 自动化任务（schedule/ui-schedule/time-context） | 0.2.0 起移出 web-app，由可选插件包提供。桌面组合本就在 `apps/desktop/resources/profile/cordis.patch.yml` 禁用 schedule/ui-schedule；保留这两条禁用作为护栏，防止日后安装官方自动化包后在编辑器里点亮。time-context 从未进入编辑器组合，无需处理。 |
| desktop-product-telemetry / product-analytics | 上游自带 `disabled: profileContext?.name !== 'desktop'` 条件，编辑器 profile 名为 dsh-editor，天然不启用，无需额外禁用。 |
| otel / session-telemetry-otel | 默认 `FEEDBACK_ONLY`（仅用户显式反馈后释放会话日志前缀），与 0.1.7 策略一致，保持默认。 |
| ui-settings-session-log | 0.2.0 新增的官方设置区块（会话日志导出）。编辑器设置对话框由 shell 自有实现接管，已在 profile patch 中追加禁用，与 ui-settings-general/models 一致。 |
| DeepSeek 账号模型免 key 网页搜索 | 编辑器策略不变：原生 web-search-deepseek / tool-web / web-fetch-http 保持禁用，搜索仍走显式授权的 @klarkxy/dsh-web-search-manager。 |
| 实验性异步问答模式 | 需手动配置才开启，默认关。编辑器以自己的 pending-interaction 卡片承载提问/审批，不开启。 |
| 桌面端内置 dsh 命令（菜单栏管理） | 属官方桌面应用功能；编辑器桌面端自带运行时与 scripts/dsh-cli.mjs 解析链，不采用。 |

### 可选的后续吸收（未做）

- 模型选择器模糊搜索：官方 ui-model-selection 已禁用，编辑器自有选择器可参考其模糊匹配+键盘选择交互。
- 侧栏「用本地应用打开当前文件夹」：官方实现在 ui-open-in-app（编辑器侧栏自有，可借鉴）。

### 行为变化：插件配置页挂载点

0.2.0 的官方插件页把 `plugins.bundle.config` 槽位内容挂到按包生成的配置页（显示为插件名，如「知乎」）；插件客户端按 label 注册产生的链接（如知乎的「知乎资料」）仍出现在导航里，但页面为空。其他 klarkxy 插件（memory、model-center、web-search-manager）因 label 与包名一致，不受影响；只有知乎出现「知乎资料（空）+ 知乎（有内容）」两条导航。功能面板可达，属上游 UX 瑕疵；compositions e2e 已改为点「知乎」。若后续要消除重复链接，需要知乎插件去掉自定义 label 或上游合并两类入口。

### 行为变化：快捷键按平台严格匹配

0.2.0 的官方快捷键适配器按平台绑定严格匹配：web 平台只认 `web:*` 绑定（编辑器注册为 Ctrl+Alt+K/B/J/L/F 等，避开浏览器保留键），不再像 0.1.7 那样宽松命中桌面绑定（Ctrl+K/B/L）。桌面（Electron）端行为不变，仍认 `desktop:*` 绑定。实测：Chromium 中 Ctrl+Alt+L 可聚焦写作搭档输入框，Ctrl+L 不再触发。受影响的是跑在 Chromium 里的 e2e（core-loop、writing-shortcuts），已把按键改为 web 绑定；真实浏览器用户同样需用带 Alt 的组合键，这与 0.1.7 的注册意图一致，只是上游现在真正强制了。

## 验证记录

- 全仓类型检查通过；全量 Vitest 194 个文件、1541 项通过、4 项跳过。
- 全仓构建通过；`node --test scripts/external-plugins.test.mjs` 10 项通过。
- 桌面 e2e（test:e2e:desktop）通过。曾出现一次 `版本冲突` 等待超时的偶发失败，重跑通过，判定为时序抖动而非升级回归。
- 桌面 e2e 中可见新模型目录生效（DeepSeek-V41-Flash / V4-Pro 等新 ID）。
- inspect.spec.ts 的 peer 范围断言按新钉住版本重写语义（真实 semver 比较器行为不变）。
- core-loop e2e 暴露上述快捷键严格匹配变化，改用 web 绑定按键后通过；桌面端快捷键不受影响（test:e2e:desktop 通过为证）。
- writing-shortcuts e2e 通过（面板快捷键断言同步改为 web 绑定 Ctrl+Alt+K）。
- composition e2e（desktop 组合）通过；暴露上述插件配置页挂载变化后改用「知乎」入口。
- 全新安装后 Electron dist 曾被 pnpm postinstall 清空且脚本内 Expand-Archive 兜底失败（powershell.exe 子进程解压经由 junction 的目标目录失败）；已用 .NET ZipFile 手动解出 dist 恢复。属开发环境事故，非升级回归。
- core-loop 曾出现一次「新建文件」对话框卡在保存中的偶发失败，重跑通过，判定为时序抖动。

未运行完整桌面打包（pack:desktop）、安装程序发布与组合矩阵 e2e；发布前需补齐。
