/** Official bundles the Editor surfaces. Others stay hidden unless the author already enabled them, or installed a removable copy. */
export const EDITOR_OFFICIAL_BUNDLES: ReadonlySet<string> = new Set(['@deepseek-ai/dsh-experimental-voice-input-bundle'])
export type RecommendedPlugin = { packageName: string; title: string; description: string; homepage: string }
/** Public plugins whose tools and settings reach the writing partner inside the Editor shell. */
export const RECOMMENDED_PLUGINS: readonly RecommendedPlugin[] = [
  /* 桌面端的外链白名单只放行 github.com 等域名;「插件主页」指向仓库目录,
     不指向 klarkxy.github.io 发布站(桌面端点会被 navigation.ts 拦截)。 */
  { packageName: '@klarkxy/dsh-web-search-manager', title: '网络搜索', description: '为写作搭档编排多个搜索源和网页读取，查资料时自动融合结果、失败时切换备用源。', homepage: 'https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager' },
  { packageName: '@klarkxy/dsh-zhihu', title: '知乎', description: '让写作搭档检索知乎内容、热榜与直答，用于查证和取材。', homepage: 'https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu' },
]
/** Monorepos whose usable members are curated above; their repo-level search hits are not installable plugins. */
export const HIDDEN_DISCOVERY_REPOS: ReadonlySet<string> = new Set(['klarkxy/dsh-plugins', 'deepseek-ai/deepseek-harness'])
