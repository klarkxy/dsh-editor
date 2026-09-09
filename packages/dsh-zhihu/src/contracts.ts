export const ZHIHU_SEARCH_TOOL_NAME = 'zhihu_search'
export const ZHIHU_GLOBAL_SEARCH_TOOL_NAME = 'zhihu_global_search'
export const ZHIHU_HOT_LIST_TOOL_NAME = 'zhihu_hot_list'
export const ZHIHU_ASK_TOOL_NAME = 'zhihu_ask'
export const ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME = 'zhihu_knowledge_search'
export const ZHIHU_RPC_CHANNEL = '/zhihu'
export const ZHIHU_CREDENTIAL_REF = 'ZHIHU_ACCESS_TOKEN'
export const ZHIHU_SEARCH_EVENT = 'dsh-editor/zhihu-search'
export type ZhihuRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
