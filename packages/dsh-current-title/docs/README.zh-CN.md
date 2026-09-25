# @klarkxy/dsh-current-title

按最近人工消息更新会话标题。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/README.md)

从 [`dsh-plugins/dsh-current-title`](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title) 迁入。类型标签保持中英双语（`功能` / `Feature` 及其余固定词表）。生成走 `@klarkxy/dsh-ai-services` 的快速档用途 `current-title.generate`。

安装后默认启用，不会永久停用宿主自带的标题插件。启用期间占用原生 `sessionTitle` 槽位；关闭时若槽位仍由本包持有，且被让出的加载项身份未变，则交还原所有者。类型标签语言跟随宿主偏好，没有单独设置页。

## 安装

需要 Node.js ≥22 与 DSH `0.1.7-rc.2`。「当前标题」默认启用，可在插件设置中关闭。标题写入宿主 `sessionTitle`，由宿主调度；生成依赖 `@klarkxy/dsh-ai-services`。

```sh
npm install @klarkxy/dsh-current-title
```

## 宿主 RPC

频道 `/dsh-current-title`，走宿主授权策略。

- `status` — 当前设置、槽位支持与归属；传入 `sessionId` 时附带该会话的标题状态（标题、来源类型、是否生成中、是否被手动固定）。
- `settings` — 按比较并交换修订号更新存储的语言模式（`{ locale, expectedRevision }`）。存储的模式为 `auto`，类型标签跟随宿主语言偏好。
- `regenerate` — 重新生成单个会话的标题（`{ sessionId }`）；会话不存在报 `not-found`，标题服务未就绪报 `unavailable`。

## 标题形状

```text
0903 | 修复 | 登录回调失败
```

只使用最近真实的人工 `user/message` 事件，插件辅助消息不参与。手动改过的标题由原生标题存储保留。关闭插件会取消在途生成并丢弃迟到结果。

## 许可证

[SATA License 2.1](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/LICENSE)，保留原 `dsh-plugins` 出处。

部分宿主会预装并默认启用本功能；宿主支持热切换时，通过「设置 → 插件」开关即时生效。独立 DSH 需先加载 `@klarkxy/dsh-ai-services` 再加载本包；宿主提示需要重启时，安装或移除后重启。
