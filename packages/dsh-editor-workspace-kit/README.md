# dsh-editor-workspace-kit

Host 包共用的工作区文件与元数据工具库，没有独立插件入口。文件权限仍由 DSH 会话决定。

## 模块清单（src/）

- `access.ts`：把会话的 WorkspaceAccess 收敛为操作上下文（工作区路径、rootKey、读写模式与文件句柄）。
- `entries.ts`：条目名/目录段校验与安全建目录，拒绝路径分隔符、点开头、超长名称和 Windows 保留名。
- `errors.ts`：`LifecycleError`，统一 `READ_ONLY` / `INVALID_PATH` / `NOT_FOUND` / `EXISTS` / `STALE` / `BLOCKED` / `UNSUPPORTED` / `IO` 错误码。
- `files.ts`：安全路径解析与带版本文本读取（sha256 版本号、字节数）；工作区根拒绝符号链接。
- `frontmatter.ts`：人物卡与世界书 frontmatter 的解析与格式化（约 600 行，含触发词个数与长度上限等约束）。
- `metadata-io.ts`：`.dsh-editor` 元数据目录的受约束读写与原子写入（单文件上限 2MB）。
- `move.ts`：跨平台不覆盖移动——Windows 走最小环境的 PowerShell，其他平台用 rename + link 的分阶段方案。
- `tree.ts`：文件树过滤规则——`MAX_FILES = 2000` 上限、生成目录识别（build / dist / node_modules 等）、隐藏路径与辅助作者文件（AGENTS.md 等）排除。

统一出口见 [src/index.ts](src/index.ts)。

## 子路径导出

- `./frontmatter`：同一 frontmatter 模块的浏览器侧构建（tsdown 以 neutral 平台单独打包，不依赖 Node API），供客户端包复用解析与格式化逻辑。
