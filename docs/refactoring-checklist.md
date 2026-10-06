# DSH Editor 架构重构 - 执行清单

## 📦 重构范围确认

### ✅ 本仓库保留的13个包
- [x] 确认包清单
- [x] 排除已迁移的外部插件(10个包已在dsh-plugins)
- [x] 只处理Editor核心包

### 🎯 3个P0严重问题
1. **workbench过载** - 10112行,被5个包依赖
2. **3个面板重复代码** - 缺少统一基础设施
3. **shell边界消失** - 31870行,职责混杂

---

## 📋 交付物检查清单

### 已完成 ✓
- [x] 详细架构分析报告(基于404个文件的实际扫描)
- [x] 当前vs目标架构对比文档
- [x] 完整的6阶段迁移路线图
- [x] 精简版可执行方案(聚焦13个包)
- [x] 风险评估与缓解措施
- [x] 成功标准定义

### 待用户确认
- [ ] 是否同意问题诊断?
- [ ] 是否接受目标架构设计?
- [ ] 是否批准开始执行?
- [ ] 时间投入是否可接受(6-7周)?

---

## 🚀 如果获得批准,立即可开始

### 阶段0: 准备工作(3天)

```bash
# 1. 创建重构分支
git checkout -b refactor/arch-v2

# 2. 建立测试基准
pnpm test > tests-baseline.txt
pnpm test:e2e:desktop
pnpm test:e2e:core-loop

# 3. 创建自动化脚本
mkdir -p scripts/refactor
# 创建 move-package.mjs
# 创建 extract-module.mjs  
# 创建 validate-deps.mjs

# 4. 记录当前状态
git add -A
git commit -m "chore: baseline before arch refactor"
```

### 阶段1: 拆分workbench(1周)

**目标**: 从10112行减到3000行

**步骤**:
1. 提取提案系统 → packages/features/proposals
2. 提取Agent工具注册 → packages/features/agent-tools
3. 提取集成层 → packages/features/integrations
4. 重命名 workbench → workbench-core

**验证**: 5个依赖包构建成功,E2E测试通过

---

## 📊 重构进度追踪

### 包数量统计

| 层级 | 当前 | 目标 | 进度 |
|------|------|------|------|
| 应用层 | 1 | 1 | 0% |
| 核心层 | 2 | 3 | 0% |
| 领域层 | 5 | 5 | 0% |
| UI层 | 5 | 6 | 0% |
| 功能层 | 0 | 4 | 0% |
| **总计** | **13** | **19** | **0%** |

### 代码行数目标

| 包 | 当前 | 目标 | 减少 |
|---|------|------|------|
| workbench | 10112行 | 3000行 | -70% |
| shell | 31870行 | 15000行 | -53% |
| memory-panel | 891行 | 400行 | -55% |
| overview-panel | 1073行 | 500行 | -53% |
| proofread-panel | 1308行 | 600行 | -54% |

---

## 🎯 关键里程碑

- [ ] **里程碑1** (1周后): workbench拆分完成
- [ ] **里程碑2** (2周后): 面板基础设施建立
- [ ] **里程碑3** (3周后): shell精简完成
- [ ] **里程碑4** (4周后): 核心层建立
- [ ] **里程碑5** (5周后): 领域层重组完成
- [ ] **里程碑6** (6-7周后): 重构完成,文档同步

---

## ⚠️ 风险提示

### 高风险
- 重构破坏现有功能 → 每阶段后全面测试

### 中风险
- 包拆分过细 → 验证后可合并
- 时间超预期 → P0优先,P1可延后

### 低风险  
- 外部插件兼容 → 不影响已迁移的外部包

---

## 📖 文档位置

所有重构相关文档已创建:

1. **[docs/refactoring-proposal.md](docs/refactoring-proposal.md)**
   - 完整方案(包含所有分析细节)
   
2. **[docs/refactoring-proposal-focused.md](docs/refactoring-proposal-focused.md)**  ⭐
   - **精简版,聚焦13个包,可直接执行**
   
3. **[docs/architecture-comparison.md](docs/architecture-comparison.md)**
   - 当前vs目标架构可视化对比

4. **子代理分析报告** (已接收)
   - 基于404个文件的深度扫描
   - 识别了所有架构问题和代码证据

---

## ✅ 下一步行动

### 选项A: 立即开始执行
```bash
# 我将开始阶段0的准备工作
# 创建分支,建立基准,开发迁移脚本
```

### 选项B: 先细化API设计
```bash
# 为每个新包设计详细的接口契约
# 明确类型定义和依赖关系
# 然后再开始实施
```

### 选项C: 只接受方案,暂不实施
```bash
# 方案归档,留待合适时机执行
# 或由团队内部讨论后决定
```

---

## 🤔 待决策的问题

1. **writing-presets包**(24行空包)的处理方式?
   - 合并到plugins / novel / 扩展为完整系统?

2. **workspace-kit依赖manuscript**的问题?
   - 通过contracts接口 / 功能移到domain?

3. **作者记忆功能**的归属?
   - 独立features / 合并到memory-panel / 删除?

4. **包命名前缀**是否保留?
   - 保留dsh-editor- / 去除(目录已说明归属)?

---

**状态**: ✅ 方案完成,等待执行指令  
**架构健康度**: 当前5/10 → 目标8/10  
**预计工时**: 6-7周(单人全职)

**我准备好了,请告诉我下一步该做什么!** 🚀
