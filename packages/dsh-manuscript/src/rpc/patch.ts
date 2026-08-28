import { collectInsertText } from './completion.ts'
import { normalizeWorkspaceRelative, PathConfineError } from './paths.ts'

export type PatchRoute = 'dsh-llm'

export const PATCH_LIMITS = {
  selectedText: 12_000,
  context: 4_000,
  proposal: 1_200,
} as const

export class PatchInputError extends Error {
  constructor(
    message: string,
    readonly code: 'PATH_REQUIRED' | 'SELECTION_REQUIRED' | 'SELECTION_TOO_LARGE',
  ) {
    super(message)
    this.name = 'PatchInputError'
  }
}

export type PatchRequest = {
  path: string
  selectedText: string
  before: string
  after: string
}

export type PatchStreamChunk = { type: string; text?: string; reason?: { kind?: string } }

export type PatchContext = {
  get?: (name: string) => unknown
}

type LlmBag = {
  stream?: (options: Record<string, unknown>) => AsyncIterable<PatchStreamChunk>
}

const PATCH_SYSTEM =
  '你是小说编辑。只输出一段可直接替换选中文本的简短改写，不解释、不复述提示、不使用 Markdown 围栏。保持原语言、人物视角与叙述时态。'

function textField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

/** Validate untrusted RPC data and keep all prompt text within fixed bounds. */
export function parsePatchRequest(payload: Record<string, unknown>): PatchRequest {
  const rawPath = textField(payload, 'path')
  if (!rawPath) throw new PatchInputError('path is required', 'PATH_REQUIRED')

  let path: string
  try {
    path = normalizeWorkspaceRelative(rawPath)
  } catch (error) {
    if (error instanceof PathConfineError) throw error
    throw error
  }
  if (path === '.') throw new PatchInputError('path is required', 'PATH_REQUIRED')

  const selectedText = textField(payload, 'selectedText')
  if (!selectedText) throw new PatchInputError('selected text is required', 'SELECTION_REQUIRED')
  if (selectedText.length > PATCH_LIMITS.selectedText) {
    throw new PatchInputError(`selected text exceeds ${PATCH_LIMITS.selectedText} characters`, 'SELECTION_TOO_LARGE')
  }

  return {
    path,
    selectedText,
    before: textField(payload, 'before').slice(-PATCH_LIMITS.context),
    after: textField(payload, 'after').slice(0, PATCH_LIMITS.context),
  }
}

async function streamPatch(input: {
  llm: LlmBag
  provider: string
  model: string
  request: PatchRequest
  signal: AbortSignal
}): Promise<string> {
  if (!input.llm.stream || input.signal.aborted) return ''
  try {
    const stream = input.llm.stream({
      provider: input.provider,
      model: input.model,
      maxTokens: 512,
      signal: input.signal,
      system: PATCH_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `【文件】${input.request.path}\n\n【前文】\n${input.request.before}\n\n【待改写】\n${input.request.selectedText}\n\n【后文】\n${input.request.after}\n\n只输出替换后的文本：`,
            },
          ],
        },
      ],
    })
    return collectPatchText(stream, input.signal)
  } catch {
    return ''
  }
}

async function* successfulChunks(stream: AsyncIterable<PatchStreamChunk>): AsyncIterable<PatchStreamChunk> {
  for await (const chunk of stream) {
    if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
      yield { type: 'error' }
      return
    }
    yield chunk
  }
}

function collectPatchText(stream: AsyncIterable<PatchStreamChunk>, signal: AbortSignal): Promise<string> {
  return collectInsertText(successfulChunks(stream), { signal, maxChars: PATCH_LIMITS.proposal })
}

/**
 * Produce an in-memory replacement proposal. This function never reads or
 * writes the requested file; the client remains responsible for stale checks
 * and applying an accepted proposal to its editor buffer.
 */
export async function completePatch(input: {
  ctx: PatchContext
  provider: string
  model: string
  request: PatchRequest
  signal: AbortSignal
}): Promise<{ text: string; route: PatchRoute }> {
  const llm = (input.ctx.get?.('llm') ?? {}) as LlmBag
  const text = await streamPatch({
    llm,
    provider: input.provider,
    model: input.model,
    request: input.request,
    signal: input.signal,
  })
  return { text, route: 'dsh-llm' }
}
