# @klarkxy/dsh-zhihu

DSH 知乎搜索、直答、知识库与用量插件。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.7-alpha.1`，无需构建本仓库。

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

重启 DSH Web，打开「知乎资料」填写 Access Secret（DSH 凭据 `ZHIHU_ACCESS_TOKEN`）。请使用完整 scoped 包名；无 scope 的 `dsh-zhihu` 属于其他维护者。

模型需要使用知乎工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

## 使用

DSH Web 提供搜索、设置、用量与知识库视图。DSH Editor 在「设置 → 知乎资料」配置、查看用量、管理知识库和测试连接，已内置模型工具。

可查询站内、全网、热榜、直答和公开知识库。上传的参考文件保存在知乎云端，请勿上传未发表手稿。

同一 profile 安装 [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) 后，可在网络搜索的后端列表开启「知乎全网搜索」，共用 Access Secret。专用知乎工具仍可独立使用。

## 开发

接口见 [contracts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/contracts.ts) 与 [tools](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/tools.ts)。

[发布维护](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/LICENSE)
