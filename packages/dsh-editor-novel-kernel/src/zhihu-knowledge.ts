/**
 * 知乎知识库的管理侧能力:列知识库、上传文件。仅供设置页 RPC 使用,
 * 不暴露为模型工具——上传会把文件送入知乎云端,必须是用户在界面上显式发起。
 *
 * 端点（来源：github.com/klarkxy/zhihu-search，src/zhihu_search/upstream/http_client.py）：
 *   - 列表:GET /api/v1/knowledge/bases?Scope=all|created|subscribed
 *   - 上传:POST /api/v1/knowledge/files(multipart: File + 可选 KnowledgeBaseID),同步解析
 */
import {
  parseZhihuEnvelope,
  zhihuFetchJson,
  ZhihuSearchError,
  type ZhihuClientOptions,
} from './zhihu-client.ts'

export const ZHIHU_KNOWLEDGE_LIST_VERSION = 1
export const ZHIHU_KNOWLEDGE_UPLOAD_VERSION = 1
/** 设置页 RPC 走 JSON/base64 传输,限额压到 20MB(平台上限 100MB)。 */
export const ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const ZHIHU_KNOWLEDGE_UPLOAD_TIMEOUT_MS = 180_000

const KNOWLEDGE_BASES_PATH = '/api/v1/knowledge/bases'
const KNOWLEDGE_FILES_PATH = '/api/v1/knowledge/files'

export const ZHIHU_KNOWLEDGE_FILE_EXTENSIONS = [
  '.pdf', '.md', '.txt', '.ppt', '.pptx', '.xlsx', '.xls', '.docx', '.doc',
  '.webp', '.png', '.jpg', '.mobi', '.epub', '.csv', '.azw3',
] as const

const KNOWLEDGE_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mobi': 'application/x-mobipocket-ebook',
  '.epub': 'application/epub+zip',
  '.csv': 'text/csv',
  '.azw3': 'application/vnd.amazon.ebook',
}

export type ZhihuKnowledgeBase = {
  id: string
  name: string
  relation: string
  visibility: string
  isDefault: boolean
  contentCount: number
}

export type ZhihuKnowledgeBaseList = {
  version: typeof ZHIHU_KNOWLEDGE_LIST_VERSION
  bases: ZhihuKnowledgeBase[]
}

function normalizeBase(raw: Record<string, unknown>): ZhihuKnowledgeBase {
  return {
    id: typeof raw.KnowledgeBaseID === 'string' ? raw.KnowledgeBaseID : '',
    name: typeof raw.Name === 'string' && raw.Name.length > 0 ? raw.Name : '(未命名知识库)',
    relation: typeof raw.Relation === 'string' ? raw.Relation : '',
    visibility: typeof raw.Visibility === 'string' ? raw.Visibility : '',
    isDefault: raw.IsDefault === true,
    contentCount: typeof raw.ContentCount === 'number' ? raw.ContentCount : 0,
  }
}

export async function listZhihuKnowledgeBases(options: ZhihuClientOptions = {}): Promise<ZhihuKnowledgeBaseList> {
  const body = await zhihuFetchJson(KNOWLEDGE_BASES_PATH, {
    params: { Scope: 'all' },
  }, '知乎知识库列表', options)
  const data = parseZhihuEnvelope(body) as { Items?: unknown }
  const items = Array.isArray(data.Items) ? data.Items : []
  return {
    version: ZHIHU_KNOWLEDGE_LIST_VERSION,
    bases: items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .map(normalizeBase)
      .filter((base) => base.id.length > 0),
  }
}

export type ZhihuKnowledgeUploadInput = {
  fileName: string
  data: Uint8Array
  /** 指定目标知识库;缺省进默认库。 */
  knowledgeBaseId?: string
}

export type ZhihuKnowledgeUpload = {
  version: typeof ZHIHU_KNOWLEDGE_UPLOAD_VERSION
  knowledgeBaseId: string
  recallContentId: string
  fileName: string
  fileSize: number
  title: string
  abstract: string
  originUrl: string
}

/** 校验文件名与大小,返回小写扩展名。 */
export function checkKnowledgeFile(fileName: string, size: number): string {
  const cleaned = fileName.trim()
  if (!cleaned) throw new ZhihuSearchError('BAD_RESPONSE', '知识库文件名不能为空。')
  // 去掉路径成分,只保留文件名
  const base = cleaned.split(/[\\/]/).pop() ?? cleaned
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 32 || code === 127) throw new ZhihuSearchError('BAD_RESPONSE', '知识库文件名不能包含控制字符。')
  }
  if (new TextEncoder().encode(base).length > 255) {
    throw new ZhihuSearchError('BAD_RESPONSE', '知识库文件名不能超过 255 个 UTF-8 字节。')
  }
  if (size <= 0) throw new ZhihuSearchError('BAD_RESPONSE', '知识库文件内容不能为空。')
  if (size > ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES) {
    throw new ZhihuSearchError('BAD_RESPONSE', `知识库文件大小不能超过 ${ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES / 1024 / 1024}MB。`)
  }
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : ''
  if (!(ZHIHU_KNOWLEDGE_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ZhihuSearchError('BAD_RESPONSE', `知识库上传仅支持 ${ZHIHU_KNOWLEDGE_FILE_EXTENSIONS.join('、')}。`)
  }
  return ext
}

export async function uploadZhihuKnowledgeFile(
  input: ZhihuKnowledgeUploadInput,
  options: ZhihuClientOptions = {},
): Promise<ZhihuKnowledgeUpload> {
  const cleaned = (input.fileName.trim().split(/[\\/]/).pop() ?? input.fileName.trim())
  const ext = checkKnowledgeFile(input.fileName, input.data.byteLength)
  const form = new FormData()
  if (input.knowledgeBaseId) form.set('KnowledgeBaseID', input.knowledgeBaseId)
  form.set('File', new Blob([input.data.buffer as ArrayBuffer], { type: KNOWLEDGE_CONTENT_TYPES[ext] ?? 'application/octet-stream' }), cleaned)
  const body = await zhihuFetchJson(KNOWLEDGE_FILES_PATH, {
    formData: form,
  }, '知乎知识库上传', { ...options, timeoutMs: options.timeoutMs ?? ZHIHU_KNOWLEDGE_UPLOAD_TIMEOUT_MS })
  const data = parseZhihuEnvelope(body) as Record<string, unknown>
  return {
    version: ZHIHU_KNOWLEDGE_UPLOAD_VERSION,
    knowledgeBaseId: typeof data.KnowledgeBaseID === 'string' ? data.KnowledgeBaseID : '',
    recallContentId: typeof data.RecallContentID === 'string' ? data.RecallContentID : '',
    fileName: typeof data.FileName === 'string' ? data.FileName : cleaned,
    fileSize: typeof data.FileSize === 'number' ? data.FileSize : input.data.byteLength,
    title: typeof data.Title === 'string' ? data.Title : '',
    abstract: typeof data.Abstract === 'string' ? data.Abstract : '',
    originUrl: typeof data.OriginUrl === 'string' ? data.OriginUrl : '',
  }
}
