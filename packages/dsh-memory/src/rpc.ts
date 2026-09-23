import type { RpcResult } from './contracts.ts'
import { fail, ok, parseSessionId, projectIdFromCwd, sessionCwd } from './contracts.ts'
import { MemoryError } from './errors.ts'
import type { MemoryRuntime } from './service.ts'
import {
  createRpcSchema, listRpcSchema, patchRpcSchema, revisionRpcSchema, updateSettingsSchema,
} from './storage.ts'

export type SessionLookup = (sessionId: string) => unknown

export async function handleMemoryRpc(
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  runtime: MemoryRuntime,
  sessions: SessionLookup,
): Promise<RpcResult> {
  if (signal.aborted) return fail('MEMORY_CANCELLED', '请求已取消')
  try {
    if (endpoint === 'status') {
      const sessionId = parseSessionId(payload)
      return ok(await runtime.readStatus(sessionId, sessionId ? projectOf(sessions, sessionId) : undefined))
    }
    if (endpoint === 'settings.update') {
      const parsed = updateSettingsSchema.safeParse(payload)
      if (!parsed.success) return fail('MEMORY_INVALID', '记忆设置格式无效。')
      return ok(await runtime.updateSettings(parsed.data.settings, parsed.data.expectedRevision))
    }
    if (endpoint === 'records.list') {
      const parsed = listRpcSchema.safeParse(payload)
      if (!parsed.success) return fail('MEMORY_INVALID', '查询格式无效。')
      const projectId = projectOf(sessions, parsed.data.sessionId)
      const scope = parsed.data.global === true || !projectId
        ? { kind: 'global' as const }
        : { kind: 'project' as const, projectId }
      return ok(await runtime.list({
        scope,
        query: parsed.data.query,
        kinds: parsed.data.kinds,
        statuses: parsed.data.statuses,
        limit: parsed.data.limit,
      }))
    }
    if (endpoint === 'records.create') {
      const parsed = createRpcSchema.safeParse(payload)
      if (!parsed.success) return fail('MEMORY_INVALID', '新增条目格式无效。')
      const projectId = projectOf(sessions, parsed.data.sessionId)
      return ok(await runtime.createManualRecord({
        sessionId: parsed.data.sessionId,
        projectId,
        explicitGlobal: parsed.data.global === true,
        title: parsed.data.title,
        content: parsed.data.content,
        kind: parsed.data.kind,
        tags: parsed.data.tags,
        exceptions: parsed.data.exceptions,
        evidence: parsed.data.evidence,
        expiresAt: parsed.data.expiresAt,
      }))
    }
    if (endpoint === 'records.update') {
      const parsed = patchRpcSchema.safeParse(payload)
      if (!parsed.success) return fail('MEMORY_INVALID', '更新格式无效。')
      const { id, expectedRevision, sessionId: _sessionId, ...patch } = parsed.data
      return ok(await runtime.update(id, patch, expectedRevision))
    }
    if (endpoint === 'records.remove') {
      const parsed = revisionRpcSchema.safeParse(payload)
      if (!parsed.success) return fail('MEMORY_INVALID', '删除参数无效。')
      await runtime.remove(parsed.data.id, parsed.data.expectedRevision)
      return ok({ id: parsed.data.id })
    }
    if (endpoint === 'records.accept') return mutation(runtime.accept.bind(runtime), payload)
    if (endpoint === 'records.reject') return mutation(runtime.reject.bind(runtime), payload)
    if (endpoint === 'records.revoke') return mutation(runtime.revoke.bind(runtime), payload)
    if (endpoint === 'dream.run') {
      const sessionId = parseSessionId(payload)
      if (!sessionId) return fail('MEMORY_INVALID', '缺少会话。')
      return ok(await runtime.runIdleDream(sessionId, projectOf(sessions, sessionId), 'manual'))
    }
    return fail('MEMORY_INVALID', '未知操作。')
  } catch (error) {
    const code = error instanceof MemoryError ? error.code : 'MEMORY_FAILED'
    return fail(code, error instanceof Error ? error.message : '记忆操作失败。')
  }
}

function projectOf(sessions: SessionLookup, sessionId: string): string | undefined {
  return projectIdFromCwd(sessionCwd(sessions(sessionId)))
}

async function mutation(
  run: (id: string, expectedRevision: number) => Promise<unknown>,
  payload: unknown,
): Promise<RpcResult> {
  const parsed = revisionRpcSchema.safeParse(payload)
  if (!parsed.success) return fail('MEMORY_INVALID', '参数无效。')
  return ok(await run(parsed.data.id, parsed.data.expectedRevision))
}
