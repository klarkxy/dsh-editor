# 插件发布维护

安装说明在各包 README。发布与市场收录分开处理，不把仓库根 URL 当作单个插件。

## 发布

推送到 `main` 会触发 [npm-publish.yml](../.github/workflows/npm-publish.yml)。公开包的实际内容变化会自动发 patch，**包内 README 的变化也计入**；minor、major 和预发布版本不走这套自动流程。push 与发布须获授权。

本地预览：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm run publish:plugins
```

预览不上传，结束时恢复临时调整的源码版本；会更新构建产物与 tarball。结果在 `.pack/npm-release/report.json`。发布失败先查看报告和 Actions artifact，重跑工作流对账，不手动猜测下一个版本。

发布策略以 [publish-npm-plugins.mjs](../scripts/publish-npm-plugins.mjs) 及其测试为准。构建应可复现，避免时间戳或随机内容使每次构建都触发新版本。

## 新增公开包

参考现有公开包的 `package.json`：使用 `@klarkxy/` scope、非 private、显式声明 `publishConfig.access: public`。提供 README、LICENSE、编译产物及准确的仓库子目录信息。运行时 workspace 依赖须能一同公开发布，不能依赖私有包或形成依赖环。

npm 首页使用包根英文 `README.md`；中文放在 `docs/README.zh-CN.md`，两者互链并随包交付。避免在包根放多份 README 变体。

发现入口使用不同的标签：GitHub 仓库同时保留 `dsh-plugin` 和 `dsh-plugins` topic；公开 npm 包的 `keywords` 使用 `dsh`、`dsh-plugin`、`dsh-plugins`、`deepseek-harness`，再添加与功能对应的关键词。npm 关键词支持 registry 搜索，不能代替精选市场的逐包投稿。

新包先完成首次 npm 创建，再逐包绑定 GitHub Actions trusted publisher。已有包的绑定不能代替新包授权。

| Trusted publishing 字段 | 值 |
| --- | --- |
| Organization or user | `klarkxy` |
| Repository | `dsh-editor` |
| Workflow filename | `npm-publish.yml` |
| Environment name | 留空 |
| Allowed actions | 允许直接 `npm publish` |

首次创建可由维护者普通发布，或使用有创建与直接发布权限的短期 `NPM_TOKEN` Actions secret。CI 令牌需支持非交互发布；不要把令牌写入仓库或聊天。OIDC 绑定验证成功后撤销临时令牌。具体授权步骤见 [npm 官方说明](https://docs.npmjs.com/trusted-publishers/)。

主分支规则须允许工作流回写已确认的包版本；回写失败应修复权限或对账，不绕过分支保护。

## 市场收录

npm 发布不会自动获得市场收录。向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 投稿时，分别提交以下包目录：

- [知乎资料](https://github.com/klarkxy/dsh-editor/tree/main/packages/dsh-zhihu)
- [网络搜索](https://github.com/klarkxy/dsh-editor/tree/main/packages/dsh-web-search-manager)

按上游当前格式填写条目；仓库 topic 只能帮助发现，不能保证每个子包都被展示。收录状态以市场实际结果为准。
