# DSH Editor 架构重构方案 - 精简版

历史留档：本文保留 2026-10-06 的候选方案，部分拆包与新增层的建议未采用。当前实现见[架构决策](architecture.md)与[包目录](../packages/README.md)。

> **状态**: 可执行方案 v1.0  
> **更新日期**: 2026-10-06  
> **架构健康度**: ⚠️ 5/10  
> **目标**: 解决3个P0严重问题,建立清晰的13个包的组织结构

---

## 包范围说明

### 本仓库保留的13个包 (需要重构)

```
apps/
└─ desktop/                        # Electron应用

packages/
├─ dsh-manuscript                  # 稿纸核心 (11885行)
├─ dsh-proofread                   # 校对引擎
├─ dsh-editor-shell                # 写作界面 (31870行 ⚠️)
├─ dsh-editor-workbench            # 工作台 (10112行 ⚠️)
├─ dsh-editor-workspace-kit        # 工具库 (1264行)
├─ dsh-editor-seats                # 界面合同
├─ dsh-editor-plugins              # 插件管理
├─ dsh-editor-novel-kernel         # 小说工具
├─ dsh-editor-writing-presets      # 写作预设 (24行,几乎为空)
├─ dsh-editor-cards                # 人物卡
├─ dsh-editor-memory-panel         # 记忆面板 (891行)
├─ dsh-editor-overview-panel       # 概览面板 (1073行)
└─ dsh-editor-proofread-panel      # 校对面板 (1308行)
```

### 已迁移到 dsh-plugins 仓库 (不处理)

- AI Services, Model Center, Memory, Self-improvement, Fusion (已退役)
- dsh-current-title, dsh-mood, dsh-recap, dsh-zhihu (按需安装)
- dsh-web-search-manager (外部维护,Editor 预装 0.1.11)

---

## 一、当前架构的3个严重问题

### 🔴 问题1: workbench过载 (10112行,被5个包依赖)

**承担的7个职责**:
1. 作品生命周期 (lifecycle.ts)
2. 文件导入导出 (import.ts, snapshot.ts)
3. 校对集成 (proofread.ts)
4. 概览数据 (overview.ts)
5. 提案系统 (proposal-ops.ts)
6. Agent工具注册 (observe-tool.ts, novel-tools.ts)
7. 作者偏好 (author-preferences/)

**依赖它的包**: novel-kernel, memory-panel, overview-panel, proofread-panel, shell(devDep)

**影响**: 任何修改都可能影响5个包,无法独立测试

### 🔴 问题2: 3个面板包重复代码模式

每个面板都有完全相同的结构:
- `messages.ts` - 消息定义
- `requests.ts` - RPC请求
- `rpc.ts` - RPC实现
- `styles.ts` - 样式管理
- `*-view.ts` - 视图组件

**缺失**: 统一的面板基础设施

### 🔴 问题3: shell边界消失 (31870行,197个文件)

包含的不该在这里的内容:
- Chat对话流 (176行)
- 模型选择器
- 导入流程
- 历史对话
- 作者记忆
- 辅助文件管理
- 提案审批UI

**应该只包含**: 三栏布局 + 设计系统

---

## 二、目标架构 (13个包的清晰组织)

### 新的目录结构

```
dsh-editor/
├── apps/
│   └── desktop/                   # 应用入口
│
├── packages/
│   ├── core/                      # 核心层 (3个包)
│   │   ├── contracts/             # 新建:类型定义
│   │   ├── workspace-core/        # 重构:纯工具函数
│   │   └── plugin-sdk/            # 整合:seats + @klarkxy/dsh-plugin-kit
│   │
│   ├── domain/                    # 领域层 (5个包)
│   │   ├── manuscript/            # 迁移:dsh-manuscript
│   │   ├── proofread/             # 迁移:dsh-proofread
│   │   ├── novel/                 # 迁移:dsh-editor-novel-kernel
│   │   ├── writing-presets/       # 迁移or合并:24行空包
│   │   └── workbench-core/        # 拆分:只保留生命周期
│   │
│   ├── ui/                        # UI层 (5个包)
│   │   ├── design-system/         # 提取:从shell提取tokens/styles
│   │   ├── shell/                 # 精简:只保留布局
│   │   └── panels/                # 重组:统一管理
│   │       ├── base/              # 新建:面板基础设施
│   │       ├── cards/             # 迁移:dsh-editor-cards
│   │       ├── memory/            # 迁移:dsh-editor-memory-panel
│   │       ├── overview/          # 迁移:dsh-editor-overview-panel
│   │       └── proofread/         # 迁移:dsh-editor-proofread-panel
│   │
│   └── features/                  # 功能层 (新建,拆分自现有包)
│       ├── proposals/             # 从workbench提取
│       ├── agent-tools/           # 从workbench提取
│       ├── integrations/          # 从workbench提取
│       └── plugin-discovery/      # 重构:dsh-editor-plugins
```

### 包数量变化

| 层级 | 当前 | 目标 | 变化 |
|------|------|------|------|
| 应用层 | 1 | 1 | 不变 |
| 核心层 | 2 | 3 | +1 (新增contracts) |
| 领域层 | 5 | 5 | 重组 |
| UI层 | 5 | 6 | +1 (新增design-system和panels/base) |
| 功能层 | 0 | 4 | +4 (从workbench/plugins拆分) |
| **总计** | **13** | **19** | **+6个新包** |

---

## 三、6阶段迁移路线图

### 阶段0: 准备工作 (3天)

**目标**: 建立迁移基础设施

1. 创建 `refactor/arch-v2` 分支
2. 建立自动化脚本:
   ```bash
   scripts/refactor/
   ├── move-package.mjs       # 移动包并更新import
   ├── extract-module.mjs     # 提取模块到新包
   └── validate-deps.mjs      # 验证依赖关系
   ```
3. 完善E2E测试基准
4. 创建回滚检查点

**验证**: 所有测试在当前状态通过

---

### 阶段1: P0-拆分workbench (1周)

**目标**: 从10112行减少到~3000行

#### 步骤1.1: 提取提案系统 (2天)

**新建** `packages/features/proposals/`:
```
src/
├── proposal-ops.ts        # 从workbench移动
├── contracts.ts           # 提取接口
└── index.ts
```

**影响**: shell, novel-kernel  
**测试**: E2E提案流程

#### 步骤1.2: 提取Agent工具注册 (2天)

**新建** `packages/features/agent-tools/`:
```
src/
├── observe-tool.ts        # 从workbench移动
├── novel-tools.ts         # 从workbench移动
├── registry.ts            # 新建统一注册器
└── contracts.ts
```

**依赖变化**:
- novel-kernel: workbench → agent-tools
- workbench: → agent-tools (注册工具)

#### 步骤1.3: 提取集成层 (2天)

**新建** `packages/features/integrations/`:
```
src/
├── proofread.ts           # 从workbench移动
├── overview.ts            # 从workbench移动
└── contracts.ts
```

**依赖变化**:
- 3个面板包: workbench → integrations

#### 步骤1.4: 瘦身workbench (1天)

**重命名** workbench → `packages/domain/workbench-core/`  
**保留职责**:
- lifecycle.ts
- snapshot.ts
- import.ts (考虑后续迁移到features)

**验证**: 
- [ ] workbench从10112行减到~3000行
- [ ] 所有E2E测试通过
- [ ] 5个依赖包构建成功

---

### 阶段2: P0-建立面板基础设施 (1周)

**目标**: 消除3个面板的重复代码

#### 步骤2.1: 创建面板基础包 (3天)

**新建** `packages/ui/panels/base/`:
```
src/
├── panel-provider.tsx     # 统一Provider
├── rpc-client.ts          # RPC客户端生成器
├── message-types.ts       # 消息类型工厂
├── styles.ts              # 样式桥接
└── contracts.ts
```

**提供能力**:
- 类型安全的RPC通信
- 统一的生命周期管理
- 样式token桥接

#### 步骤2.2: 重构3个面板 (2天)

逐个迁移:
1. memory-panel (891行 → ~400行)
2. overview-panel (1073行 → ~500行)
3. proofread-panel (1308行 → ~600行)

**删除**: 每个面板的 `messages.ts`, `rpc.ts` (使用base生成)  
**保留**: 业务逻辑和视图组件

#### 步骤2.3: 重组面板目录 (1天)

```
packages/ui/panels/
├── base/                  # 基础设施
├── cards/                 # 从packages/移动
├── memory/                # 从packages/移动
├── overview/              # 从packages/移动
└── proofread/             # 从packages/移动
```

**验证**:
- [ ] 3个面板减少~50%代码
- [ ] cards迁移成功
- [ ] 所有面板功能正常

---

### 阶段3: P0-精简shell (1周)

**目标**: 从31870行减到~15000行

#### 步骤3.1: 提取设计系统 (3天)

**新建** `packages/ui/design-system/`:
```
src/
├── tokens.ts              # 从shell移动
├── styles.ts              # 从shell移动
├── gallery.tsx            # 从shell移动
├── components/            # 基础组件
└── index.ts
```

**更新**: 所有包从 `design-system` 导入tokens

#### 步骤3.2: 移出配置管理 (2天)

**移动到** `packages/features/writing-config/`:
- writing-config.ts
- developer-config.ts
- limit-break-config.ts

**shell保留**: 只有配置UI,不包含配置逻辑

#### 步骤3.3: 移出非UI组件 (2天)

**移动目标**:
- Chat对话流 → features/conversations
- 导入流程 → domain/workbench-core 或 features/import
- 历史对话 → features/history
- 作者记忆 → features/author-memory (或考虑删除)

**shell最终内容**:
```
src/
├── layout/                # 三栏布局
├── settings-ui/           # 设置页面UI
├── adapter.ts             # 保留
└── index.ts
```

**验证**:
- [ ] shell减少到~15000行
- [ ] 设计系统可独立使用
- [ ] 所有UI功能正常

---

### 阶段4: P1-建立核心层 (1周)

**目标**: 明确core层边界

#### 步骤4.1: 创建contracts包 (2天)

**新建** `packages/core/contracts/`:
```
src/
├── workspace.ts           # 工作区接口
├── plugin.ts              # 插件接口
├── panel.ts               # 面板接口
├── domain.ts              # 领域接口
└── index.ts
```

**提取来源**: 所有包中的共享类型

#### 步骤4.2: 重构workspace-kit (2天)

**重命名** → `packages/core/workspace-core/`  
**重构**:
- 移除对 manuscript 的依赖
- 只保留纯工具函数
- 依赖 contracts

**如果实在需要manuscript**:
- 通过contracts接口依赖
- 或将相关功能移回domain层

#### 步骤4.3: 整合plugin-sdk (2天)

**新建** `packages/core/plugin-sdk/`:
- 合并 dsh-editor-seats
- 合并 @klarkxy/dsh-plugin-kit 的本地使用
- 提供统一的插件开发SDK

**验证**:
- [ ] core/* 不依赖domain/*
- [ ] contracts被所有包使用
- [ ] workspace-core不依赖具体领域

---

### 阶段5: P1-重组领域层和功能层 (1周)

#### 步骤5.1: 迁移领域包到domain/ (2天)

简单移动:
```bash
dsh-manuscript → packages/domain/manuscript/
dsh-proofread → packages/domain/proofread/
dsh-editor-novel-kernel → packages/domain/novel/
```

#### 步骤5.2: 处理writing-presets (1天)

**选项A**: 合并到 dsh-editor-plugins  
**选项B**: 合并到 domain/novel  
**选项C**: 扩展为真正的预设系统

**决策**: 根据实际使用情况选择

#### 步骤5.3: 重构plugins包 (2天)

**拆分** dsh-editor-plugins:
- 插件发现 → features/plugin-discovery
- 写作模式 → features/writing-modes (或合并到writing-config)
- 核心锁定 → 保留或移到plugin-sdk

**验证**:
- [ ] domain/* 只依赖core/*
- [ ] features/* 可以依赖所有层
- [ ] 职责边界清晰

---

### 阶段6: 收尾和文档 (3-4天)

#### 步骤6.1: 更新构建和测试 (2天)

- 更新 pnpm-workspace.yaml
- 更新所有 tsconfig.json references
- 更新 E2E测试路径
- 修复所有类型错误

#### 步骤6.2: 更新文档 (1天)

- 同步所有 README.md
- 更新 packages/README.md
- 更新根 README.md
- 更新 docs/architecture.md
- 生成新的架构图

#### 步骤6.3: 最终验证 (1天)

运行完整验证套件:
```bash
pnpm typecheck         # 类型检查
pnpm test              # 单元测试
pnpm build             # 构建所有包
pnpm test:e2e:desktop  # 桌面E2E
pnpm test:e2e:core-loop # 核心流程
pnpm pack:desktop      # 打包验证
```

**验证清单**:
- [ ] 所有类型检查通过
- [ ] 所有测试通过
- [ ] 构建成功
- [ ] E2E测试通过
- [ ] 打包成功
- [ ] 无循环依赖
- [ ] 文档与代码一致

---

## 四、依赖方向验证

### 重构后的依赖规则

```
apps/desktop
  ↓ 可依赖所有 packages

packages/features/*
  ↓ 可依赖 domain, ui, core

packages/ui/*
  ↓ 可依赖 core, 不可依赖 domain

packages/domain/*
  ↓ 只可依赖 core

packages/core/*
  ↓ 最小外部依赖,不依赖其他 packages
```

### 关键限制

- ❌ UI 不能直接依赖 Domain 实现
- ❌ Core 不能依赖 Domain
- ❌ Domain 包之间不能互相依赖
- ✅ 通过 contracts 定义依赖关系
- ✅ Features 层作为协调层

---

## 五、风险与缓解

### 风险1: 重构破坏现有功能

**影响**: 高  
**概率**: 中

**缓解**:
- 每个阶段后运行完整E2E测试
- 保持功能特性不变,只改结构
- 创建详细的测试基准
- 准备回滚计划

### 风险2: 包拆分过细,增加复杂度

**影响**: 中  
**概率**: 中

**缓解**:
- 只拆分有明确职责边界的包
- 避免过度工程化
- workbench拆分后验证是否真的更好维护
- 如果某个拆分效果不好,可以合并回去

### 风险3: 迁移时间超预期

**影响**: 中  
**概率**: 高

**缓解**:
- 每个阶段设置时间上限
- P0问题优先,P1可以延后
- 如果某阶段卡住,先完成其他阶段
- 增量交付,不追求一次完美

### 风险4: 外部插件兼容性

**影响**: 低  
**概率**: 低

**缓解**:
- 本次重构不影响外部插件API
- plugin-sdk保持向后兼容
- seats合同不变
- 已迁移的外部包不受影响

---

## 六、成功标准

### 定量标准

- [ ] workbench从10112行减少到<3500行
- [ ] shell从31870行减少到<16000行
- [ ] 3个面板平均代码量减少>40%
- [ ] 包的平均依赖数<5个
- [ ] 无循环依赖
- [ ] 构建时间不增加>10%
- [ ] 所有E2E测试通过

### 定性标准

- [ ] 新开发者可在2小时内理解架构
- [ ] 新功能开发时可明确选择目标包
- [ ] 每个包可独立开发和测试
- [ ] 文档与代码实现一致
- [ ] 修改workbench不影响无关功能

---

## 七、时间估算

| 阶段 | 工作量 | 依赖关系 |
|------|--------|----------|
| 阶段0: 准备 | 3天 | - |
| 阶段1: 拆分workbench | 1周 | 依赖阶段0 |
| 阶段2: 面板基础设施 | 1周 | 可与阶段1并行 |
| 阶段3: 精简shell | 1周 | 依赖阶段1 |
| 阶段4: 核心层 | 1周 | 依赖阶段1-3 |
| 阶段5: 重组领域层 | 1周 | 依赖阶段4 |
| 阶段6: 收尾文档 | 3-4天 | 依赖所有 |

**总计**: 约6-7周 (单人全职)

**关键路径**: 阶段0 → 1 → 3 → 4 → 5 → 6  
**可并行**: 阶段2可与阶段1并行

---

## 八、立即可执行的第一步

### 今天就可以开始

1. **创建重构分支**:
   ```bash
   git checkout -b refactor/arch-v2
   ```

2. **建立测试基准**:
   ```bash
   pnpm test > tests-baseline.txt
   pnpm test:e2e:desktop
   ```

3. **创建迁移脚本框架**:
   ```bash
   mkdir -p scripts/refactor
   # 创建 move-package.mjs, extract-module.mjs, validate-deps.mjs
   ```

4. **第一个实际改动 - 提取提案系统**:
   ```bash
   # 创建新包
   mkdir -p packages/features/proposals
   # 复制 workbench 的 proposal-ops.ts
   # 更新 import 路径
   # 运行测试验证
   ```

### 本周可完成

- 阶段0: 准备工作
- 阶段1.1: 提取提案系统
- 阶段1.2: 提取Agent工具注册

### 本月可完成

- 完成阶段1: workbench拆分
- 完成阶段2: 面板基础设施
- 开始阶段3: shell精简

---

## 九、决策记录

### 需要确认的设计决策

1. **writing-presets包处理方式**:
   - [ ] 选项A: 合并到plugins
   - [ ] 选项B: 合并到novel
   - [ ] 选项C: 扩展为完整预设系统
   - [ ] 决策: _______

2. **workspace-kit是否需要依赖manuscript**:
   - [ ] 是,通过contracts接口
   - [ ] 否,将相关功能移到domain
   - [ ] 决策: _______

3. **作者记忆功能归属**:
   - [ ] 保留在features/author-memory
   - [ ] 合并到memory-panel
   - [ ] 删除(功能重复)
   - [ ] 决策: _______

4. **是否保留dsh-editor-前缀**:
   - [ ] 保留,便于识别私有包
   - [ ] 去除,目录已经说明归属
   - [ ] 决策: _______

---

## 十、后续优化(不在本次范围)

以下问题不在本次重构范围,留待后续独立处理:

- 测试文件从src/移到独立test/目录
- 公开包与私有包物理分离
- 性能优化和构建优化
- 插件热重载机制改进
- 设计系统的组件库文档站点

---

**文档版本**: v1.0  
**最后更新**: 2026-10-06  
**状态**: ✅ 可执行方案,等待确认启动

**下一步**: 请确认是否同意此方案,我将开始执行阶段0的准备工作
