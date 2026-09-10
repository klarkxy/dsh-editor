import { PROJECT_CONTEXT_SCHEMA, parseProjectContextEnvelope, type EditorTaskEnvelope, type TaskContextCompilation } from './contracts.ts'
import { readProjectRules, type WorkspaceFileContext } from 'dsh-manuscript/host-api'

/** Current requests contain task coordinates only. All project materials are read on demand. */
export async function compileContext(files: WorkspaceFileContext, userRequest: string, activePath?: string, _authorPreferences?: string, _authorMemory?: string): Promise<TaskContextCompilation> {
  // Preflight rules so a failed read is visible before the composer accepts the message.
  await readProjectRules(files)
  const envelope: EditorTaskEnvelope = {
    schema: PROJECT_CONTEXT_SCHEMA, version: 3, user_request: userRequest,
    ...(activePath ? { active_path: activePath.replace(/\\/g, '/') } : {}),
  }
  const serialized = JSON.stringify(envelope)
  if (!parseProjectContextEnvelope(serialized)) throw new Error('当前文档路径无效，无法发送请求。')
  return { envelope, serialized, receipt: { sources: [] } }
}
