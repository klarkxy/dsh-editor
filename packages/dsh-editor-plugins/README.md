# dsh-editor-plugins

插件管理设置页。私有核心包，只随桌面应用交付，锁定不可关闭。

- **用途**：设置里的「插件」分区——按作者用途分组展示内置功能并提供开关；搜索并安装 GitHub 上带 `dsh-plugin` 主题的社区插件，管理已装社区插件的卸载与重启。
- **工作方式**：功能的分类、锁定状态与默认开关读各包 `package.json` 的 `dshEditor` 声明；核心入口锁定，其余即时开关，进行中的对话不受影响。社区插件安装在 `$DSH_HOME/user-plugins/`，profile 每次原子部署后重新挂回。
- **入口**：Client 通过 shell 的设置座位接入；Host 侧负责市场检查与安装事务。

声明见 `package.json` 的 `dshEditor`（role `core`，entry `editor-plugins` 锁定）。
