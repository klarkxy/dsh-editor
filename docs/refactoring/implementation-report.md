# 面板基础重构实施与验收记录

**日期**: 2026-10-07
**基线提交**: `62a2b01`
**分支**: `refactor/phase2-panel-base`
**当前状态**: 实施完成，本次重构独立验收通过

> **说明**: 任务开始时已有未提交工作区改动，基线提交不等于初始工作区快照。

---

## 实施范围

### 修改的包

- `dsh-editor-memory-panel`: `rpc.ts`, `requests.ts`, `messages.ts`, `package.json`
- `dsh-editor-overview-panel`: `rpc.ts`, `requests.ts`, `messages.ts`, `package.json`
- `dsh-editor-proofread-panel`: `rpc.ts`, `requests.ts`, `messages.ts`, `package.json`
- `dsh-editor-panel-base`: 新增包

### 修改的基础设施

- `dsh-editor-workbench`: 6 个测试文件的引用路径
- `tsconfig.base.json`, `vitest.config.ts`: 入口配置
- `pnpm-lock.yaml`: 锁文件
- `e2e/core-loop.mjs`: main banner 选择器和三面板实用流程

### 未变更的文件

当前三个 `panel.tsx` 相对 HEAD 没有 diff。

---

## 验证结果

### 构建与类型检查

| 命令 | 结果 | 证据 |
|---|---|---|
| `pnpm build` | 通过 | 退出码 0，所有包构建成功 |
| `pnpm typecheck` | 通过 | 退出码 0 |

### 测试

| 范围 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `pnpm test --maxWorkers=2` | 通过：204 files, 1649 passed, 4 skipped |
| 面板相关测试 | 见 `.artifacts/refactor-acceptance/` 日志 | 通过：8 files, 43 passed |

### 兼容性验证

- 通过：三个面板 zh/en 全部词典 AST 与 HEAD 等价
- 通过：旧 API、locale 隔离保持
- 通过：错误处理与竞态处理保持
- 通过：所有 exports 路径可访问
- 通过：Manifest 加载成功

### UI 漂移检查

| 检查 | 结果 |
|---|---|
| 基准对比 | 通过：9/9 |
| 增量检查（原 3 文件） | 通过：无新增漂移 |

### 设计契约

通过：14/14

### 其他验证

- 通过：`pnpm install --offline --frozen-lockfile --ignore-scripts --lockfile-only` 冻结锁文件检查
- 通过：`node e2e/ui-design.mjs` 组件浏览器 fixture
- 通过：`node e2e/core-loop.mjs` 独立验收（退出码 0，report.json `{ok: true, failures: []}`）

> **说明**: `core-loop` 在隔离的真实 DSH 环境上运行 Chromium 浏览器流程，验证作品创建重开、保存到磁盘、主题重载、聊天草稿与专注模式、三个面板真实加载关闭。记忆面板使用测试 profileRoot 配置启用，生产默认仍 disabled。非 Electron 安装包启动，非付费真实模型回合。

### 验证日志与截图

- 日志：[.artifacts/refactor-acceptance/core-loop.log](../../.artifacts/refactor-acceptance/core-loop.log)
- 截图：
  - [文档概览面板](../../e2e/out/core-loop/03-overview-panel.png)
  - [文稿校对面板](../../e2e/out/core-loop/04-proofread-panel.png)
  - [记忆维护面板](../../e2e/out/core-loop/05-memory-panel.png)

---

## 未验证事项

- Electron 安装包启动与签名
- 发布流程
- 真实用户持续运行环境

---

## 保持不变的保证

- 通过：作者写入权限契约未改变
- 通过：稿件版本校验未改变
- 通过：写队列行为未改变
- 通过：测试断言未削弱

---

## Git 状态

当前改动未提交，未推送。

---

## 相关文档

- [重构方案](./refactoring-plan.md)
- [重构文档索引](./README.md)
