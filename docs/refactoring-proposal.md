# DSH Editor 架构重构方案

> **状态**: 草案 - 待完善  
> **创建日期**: 2026-10-06  
> **目标**: 解决当前架构混乱问题,建立清晰的模块边界和依赖关系

---

## 一、当前架构问题诊断

> **架构健康度评分**: ⚠️ **5/10**  
> **代码规模**: 13个workspace包，404个TS/TSX文件，核心包最大31870行  
> **分析方法**: 静态代码扫描 + package.json依赖分析 + 文档审查

### 1.1 实际依赖层次(基于代码分析)

```
L0 基础层 (无内部依赖)
├─ dsh-manuscript        稿纸编辑器 (11885行)
├─ dsh-proofread         中文校对引擎
└─ dsh-editor-seats      界面座位合同

L1 工具层 (依赖L0)
├─ dsh-editor-workspace-kit  → manuscript (仅1264行,名实不符)
└─ dsh-editor-plugins        → manuscript, seats

L2 核心层 (依赖L0+L1)
├─ dsh-editor-workbench  → workspace-kit, manuscript, proofread (⚠️ 10112行过载)
└─ dsh-editor-cards      → workspace-kit, manuscript

L3 功能层 (依赖L0+L1+L2)
├─ dsh-editor-novel-kernel       → workbench, manuscript
├─ dsh-editor-memory-panel       → seats, workbench
├─ dsh-editor-overview-panel     → seats, workbench
└─ dsh-editor-proofread-panel    → seats, workbench

L4 外壳层
└─ dsh-editor-shell  → (devDep) novel-kernel, workbench, manuscript (⚠️ 31870行巨大)

L5 应用层
└─ apps/desktop      Electron应用
```

### 1.2 严重问题 (P0) - 阻碍扩展和维护

#### **问题1: dsh-editor-workbench 职责过载,成为中心化依赖**

**代码证据**:
- 10112行代码,77个文件
- 同时承担7个不相关职责:
  - 作品生命周期管理 (`lifecycle.ts`)
  - 文件导入/导出 (`import.ts`, `snapshot.ts`)
  - 校对集成 (`proofread.ts`)
  - 概览数据 (`overview.ts`)
  - 提案系统 (`proposal-ops.ts`)
  - Agent工具注册 (`observe-tool.ts`, `novel-tools.ts`)
  - 作者偏好持久化 (`author-preferences/`)

**影响范围**:
- 5个包直接依赖它: novel-kernel + 3个面板 + shell(devDep)
- 任何修改都可能影响多个不相关功能
- 无法独立测试或替换单一功能
- grep显示16处从其他包导入workbench的contracts

**风险**: 🔴 **高** - 修改workbench影响5个包,测试困难

#### **问题2: dsh-editor-shell 边界消失,31870行巨型包**

**代码证据**:
- 197个文件,是第二大包的3倍
- 职责混杂:
  - ✅ 应有: 三栏布局、设计系统
  - ❌ 不应有: Chat对话流(176行)、模型选择器、导入流程、历史对话、作者记忆、辅助文件管理、提案审批UI

**目录混乱**:
```
src/
├─ design-system/        # 设计系统 (应独立)
├─ client/ui/            # UI组件
├─ adapter.ts            # 业务逻辑
├─ capabilities.ts       # 能力检测
├─ writing-config.ts     # 配置 (应分离)
└─ developer-config.ts   # 配置 (应分离)
```

**影响**: 单包承载过多层次,导航困难,边界模糊

#### **问题3: 三个面板包重复实现相同模式**

**代码证据**:
- `dsh-editor-memory-panel` (891行)
- `dsh-editor-overview-panel` (1073行)
- `dsh-editor-proofread-panel` (1308行)
- 三者都有完全相同的文件结构:
  - `messages.ts` - 消息类型定义
  - `requests.ts` - RPC请求
  - `rpc.ts` - RPC实现
  - `styles.ts` - 样式管理
  - `*-view.ts` - 视图组件

**缺失抽象**: 应有 `dsh-editor-panel-base` 提供:
- 统一的RPC通信模式
- 消息类型生成器
- 样式桥接工具
- 生命周期管理

**影响**: 🟡 **中** - 新增面板需要复制3遍代码模板

### 1.3 重要问题 (P1) - 影响清晰度和一致性

#### **问题4: 代码组织模式不一致**

| 维度 | 模式A | 模式B | 包分布 |
|------|-------|-------|--------|
| **目录结构** | 有 client/host 子目录 | 平坦 src/ | 3个 vs 10个 |
| **导出结构** | 多个子路径 (./contracts, ./tools) | 单一入口 | 不统一 |
| **测试位置** | .spec.ts 混在源码 | 单独 test/ | 全是混合 |
| **样式管理** | 独立 styles.ts | 无样式文件 | 5个 vs 8个 |

**影响**: 开发者无法预测文件位置,缺少统一规范

#### **问题5: dsh-editor-workspace-kit 名实不符**

**代码证据**:
- 名为"workspace-kit"但只有11个文件,1264行
- 实际只提供: frontmatter解析 + 少量文件工具
- 真正的工作区能力在 `dsh-editor-workbench` 里

**依赖方向问题**:
```
workspace-kit (工具层) → manuscript (领域层)
```
违反了"工具库不依赖具体领域"的原则

#### **问题6: dsh-editor-plugins 职责混杂**

同时处理三个不相关的关注点:
- GitHub插件发现 (`github.ts`)
- 写作模式管理 (`writing-presets.ts`, `presets.ts`)
- 核心锁定 (`core.ts`)
- 持久化 (`persist.ts`)

**应拆分为**:
- 插件适配器 (发现、安装)
- 写作模式注册 (独立关注点)

#### **问题7: 循环依赖风险(通过devDependencies)**

虽然是devDep,但暗示了类型/测试的耦合:
- `dsh-editor-shell` devDep → `novel-kernel`, `workbench`
- `dsh-editor-novel-kernel` → `workbench`
- `dsh-editor-cards` devDep → `seats`
- `dsh-manuscript` devDep → `seats`

**风险**: 重构时可能形成真实循环依赖

### 1.4 次要问题 (P2) - 技术债务

#### **问题8: 设计系统散落各处**

- shell: `design-system/tokens.ts`, `styles.ts`, `gallery.tsx`
- 3个面板各有 `styles.ts`
- plugins: `client-styles.ts`
- cards: `styles.ts`

**影响**: 没有统一的设计token消费模式,虽然seats提供tokens但使用不一致

#### **问题9: 公开包与私有包边界不清**

2个公开包 (dsh-manuscript, dsh-proofread) 与11个私有包混在 `packages/` 下:
- 公开API变更可能意外破坏内部使用
- 文档维护负担 (README.md vs docs/README.zh-CN.md)
- dsh-manuscript既是独立npm包又被内部依赖

#### **问题10: dsh-editor-writing-presets 几乎为空**

只有2个文件24行代码,不清楚为何独立成包,可能应该:
- 合并到 dsh-editor-plugins
- 或作为 resources 目录

### 1.5 架构债务的实际影响

根据代码分析,当前架构导致:

- ❌ **修改workbench影响5个包**: novel-kernel, memory-panel, overview-panel, proofread-panel, shell
- ❌ **新增面板需要复制891-1308行模板代码**: RPC + messages + styles + view
- ❌ **shell的197个文件难以导航**: 设计系统与业务逻辑混杂
- ❌ **workspace-kit命名误导**: 实际能力远小于名称暗示
- ❌ **测试边界模糊**: devDependencies暗示了类型耦合

---

## 二、重构目标与原则

### 2.1 核心目标

1. **清晰的分层架构**: 建立 Platform → Core → Feature → UI 的清晰层次
2. **明确的模块边界**: 每个包有单一清晰的职责,依赖方向单向且可预测
3. **可扩展性**: 新功能可以独立开发和测试,不污染核心层
4. **保持产品契约**: 遵守现有的产品原则和架构决策,不破坏信任边界

### 2.2 重构原则

#### **保持约束**
- ✅ DSH 0.2.0-rc.2 作为运行时权威,不复制状态
- ✅ 稿纸优先的产品原则不变
- ✅ React / Electron / Radix / CodeMirror 技术栈不变
- ✅ 官方插件管理器与 native profile 机制不变
- ✅ 信任与写入边界不放松

#### **改进方向**
- 📦 重新组织包结构,建立清晰的目录分层
- 🔗 梳理依赖关系,消除循环依赖和不必要的耦合
- 📋 明确每个包的职责,拆分过大的包
- 🎯 统一命名规范,区分核心/功能/UI/工具
- 📚 同步更新文档,使架构意图可见

---

## 三、目标架构设计

### 3.1 新的包组织结构

```
dsh-editor/
├── packages/
│   ├── core/                      # 核心层 - 最小依赖
│   │   ├── contracts/             # 类型定义和接口契约
│   │   ├── workspace-core/        # 工作区核心逻辑(原 workspace-kit 核心部分)
│   │   └── plugin-sdk/            # 插件开发SDK(整合 seats + plugin-kit)
│   │
│   ├── domain/                    # 领域层 - 业务逻辑
│   │   ├── manuscript/            # 稿纸核心(原 dsh-manuscript)
│   │   ├── proofread/             # 校对核心(原 dsh-proofread)
│   │   ├── novel/                 # 小说领域知识(原 dsh-editor-novel-kernel)
│   │   ├── writing-presets/       # 写作预设(原 dsh-editor-writing-presets)
│   │   └── workbench/             # 工作台逻辑(原 dsh-editor-workbench 拆分)
│   │
│   ├── ui/                        # UI层 - 视觉组件
│   │   ├── design-system/         # 设计系统tokens和基础组件
│   │   ├── shell/                 # 外壳UI(原 dsh-editor-shell 拆分)
│   │   ├── panels/                # 面板组件集合
│   │   │   ├── overview/          # 文档概览
│   │   │   ├── memory/            # 记忆面板
│   │   │   ├── proofread/         # 校对面板
│   │   │   └── cards/             # 人物卡/世界书
│   │   └── components/            # 通用UI组件库
│   │
│   └── features/                  # 功能层 - 完整特性
│       ├── editor-integration/    # 编辑器集成特性
│       ├── plugin-discovery/      # 插件发现(原 dsh-editor-plugins 部分)
│       └── writing-modes/         # 写作模式管理
│
└── apps/
    ├── desktop/                   # 桌面应用入口
    └── web/                       # Web应用入口(如需要)
```

### 3.2 依赖方向规则

```
apps/*  
  ↓ 可依赖所有 packages
  
packages/features/*
  ↓ 可依赖 domain, ui, core
  
packages/ui/*
  ↓ 可依赖 core, 部分 domain contracts
  
packages/domain/*
  ↓ 只可依赖 core
  
packages/core/*
  ↓ 最小外部依赖,不依赖其他 packages
```

### 3.3 核心包职责定义

| 包 | 职责 | 可依赖 |
|---|---|---|
| `core/contracts` | 类型定义、接口契约、通用协议 | 无 packages 依赖 |
| `core/workspace-core` | 工作区文件操作、元数据管理 | contracts |
| `core/plugin-sdk` | 插件开发SDK、座位系统、hooks | contracts |
| `domain/manuscript` | 稿纸编辑核心逻辑 | core/* |
| `domain/workbench` | 项目生命周期、快照、校对调度 | core/*, domain/manuscript, domain/proofread |
| `ui/design-system` | Tokens、主题、基础组件 | core/contracts |
| `ui/shell` | 三栏布局、设置页、路由 | core/*, ui/design-system |
| `ui/panels/*` | 各功能面板UI | core/*, ui/design-system |
| `features/*` | 组合多个domain+ui的完整功能 | 任意 |
| `apps/desktop` | 桌面应用组装、Electron集成 | 任意 |

---

## 四、迁移路线图(基于实际代码分析)

### 阶段一: P0问题-解除workbench过载 (2-3周)

**目标**: 拆分10112行的workbench,消除中心化瓶颈

#### 步骤1.1: 提取提案系统 (3天)
```bash
packages/domain/workbench/
├─ src/
│  ├─ lifecycle.ts        # 保留
│  ├─ snapshot.ts         # 保留
│  └─ ...

packages/features/proposals/  # 新建
├─ src/
│  ├─ proposal-ops.ts     # 从workbench移动
│  ├─ proposal-ui.ts      # 从shell移动
│  └─ contracts.ts
```

**影响范围**: shell, novel-kernel  
**验证**: E2E测试通过,提案流程正常工作

#### 步骤1.2: 提取Agent工具注册 (3天)
```bash
packages/features/agent-tools/  # 新建
├─ src/
│  ├─ observe-tool.ts     # 从workbench移动
│  ├─ novel-tools.ts      # 从workbench移动
│  └─ registry.ts         # 新建统一注册器
```

**依赖清理**:
- novel-kernel → agent-tools (不再依赖workbench)
- workbench → agent-tools (注册工具)

#### 步骤1.3: 提取集成层 (4天)
```bash
packages/features/integrations/  # 新建
├─ src/
│  ├─ proofread.ts        # 从workbench移动
│  ├─ overview.ts         # 从workbench移动
│  └─ contracts.ts
```

**影响范围**: 3个面板包  
**重构**: 面板 → integrations → workbench-core

**阶段一产物**:
- [ ] workbench从10112行减少到~3000行
- [ ] 5个包的依赖从workbench转向新的features包
- [ ] 所有E2E测试通过

### 阶段二: P0问题-建立面板基础设施 (1-2周)

**目标**: 建立稳定的core层,作为后续重构基础

1. **创建 `core/contracts`**
   - 提取所有包共享的类型定义
   - 定义标准接口和协议
   - 不依赖任何其他 package

2. **重构 `core/workspace-core`**
   - 从 `dsh-editor-workspace-kit` 提取纯工具函数
   - 移除对具体领域包的依赖
   - 只保留文件操作、元数据等核心功能

3. **整合 `core/plugin-sdk`**
   - 合并 `dsh-editor-seats` 和 `@klarkxy/dsh-plugin-kit`
   - 提供统一的插件开发接口
   - 文档化插件开发指南

**验证**: 
- [ ] core/* 包之间无循环依赖
- [ ] core/* 不依赖 domain/ui/features
- [ ] 所有类型导入路径可追溯

### 阶段三: 领域层解耦(2-3周)

**目标**: 独立各领域包,消除业务逻辑间的紧耦合

1. **拆分 `dsh-editor-workbench`**
   - 项目生命周期 → `domain/workbench`
   - 工具RPC → 新的 `features/editor-tools`
   - 校对调度保留在workbench

2. **重命名和迁移领域包**
   - `dsh-manuscript` → `domain/manuscript`
   - `dsh-proofread` → `domain/proofread`
   - `dsh-editor-novel-kernel` → `domain/novel`
   - `dsh-editor-writing-presets` → `domain/writing-presets`

3. **清理依赖关系**
   - 确保 domain/* 只依赖 core/*
   - 领域间协作通过 contracts 中的接口

**验证**: 
- [ ] domain/* 可独立测试
- [ ] domain/* 之间无直接依赖
- [ ] 通过contracts暴露能力

### 阶段四: UI层重构(3-4周)

**目标**: 建立清晰的UI层次,分离视觉和逻辑

1. **提取 `ui/design-system`**
   - 从 `dsh-editor-shell` 提取 tokens、styles
   - 创建独立的组件库文档
   - 提供 gallery 和 playground

2. **拆分 `dsh-editor-shell`**
   - 核心布局 → `ui/shell`
   - 配置UI → 移到对应功能包
   - writing-config → `features/writing-modes`

3. **整合面板包**
   - 所有 `*-panel` 移入 `ui/panels/*`
   - 统一座位使用方式
   - 共享面板基础组件

**验证**: 
- [ ] ui/* 不包含业务逻辑
- [ ] 设计系统可独立演示和测试
- [ ] 面板可独立开发和替换

### 阶段五: 功能层组装(1-2周)

**目标**: 将拆分的能力重新组装为用户可见的功能

1. **创建feature包**
   - `features/editor-integration`: 编辑器集成和工作流
   - `features/plugin-discovery`: 插件发现和安装辅助
   - `features/writing-modes`: 写作模式管理

2. **重构 desktop 入口**
   - 简化 `apps/desktop` 为纯组装层
   - 清理直接依赖,通过feature层引入能力
   - 更新 composition.json

**验证**: 
- [ ] desktop 构建成功
- [ ] 所有功能正常工作
- [ ] E2E测试通过

### 阶段六: 文档和交付(1周)

**目标**: 同步文档,准备发布

1. **更新文档**
   - 同步所有README
   - 更新 packages/README.md 包清单
   - 更新根 README 和用户指南
   - 生成新的架构图

2. **迁移指南**
   - 为现有插件开发者提供迁移指南
   - 记录breaking changes
   - 提供 codemod 工具

3. **版本发布**
   - 决定版本号策略(major bump)
   - 更新 CHANGELOG
   - 发布新版本

---

## 五、风险与缓解措施

### 风险1: 重构期间功能开发停滞

**影响**: 中等  
**缓解**: 
- 分阶段进行,每个阶段保持可工作状态
- 在独立分支进行,主分支继续接受紧急修复
- 使用feature flag隔离新老实现

### 风险2: 引入新的bug或回归

**影响**: 高  
**缓解**: 
- 每个阶段后运行完整的E2E测试套件
- 保持API兼容层,渐进式迁移
- 准备回滚计划和检查点

### 风险3: 外部插件兼容性破坏

**影响**: 高  
**缓解**: 
- 保持 `@klarkxy/dsh-plugin-kit` 向后兼容
- 提前通知并提供迁移指南
- 提供兼容层和deprecation警告

### 风险4: 重构时间超出预期

**影响**: 中等  
**缓解**: 
- 设置每阶段的时间上限
- 可选择性跳过某些非关键重构
- 保持增量交付,避免"大爆炸"式重构

---

## 六、成功标准

重构完成后应达到:

### 定量标准
- [ ] 包的平均依赖数量 < 5
- [ ] 无循环依赖
- [ ] 构建时间减少 > 20%
- [ ] 所有现有E2E测试通过
- [ ] 测试覆盖率 > 70%

### 定性标准
- [ ] 新开发者可在1小时内理解整体架构
- [ ] 新功能开发时可明确选择目标包
- [ ] 每个包可独立开发和测试
- [ ] 文档与代码实现一致
- [ ] 插件开发体验明显改善

---

## 七、后续行动

### 立即行动
1. **评审本方案**: 与团队讨论,收集反馈
2. **优先级排序**: 确定哪些问题最紧急
3. **资源分配**: 确定谁参与重构工作
4. **时间规划**: 根据实际情况调整时间表

### 待决策
- [ ] 是否一次性重构,还是分多个版本逐步进行?
- [ ] 重构期间如何处理新功能需求?
- [ ] 是否需要外部专家审查?
- [ ] 如何处理公共插件的同步重构?

---

## 附录

### A. 当前包依赖关系图

*(待子代理分析完成后补充)*

### B. 目标依赖关系图

*(待详细设计后补充)*

### C. API变更清单

*(待各阶段设计时补充)*

### D. 参考资料

- [产品原则](product-principles.md)
- [架构决策](architecture.md)
- [UI设计说明](ui-design.md)
- [插件发布维护](../packages/PUBLISHING.md)

---

**文档状态**: 🟡 草案 - 等待子代理完成详细架构分析后完善

**下一步**: 
1. 获取当前架构的完整依赖关系图
2. 识别所有循环依赖和紧耦合点
3. 与产品和开发团队讨论优先级
4. 细化第一阶段的具体任务
