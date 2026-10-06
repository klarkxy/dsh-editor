# DSH Editor 架构重构方案 - 执行版

> **历史留档**: 本文档为早期执行版计划，已被 [refactoring-plan.md](./refactoring-plan.md) 替代。当前权威计划请参考新文档。本文档保留作为历史参考。

## 文档概述

**创建日期**: 2026-10-06  
**版本**: 1.0 - 执行就绪  
**状态**: 已被新计划替代

---

## 执行摘要

### 项目目标

解决 DSH Editor 的三个核心架构问题:

1. **dsh-editor-workbench 职责过载** - 10,112 行, 7+ 职责
2. **面板包代码重复** - 1,350-1,500 行重复代码
3. **dsh-editor-shell 边界模糊** - 31,870 行, UI 与业务混杂

### 当前状态

- ✅ **Phase 0**: 架构分析完成
- ✅ **Phase 2**: 原型实现完成 + 深度分析完成
- ⏳ **Phase 1**: 设计完成, 待实施
- 📋 **Phase 3+**: 待规划

### 快速收益

**Phase 2 已实现**:
- 消除 134 行重复代码 (RPC 层, 83% 减少)
- 建立面板开发基础设施 (385 行)
- 新面板开发时间预计减少 87%

---

## 重构阶段概览

### Phase 0: 架构分析 ✅ 100%

**产出**: 架构分析报告, 依赖关系图, 11 个问题清单

### Phase 1: Workbench 拆分 ⏳ 20%

**目标**: 10,112 行 → 6 个包  
**耗时**: 5-7 工作日  
**风险**: 高 (影响 5+ 个包)

拆分方案:
- dsh-editor-workbench-core (生命周期)
- dsh-editor-workbench-proposals (提案)
- dsh-editor-workbench-tools (Agent 工具)
- dsh-editor-workbench-import (导入/导出)
- dsh-editor-workbench-prefs (作者偏好)
- dsh-editor-workbench (整合入口)

### Phase 2: Panel Base 提取 ✅ 80%

**已完成**:
- ✅ 创建 panel-base 包 (385 行)
- ✅ 重构 3 个面板 rpc.ts (减少 134 行)
- ✅ 深度分析 (4 份文档, 35,000 字)

**待完成**:
- ⏳ 验证原型 (等待 pnpm install)
- ⏳ 完整迁移 requests/messages/styles
- ⏳ 更新文档

**耗时**: 4 工作日  
**风险**: 低

### Phase 3: Shell 边界明确化 📋 0%

**目标**: 31,870 行 → 多个包  
**耗时**: 7-10 工作日  
**依赖**: Phase 1 完成  
**风险**: 高 (197 个文件)

### Phase 4-5: 其他改进 📋 0%

代码组织标准化, workspace-kit 重命名, 公开包分离等。

---

## 投资回报

### 成本

**总工作量**: 24-33 工作日 (约 1 个开发者·月)

### 收益

| 指标 | 改进 |
|------|------|
| 最大包大小 | 68% 减少 (31,870 → <10,000 行) |
| 重复代码 | 87% 减少 (1,350 → <200 行) |
| 新面板开发 | 87% 减少 (3-4 小时 → <30 分钟) |
| Bug 修复 | 67% 减少 (修改 3 处 → 1 处) |
| 架构健康度 | 60% 提升 (5/10 → 8/10) |

**年度回报**: 节省约 90 小时/年  
**回收期**: 约 3 个月

---

## 实施建议

### 推荐顺序

1. **Week 1**: Phase 2 验证 + 完整迁移 (快速收益)
2. **Week 2-3**: Phase 1 实施 (Workbench 拆分)
3. **Week 4-5**: Phase 3 设计
4. **Month 2-3**: Phase 3-5 实施

### 资源需求

- 1 名主力开发者 (全职 1-2 个月)
- 1 名审查者 (每周 4-8 小时)
- 1 名测试工程师 (每周 4-8 小时)

---

## 相关文档

### Phase 2 产出 (本次完成)

**原型实现**:
- [Panel Base 设计](./phase2-panel-base-design.md)
- [迁移指南](./phase2-panel-base-migration.md)
- [完成报告](./phase2-panel-base-complete.md)
- [工作总结](./phase2-summary.md)

**深度分析** (子代理 3265544e):
- [分析报告](../phase2-panel-analysis.md) - 10,500 字
- [设计文档](../phase2-panel-design.md) - 8,000 字
- [迁移计划](../phase2-migration-plan.md) - 6,500 字
- [实施指南](../phase2-implementation-guide.md) - 10,000 字

### 项目基础
- [产品原则](../product-principles.md)
- [架构决策](../architecture.md)
- [UI 施工约定](../ui-agent-guide.md)

---

## 批准与启动

### 待批准

- [ ] Phase 2 完整迁移 (4 工作日, 低风险)
- [ ] Phase 1 实施 (2 周, 高风险)
- [ ] 资源分配

### 启动条件

- [ ] Phase 2 原型验证通过
- [ ] Phase 1 详细计划审查通过
- [ ] 资源到位

---

**状态**: ✅ 执行就绪, 等待批准启动

**最后更新**: 2026-10-06 22:52
