# dsh-editor-workspace-kit

进程内工作区原语库。私有包，随依赖它的包（workbench、cards）复制进运行时。

- **用途**：为 Host 包提供共享的文件与目录原语——access bag、`.dsh-editor/` sidecar 读写、目录与条目名称校验、no-replace 原子移动、frontmatter 解析。
- **形式**：纯库；调用方是各自 Host 插件，文件权限由 DSH live session 决定。

源码即合同，见 `src/`。
