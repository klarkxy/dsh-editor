/** Official bundles the Editor surfaces. Others stay hidden unless the author already enabled them. */
export const EDITOR_OFFICIAL_BUNDLES: ReadonlySet<string> = new Set(['@deepseek-ai/dsh-experimental-voice-input-bundle'])
export type RecommendedPlugin = { packageName: string; title: string; description: string; homepage: string }
/** Public plugins whose tools and settings reach the writing partner inside the Editor shell. */
export const RECOMMENDED_PLUGINS: readonly RecommendedPlugin[] = [
  { packageName: '@klarkxy/dsh-web-search-manager', title: '网络搜索', description: '为写作搭档编排多个搜索源和网页读取，查资料时自动融合结果、失败时切换备用源。', homepage: 'https://klarkxy.github.io/dsh-plugins/plugins/web-search-manager/' },
  { packageName: '@klarkxy/dsh-zhihu', title: '知乎', description: '让写作搭档检索知乎内容、热榜与直答，用于查证和取材。', homepage: 'https://klarkxy.github.io/dsh-plugins/plugins/zhihu/' },
]
/** Monorepos whose usable members are curated above; their repo-level search hits are not installable plugins. */
export const HIDDEN_DISCOVERY_REPOS: ReadonlySet<string> = new Set(['klarkxy/dsh-plugins', 'deepseek-ai/deepseek-harness'])
