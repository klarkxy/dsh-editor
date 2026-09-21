# DSH Editor 文档

文档只保留源码说不出来的东西：给作者的操作手册、产品边界、以及关键架构决策。

| 文档 | 给谁看 | 内容 |
| --- | --- | --- |
| [使用者指南](user-guide.md) | 作者 | 新建作品、编辑保存、正文菜单、搭档、资料、设置与升级 |
| [产品原则](product-principles.md) | 维护者 | 作者确认、普通文件与单一 DSH 权威边界；改任何一条需单独授权 |
| [架构决策](architecture.md) | 维护者 | 信任模型、不自建运行时的理由、root 遮蔽接缝、写入与发布纪律 |
| [插件发布与发现](plugin-distribution.md) | 插件使用者与维护者 | npm 安装、发布验证与第三方市场对 monorepo 的收录限制 |
| [变更记录](../CHANGELOG.md) | 所有人 | 各版本已经发生的变化 |

## 每个包是干嘛的

`packages/` 下每个包都有自己的 README，说明用途、入口与数据归属。更细的声明读源码：入口、feature、锁定与分类在 `package.json` 的 `dshEditor` 字段，RPC / Tool 的字段级契约在各自的 `src/contracts.ts`，新建插件可直接参照 `packages/dsh-proofread/`。

命令与脚本看根 `package.json` 的 scripts（`dev`、`build`、`typecheck`、`test`、`pack:desktop` 等）。桌面能力集合由 `apps/desktop/resources/compositions/desktop.json` 定义，`basic` / `smart` / `full` 是同一集合的兼容别名，由 `scripts/plugin-manifest.mjs` 解析。界面语义 class 与 `data-testid` 是 e2e 钩子，改名前先搜 `e2e/`。

## 架构图

[图站入口](diagrams/index.html) 包含桌面运行时、插件分级、组合边界、作者确认写入与提案版本门禁五张图，发布在 [GitHub Pages](https://klarkxy.github.io/dsh-editor/)。规范源 JSON 与生成 HTML 同目录；更新规范后用 archify 重新交付并核对多尺寸截图。

小说知识卡 `packages/dsh-editor-novel-kernel/resources/novel-knowledge/` 是搭档读取的运行时材料，其出处记录保留，不随界面版本改写。
