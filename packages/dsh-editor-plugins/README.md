# dsh-editor-plugins

桌面写作组合的插件管理入口。核心插件不能关闭或卸载；其余已装插件可以开关；可从 GitHub `topic:dsh-plugin` 市场搜索并安装社区插件。

Host：`/dsh-editor-plugins` loopback RPC。Client 挂在 `dsh-editor.settings.plugins`，由设置弹窗的「插件」分类渲染。
