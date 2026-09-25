# @klarkxy/dsh-zhihu

DSH 知乎搜索、直答、知识库与用量插件。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`，无需构建本仓库。安装：

```sh
npm install @klarkxy/dsh-zhihu
```

然后加载：

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

重启 DSH Web，打开「知乎资料」填写 Access Secret（DSH 凭据 `ZHIHU_ACCESS_TOKEN`）。请使用完整 scoped 包名；无 scope 的 `dsh-zhihu` 属于其他维护者。

模型需要使用知乎工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

## 使用

DSH Web 提供搜索、设置、用量与知识库视图。在「设置 → 知乎资料」配置、查看用量、管理知识库和测试连接；模型工具随插件一同提供。

启用 tools 入口后，模型可使用五个工具：

- `zhihu_search`：知乎站内搜索，拉取社区证据；结果仅作社区/读者反馈参考，不构成 canon，也不直接写入项目文件。
- `zhihu_global_search`：知乎开放平台全网搜索，检索站外公开网页资料；仅作参考。
- `zhihu_hot_list`：拉取知乎热榜，了解当前社区热点；仅作题材与热点参考。
- `zhihu_ask`：调用知乎直答（OpenAI 兼容的 AI 问答），基于知乎社区内容生成综合回答；适合考据与背景调研。
- `zhihu_knowledge_search`：检索知乎知识库（RAG 片段），默认只查公开库；在知乎网页端上传过个人资料后可加个人/订阅召回范围。

用量按日计数（调用次数、失败次数与成功调用返回的条目数），视图默认展示最近 30 天，最多可查 90 天。知识库上传单文件上限 20 MB。

可查询站内、全网、热榜、直答和公开知识库。上传的参考文件保存在知乎云端，请勿上传未发表手稿。

同一 profile 还安装 [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) 时，本插件会向网络搜索注册「知乎全网搜索」后端。在网络搜索设置中启用它，即可让通用网络搜索工具使用知乎的全网搜索能力，并共用「知乎资料」中配置的 Access Secret。专用知乎工具仍可独立使用。

## 开发

接口见 [contracts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/contracts.ts) 与 [tools](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/tools.ts)。

[发布维护](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/LICENSE)
