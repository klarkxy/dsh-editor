# dsh-proofread

可独立安装的中文文本校对插件。纯文本入口不读文件、不创建会话、不调用模型。

Host：`/proofread` → `text.check({ text, kinds? })`。仅接受五种文本规则，Host 固定输入和结果预算。
返回 `{ ok, value: { findings, habitStats, truncated } }` 或明确错误；finding 偏移是输入文本的 UTF-16 下标。

`dsh-proofread/engine` 提供同步纯函数；作品扫描与人物卡对照仍由 workbench 所有。
