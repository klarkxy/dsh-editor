# 插件发布与发现

本仓库保留 monorepo 结构，公开包从各自的 `packages/` 子目录发布。仓库根 `package.json` 是私有 workspace，没有 `dsh.bundle`，不要把 `github:klarkxy/dsh-editor` 当作一个插件安装。

## npm 安装

2026-09-21 已发布首版：[@klarkxy/dsh-zhihu@0.1.0](https://www.npmjs.com/package/@klarkxy/dsh-zhihu/v/0.1.0) 和 [@klarkxy/dsh-web-search-manager@0.1.0](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager/v/0.1.0)。[发布 CI](https://github.com/klarkxy/dsh-editor/actions/runs/35566521366) 已完成 npm 完整性回读和版本回写。

本次发布使用统一的 `@klarkxy/` scope：

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

两个包需要 Node.js ≥22，兼容目标是 DSH `0.1.5-rc.2`。安装后重启 DSH Web；模型工具的挂载方式见[知乎插件](../packages/dsh-zhihu/README.md)和[网络搜索插件](../packages/dsh-web-search-manager/README.md)。npm 上无 scope 的 `dsh-zhihu` 由其他维护者发布，与本仓库不是同一个包。

源码目录保持原名，npm 包名、Cordis patch、客户端装载 ID 与工具入口统一使用 scoped 名称。每个包声明 `repository.url`、`repository.directory`、`homepage`、`bugs`、`dsh-plugin` 等 keywords，发布内容包含编译产物、类型声明、patch、README 和许可证。keywords 便于 npm 搜索，但不能代替市场收录。

## 市场如何发现插件

以下结论核查于 2026-09-21；目录与收录规则会变化。

| 市场 | 发现与安装来源 | 对当前结构的影响 |
| --- | --- | --- |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)（npm `dshmarket`） | 读取 [awesome-dsh-plugin 的目录](https://awesome-dsh-plugin.com/plugins.json)，不直接遍历 npm 新包 | 支持子目录条目；两个插件应分别提交，发布 npm 本身不会上架 |
| [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market)（npm `@dsh-market/plugin`） | 扫描 GitHub topic 等来源，再读取仓库 manifest | 会检查 `packages/`、`apps/`，但遇到第一个有效子包即返回，同仓库未必能展示多个插件 |

`dshmarket` 的目录来自 `awesome-dsh-plugin`。其[投稿说明](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)明确接受 monorepo：URL 指向 `tree/main/packages/<package>`，每个子包一个 YAML 条目，子包必须声明 `dsh.bundle`。只提交仓库根 URL 不足以代表这里的两个插件。条目合并后，[npm 探测脚本](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/probe-npm.mjs)读取该子目录的 `package.json.name`，查找对应 npm 包并核对仓库地址；它不靠 keywords 或 `repository.directory` 自动发现新条目。

2BingLing 的 [GitHub 搜索入口](https://github.com/2BingLing/dsh-market/blob/master/collector/src/sources/github-search.ts)包含 `dsh-plugin` 等 topic。[子包探测](https://github.com/2BingLing/dsh-market/blob/master/collector/src/detect.ts)和[仓库记录构建](https://github.com/2BingLing/dsh-market/blob/master/collector/src/index.ts)支持部分 monorepo，但目前按仓库保留一条记录；[issue 收集器](https://github.com/2BingLing/dsh-market/blob/master/collector/src/sources/issues.ts)也只提取 `owner/repo`，会丢掉子目录路径。因此，添加 topic 能提高仓库被发现的机会，不能承诺两个包各有一张卡。

核查时，GitHub 仓库 topics 为空，两份实时目录都没有 `klarkxy/dsh-editor` 条目。本次 npm 发布与文档更新不代表已获市场收录。

## 收录准备

不需要为了 `dshmarket` 拆仓库。先把 scoped manifests 和 README 同步到 GitHub，再为仓库添加 `dsh-plugin` topic，并按上游规则提交以下两个条目（供后续投稿使用，尚未提交）：

`data/plugins/klarkxy__dsh-editor--packages-dsh-zhihu.yml`

```yaml
url: https://github.com/klarkxy/dsh-editor/tree/main/packages/dsh-zhihu
name: klarkxy/dsh-editor#dsh-zhihu
category: tools
description:
  en: Zhihu search, knowledge-base access, usage tracking and optional agent tools for DSH.
  zh: DSH 知乎搜索、知识库访问、用量统计与可选模型工具。
```

`data/plugins/klarkxy__dsh-editor--packages-dsh-web-search-manager.yml`

```yaml
url: https://github.com/klarkxy/dsh-editor/tree/main/packages/dsh-web-search-manager
name: klarkxy/dsh-editor#dsh-web-search-manager
category: tools
description:
  en: Manage web search providers, credentials and request lifecycles through the DSH web registry.
  zh: 通过 DSH 网络服务管理搜索供应商、凭据与请求生命周期。
```

## main 自动发布

工作流 [.github/workflows/npm-publish.yml](../.github/workflows/npm-publish.yml) 在每次推送到 `main` 后检查可发布包，也可在 Actions 手动运行。PR 和其它分支不会发布。普通文档提交也会触发检查，以便恢复上次未完成的版本回写；实际内容没变就不发布。

构建与测试通过后，工作流检查实际 tarball 内容。包内 README、依赖、exports 和代码变化都会计入；其它插件或仓库说明的修改不会产生新版本。hash 只忽略版本号及明确列出的自动生成字段。首次使用源码版本，后续始终递增 npm 最高稳定版本的 patch。自动流程不发行 minor、major 或预发布版本。

发布使用官方 `npm publish`。最终 tarball 再次校验内容 hash，并在上传后回读确切版本的 `dist.integrity` 与 `dshRelease.contentHash`。上传响应丢失时会先对账，不立即递增另一个版本。无依赖关系的包互不阻塞：只回写已确认成功包的版本；失败包及其下游保留失败记录。成功版本和内容 hash 回写各自 `package.json`，不会创建桌面发布标签。

重复运行时内容相同则跳过；上次已上传但 Git 回写失败，也能从 npm 恢复版本。若 `main` 在发布前已前进，旧任务跳过；若在上传期间前进，回写步骤停止，不强推或把旧制品版本套在新源码上。下一次主分支运行再对账。报告和 tarball 保留为 Actions artifact。

本地预览不会上传或改写版本：

```sh
pnpm run publish:plugins
```

需先安装依赖并构建 workspace；预览还会重建候选包。预览过程临时同步版本并在结束时恢复源码 manifest，生成的 lib 和 tarball 会更新。预览结果在 `.pack/npm-release/report.json`，明确区分计划发布与已发布。

### 新增可发布包

不需要修改工作流的包名清单。将新包放在 `packages/<目录>/`，并在它的 `package.json` 声明：

```json
{
  "name": "@klarkxy/my-package",
  "version": "0.1.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/klarkxy/dsh-editor.git",
    "directory": "packages/my-package"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

只有 `@klarkxy/` scope、未标记 `private: true`、且显式声明 `publishConfig.access: public` 的包会进入发布流程。现有无 scope 的 `dsh-manuscript`、`dsh-proofread` 不会因此被自动发布。目录名使用字母、数字、点、连字符或下划线。包应提供 README、LICENSE 和可用的导出文件；声明了 DSH patch 或客户端的包会额外检查这些产物，普通库不要求 DSH 元数据。

CI 按公开包之间的运行时依赖顺序处理。`workspace:*`、`workspace:^` 等引用由 pnpm 打包转换成上游已确认的版本；依赖变化导致制品变化时，下游也自动发 patch。运行时 workspace 依赖必须一并声明为可发布包；私有构建依赖只能放在 devDependencies 并在需要时内联。普通固定 semver 依赖不会被改写。当前不支持发布依赖环（包括 peer 环），会在任何上传之前报出环路径并停止。

每包比较前先同步 npm 已发布版本并重建，确认要更新后再用最终版本重建，避免代码内嵌旧版本。构建应可复现，不应把当前时间或随机值写入制品；否则每次构建都会被视为内容变化。

### 首次启用

工作流提交到 GitHub 后仍需 npm 授权。根据 [npm trust 的前提](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)，可信发布绑定要求包已经存在；新包不能只靠一个未绑定的 OIDC 工作流首次创建。新增包也需要完成一次初始化，不能用仓库级配置取代 npm 的逐包授权。

可先完成一次普通 npm 发布，或由维护者在本仓库的 Actions secrets 中设置有新包发布权限的临时 `NPM_TOKEN`，让本工作流完成首次创建。不要把 token 写入仓库或聊天；可在自己的终端执行 `gh secret set NPM_TOKEN --repo klarkxy/dsh-editor` 并按提示输入。创建引导用 granular token 时，勾选 **Bypass two-factor authentication**，包权限选择 **Read and write (publish and stage)**，范围覆盖待发布包的 scope，并设置短有效期。普通要求交互式 2FA 的令牌会让 CI 报 `EOTP`；仅有 stage 权限的令牌不能直接发布。该临时配置只用于首次创建，后续使用 OIDC。具体字段见 [npm 令牌创建说明](https://docs.npmjs.com/creating-and-viewing-access-tokens/)。

每个新包首次成功后，打开它的 **Settings → Trusted publishing**，新增 GitHub Actions 配置：

| 字段 | 值 |
| --- | --- |
| Organization or user | `klarkxy` |
| Repository | `dsh-editor` |
| Workflow filename | `npm-publish.yml` |
| Environment name | 留空（本工作流未指定 environment） |
| Allowed actions | 允许直接 `npm publish` |

按 [npm 官方说明](https://docs.npmjs.com/trusted-publishers/)完成绑定后，CI 使用短期 OIDC 身份，不再需要长期 token。维护者确认 OIDC 发布成功后，可移除引导用 secret 并撤销临时 token。仓库主分支规则还必须允许本工作流回写已确认发布包的 manifest；权限不足会明确失败，不绕过分支保护。

## 手动发布与排错

下面的 `0.1.0` 文件名仅为首次发布示例；以后以打包输出的实际版本为准。

在仓库根目录完成检查并打包，scope 不改变源码目录：

```sh
pnpm --filter @klarkxy/dsh-zhihu --filter @klarkxy/dsh-web-search-manager typecheck
pnpm exec vitest run packages/dsh-zhihu/src packages/dsh-web-search-manager/src
pnpm --filter @klarkxy/dsh-zhihu --filter @klarkxy/dsh-web-search-manager build
pnpm --filter @klarkxy/dsh-zhihu pack --pack-destination .pack/npm-release
pnpm --filter @klarkxy/dsh-web-search-manager pack --pack-destination .pack/npm-release
```

检查 tarball 的 exports、patch 与客户端 ID，在隔离的 DSH Web profile 安装验证后发布这些已检查的文件：

```sh
npm publish .pack/npm-release/klarkxy-dsh-zhihu-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
npm publish .pack/npm-release/klarkxy-dsh-web-search-manager-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
```

发布后从 npm 重新查询版本、下载地址和 `dist.integrity`，确认 registry 与本地 tarball 一致。新版本须同步版本号和安装示例，不覆盖已发布版本。
