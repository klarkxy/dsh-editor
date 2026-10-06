# Phase 2: 架构可视化

> **历史留档**: 本文档为 Phase 1 可视化材料，已被 [架构重构权威计划](refactoring/refactoring-plan.md) 整合。保留历史正文供参考。

本文档包含 Phase 2 面板基础设施的所有架构图。

---

## 1. 系统分层架构

```mermaid
graph TB
    subgraph "面板层 (Panel Layer)"
        MP[Memory Panel<br/>记忆维护]
        PP[Proofread Panel<br/>文稿校对]
        OP[Overview Panel<br/>文档概览]
        NP[New Panel<br/>未来面板]
    end
    
    subgraph "基础设施层 (Infrastructure Layer)"
        PB[dsh-editor-panel-base<br/>面板基础设施]
        
        subgraph "核心模块"
            RPC[RPC Client<br/>safeRpcCall, LatestRequestGate]
            REQ[Request Bus<br/>createPanelRequestBus]
            I18N[I18n Factory<br/>createPanelI18n]
            STY[Style Utils<br/>panelContainerStyles]
            CORD[Cordis Adapter<br/>createPanelClient]
            HOOKS[React Hooks<br/>usePanelRequest, usePanelRpc]
        end
    end
    
    subgraph "平台层 (Platform Layer)"
        SEATS[dsh-editor-seats<br/>Shell 契约]
        WB[dsh-editor-workbench<br/>RPC 端点]
        CORDIS[@deepseek-ai/cordis<br/>插件系统]
        REACT[React<br/>UI 框架]
    end
    
    MP --> PB
    PP --> PB
    OP --> PB
    NP --> PB
    
    PB --> RPC
    PB --> REQ
    PB --> I18N
    PB --> STY
    PB --> CORD
    PB --> HOOKS
    
    CORD --> CORDIS
    HOOKS --> REACT
    PB --> SEATS
    
    MP --> WB
    PP --> WB
    OP --> WB
    NP --> WB
    
    style PB fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    style MP fill:#7ED321,stroke:#5FA019
    style PP fill:#7ED321,stroke:#5FA019
    style OP fill:#7ED321,stroke:#5FA019
    style NP fill:#F8E71C,stroke:#D4C01A
```

---

## 2. 依赖关系图

```mermaid
graph LR
    subgraph "新增包"
        PB[dsh-editor-panel-base]
    end
    
    subgraph "现有平台包"
        SEATS[dsh-editor-seats]
        WB[dsh-editor-workbench]
    end
    
    subgraph "面板包"
        MP[memory-panel]
        PP[proofread-panel]
        OP[overview-panel]
    end
    
    subgraph "外部依赖"
        CORDIS[@deepseek-ai/cordis]
        REACT[react]
    end
    
    PB --> SEATS
    PB --> CORDIS
    PB --> REACT
    
    MP --> PB
    PP --> PB
    OP --> PB
    
    MP --> WB
    PP --> WB
    OP --> WB
    
    MP -.不直接依赖.-> SEATS
    PP -.不直接依赖.-> SEATS
    OP -.不直接依赖.-> SEATS
    
    style PB fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    style SEATS fill:#E8E8E8,stroke:#999
    style WB fill:#E8E8E8,stroke:#999
```

**关键约束**:
- ✅ `panel-base` 不依赖 `workbench`（避免循环）
- ✅ 面板包通过 `panel-base` 间接使用 `seats`
- ✅ RPC 调用由面板直接发起到 `workbench`

---

## 3. 迁移流程图

```mermaid
graph TD
    A[开始: 创建 panel-base] --> B[实施 Phase 2.1<br/>8 小时]
    B --> C{构建成功?}
    C -->|否| B
    C -->|是| D[迁移 Memory Panel<br/>Phase 2.2, 4 小时]
    D --> E[功能验证]
    E --> F{验证通过?}
    F -->|否| G[修复问题]
    G --> E
    F -->|是| H[迁移 Proofread Panel<br/>Phase 2.3, 5 小时]
    H --> I[功能验证]
    I --> J{验证通过?}
    J -->|否| K[修复问题]
    K --> I
    J -->|是| L[迁移 Overview Panel<br/>Phase 2.4, 4 小时]
    L --> M[功能验证]
    M --> N{验证通过?}
    N -->|否| O[修复问题]
    O --> M
    N -->|是| P[文档与测试<br/>Phase 2.5, 3 小时]
    P --> Q[最终验证]
    Q --> R{全部通过?}
    R -->|否| S[修复问题]
    S --> Q
    R -->|是| T[完成]
    
    style A fill:#4A90E2,stroke:#2E5C8A,color:#fff
    style T fill:#7ED321,stroke:#5FA019,color:#fff
    style C fill:#F5A623,stroke:#D68910
    style F fill:#F5A623,stroke:#D68910
    style J fill:#F5A623,stroke:#D68910
    style N fill:#F5A623,stroke:#D68910
    style R fill:#F5A623,stroke:#D68910
```

---

## 4. 代码重复热力图

```mermaid
graph LR
    subgraph "Memory Panel"
        M_RPC[rpc.ts<br/>58 行]
        M_REQ[requests.ts<br/>27 行]
        M_MSG[messages.ts<br/>114 行]
        M_STY[styles.ts<br/>77 行]
        M_CLI[client.tsx<br/>88 行]
    end
    
    subgraph "Proofread Panel"
        P_RPC[rpc.ts<br/>52 行]
        P_REQ[requests.ts<br/>29 行]
        P_MSG[messages.ts<br/>154 行]
        P_STY[styles.ts<br/>110 行]
        P_CLI[client.tsx<br/>92 行]
    end
    
    subgraph "Overview Panel"
        O_RPC[rpc.ts<br/>52 行]
        O_REQ[requests.ts<br/>27 行]
        O_MSG[messages.ts<br/>144 行]
        O_STY[styles.ts<br/>120 行]
        O_CLI[client.tsx<br/>82 行]
    end
    
    M_RPC -.100% 相同.-> P_RPC
    P_RPC -.100% 相同.-> O_RPC
    
    M_REQ -.95% 相同.-> P_REQ
    P_REQ -.95% 相同.-> O_REQ
    
    M_MSG -.80% 相同.-> P_MSG
    P_MSG -.80% 相同.-> O_MSG
    
    M_STY -.70% 相同.-> P_STY
    P_STY -.70% 相同.-> O_STY
    
    M_CLI -.85% 相同.-> P_CLI
    P_CLI -.85% 相同.-> O_CLI
    
    style M_RPC fill:#D0021B,stroke:#A00,color:#fff
    style P_RPC fill:#D0021B,stroke:#A00,color:#fff
    style O_RPC fill:#D0021B,stroke:#A00,color:#fff
    
    style M_REQ fill:#F5A623,stroke:#D68910
    style P_REQ fill:#F5A623,stroke:#D68910
    style O_REQ fill:#F5A623,stroke:#D68910
```

**颜色说明**:
- 🔴 红色: 100% 重复（必须提取）
- 🟠 橙色: 80%+ 重复（应该提取）
- 🟡 黄色: 60%+ 重复（可以提取）

---

## 5. 数据流图

```mermaid
sequenceDiagram
    participant User as 用户
    participant CMD as 命令系统
    participant BUS as 请求总线
    participant Panel as 面板组件
    participant RPC as RPC 层
    participant WB as Workbench
    
    User->>CMD: 触发命令 (Ctrl+Shift+O)
    CMD->>BUS: requestPanel()
    BUS->>Panel: 发布请求事件
    Panel->>Panel: 打开面板
    Panel->>BUS: consumeRequest()
    
    Panel->>RPC: safeRpcCall<Data>(...)
    RPC->>WB: rpc.call('endpoint', payload)
    WB-->>RPC: 返回结果
    RPC->>RPC: 规范化为 RpcResult<Data>
    RPC-->>Panel: 返回类型安全的结果
    
    Panel->>Panel: 更新 UI
    Panel-->>User: 显示数据
```

---

## 6. 迁移前后对比

```mermaid
graph TB
    subgraph "迁移前 (当前)"
        M1[Memory Panel<br/>364 行代码]
        P1[Proofread Panel<br/>437 行代码]
        O1[Overview Panel<br/>403 行代码]
        
        M1_DUP[重复: ~250 行]
        P1_DUP[重复: ~280 行]
        O1_DUP[重复: ~270 行]
        
        M1 --> M1_DUP
        P1 --> P1_DUP
        O1 --> O1_DUP
    end
    
    subgraph "迁移后 (目标)"
        BASE[panel-base<br/>450 行<br/>共享基础设施]
        
        M2[Memory Panel<br/>114 行<br/>业务代码]
        P2[Proofread Panel<br/>157 行<br/>业务代码]
        O2[Overview Panel<br/>133 行<br/>业务代码]
        
        M2 --> BASE
        P2 --> BASE
        O2 --> BASE
    end
    
    style M1 fill:#D0021B,stroke:#A00,color:#fff
    style P1 fill:#D0021B,stroke:#A00,color:#fff
    style O1 fill:#D0021B,stroke:#A00,color:#fff
    
    style BASE fill:#4A90E2,stroke:#2E5C8A,color:#fff
    style M2 fill:#7ED321,stroke:#5FA019
    style P2 fill:#7ED321,stroke:#5FA019
    style O2 fill:#7ED321,stroke:#5FA019
```

**统计**:
- 迁移前: 1204 行（含重复）
- 迁移后: 854 行（共享基础 + 业务代码）
- **减少**: 350 行（29%）
- **重复消除**: 800 行重复代码 → 450 行共享代码

---

## 7. 类型系统设计

```mermaid
classDiagram
    class BasePanelRequest {
        +nonce: number
    }
    
    class PanelRequestBus~TRequest~ {
        +request(payload?) TRequest
        +pending() TRequest | null
        +consume(request) void
        +subscribe(listener) Unsubscribe
    }
    
    class RpcResult~T~ {
        <<union>>
        +ok: boolean
        +value?: T
        +error?: ErrorDetails
    }
    
    class PanelI18n~TKey~ {
        +setLocale(locale) void
        +getLocale() ShellLocale
        +t(key, params?) string
        +message(locale, key, params?) string
        +intlLocale(locale?) string
    }
    
    class PanelClientConfig~TRequest~ {
        +panelName: string
        +styles: string
        +slot: SlotConfig
        +commands: ShellCommand[]
        +createRender(rpc) RenderFunction
    }
    
    BasePanelRequest <|-- MemoryRequest
    BasePanelRequest <|-- ProofreadRequest
    BasePanelRequest <|-- OverviewRequest
    
    PanelRequestBus ..> BasePanelRequest : 约束
    RpcResult ..> TypeParameter : 泛型
    PanelI18n ..> MessageKey : 约束
    PanelClientConfig ..> BasePanelRequest : 泛型
```

---

## 8. 文件组织结构

```mermaid
graph TB
    subgraph "dsh-editor-panel-base/"
        BASE_SRC[src/]
        BASE_INDEX[index.ts<br/>主入口]
        BASE_RPC[rpc.ts<br/>RPC 层]
        BASE_BUS[request-bus.ts<br/>请求总线]
        BASE_I18N[i18n.ts<br/>国际化]
        BASE_STY[styles.ts<br/>样式工具]
        BASE_CORD[cordis-adapter.ts<br/>Cordis]
        BASE_HOOKS[hooks.ts<br/>React 钩子]
        
        BASE_SRC --> BASE_INDEX
        BASE_SRC --> BASE_RPC
        BASE_SRC --> BASE_BUS
        BASE_SRC --> BASE_I18N
        BASE_SRC --> BASE_STY
        BASE_SRC --> BASE_CORD
        BASE_SRC --> BASE_HOOKS
    end
    
    subgraph "dsh-editor-{panel}-panel/"
        PANEL_SRC[src/]
        PANEL_INDEX[index.ts<br/>服务端入口]
        PANEL_CLIENT[client.tsx<br/>客户端插件]
        PANEL_COMP[panel.tsx<br/>React 组件]
        PANEL_REQ[requests.ts<br/>请求定义]
        PANEL_MSG[messages.ts<br/>消息文案]
        PANEL_STY[styles.ts<br/>面板样式]
        PANEL_VIEW[*-view.ts<br/>业务逻辑]
        
        PANEL_SRC --> PANEL_INDEX
        PANEL_SRC --> PANEL_CLIENT
        PANEL_SRC --> PANEL_COMP
        PANEL_SRC --> PANEL_REQ
        PANEL_SRC --> PANEL_MSG
        PANEL_SRC --> PANEL_STY
        PANEL_SRC --> PANEL_VIEW
    end
    
    PANEL_CLIENT -.导入.-> BASE_INDEX
    PANEL_REQ -.导入.-> BASE_INDEX
    PANEL_MSG -.导入.-> BASE_INDEX
    PANEL_STY -.导入.-> BASE_INDEX
    
    style BASE_SRC fill:#4A90E2,stroke:#2E5C8A,color:#fff
    style PANEL_SRC fill:#7ED321,stroke:#5FA019
```

---

## 9. 时间线甘特图

```mermaid
gantt
    title Phase 2 实施时间线
    dateFormat  YYYY-MM-DD
    section Phase 2.1
    创建 panel-base 包           :2026-10-07, 1d
    
    section Phase 2.2
    迁移 Memory Panel            :2026-10-08, 1d
    
    section Phase 2.3
    迁移 Proofread Panel         :2026-10-09, 1d
    
    section Phase 2.4
    迁移 Overview Panel          :2026-10-10, 1d
    
    section Phase 2.5
    文档与测试                   :2026-10-11, 1d
    
    section 验收
    全面测试与修复               :2026-10-14, 2d
```

---

## 10. 风险矩阵

```mermaid
quadrantChart
    title 风险评估矩阵
    x-axis 低影响 --> 高影响
    y-axis 低可能性 --> 高可能性
    quadrant-1 需要缓解
    quadrant-2 重点关注
    quadrant-3 可接受
    quadrant-4 监控
    
    Message Cards 支持: [0.6, 0.5]
    样式差异: [0.4, 0.3]
    Cordis 冲突: [0.5, 0.2]
    构建工具不兼容: [0.6, 0.4]
    类型推导失败: [0.3, 0.2]
    性能回退: [0.4, 0.2]
    文档不完整: [0.3, 0.5]
```

---

## 使用说明

1. 复制对应的 Mermaid 代码到支持 Mermaid 的编辑器（如 Typora、VS Code + 插件）
2. 或访问 [Mermaid Live Editor](https://mermaid.live/) 在线预览
3. 导出为 PNG/SVG 用于演示文档

---

**文档版本**: v1.0  
**最后更新**: 2026-10-06
