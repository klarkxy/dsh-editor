import type { WorkbenchEndpoint } from '../contracts.ts'
import { importHandlers } from './import.ts'
import { lifecycleHandlers } from './lifecycle.ts'
import { memoryHandlers } from './memory.ts'
import { overviewHandlers } from './overview.ts'
import { projectHandlers } from './project.ts'
import { proofreadHandlers } from './proofread.ts'
import { proposalHandlers } from './proposal.ts'
import { snapshotHandlers } from './snapshot.ts'
import type { WorkbenchHandler, WorkbenchHandlers } from './types.ts'

const clusters: WorkbenchHandlers[] = [
  projectHandlers,
  overviewHandlers,
  proofreadHandlers,
  lifecycleHandlers,
  snapshotHandlers,
  importHandlers,
  proposalHandlers,
  memoryHandlers,
]

function assertUniqueHandlerKeys(maps: WorkbenchHandlers[]): void {
  const seen = new Set<string>()
  for (const map of maps) {
    for (const key of Object.keys(map)) {
      if (seen.has(key)) throw new Error(`duplicate workbench endpoint ${key}`)
      seen.add(key)
    }
  }
}

assertUniqueHandlerKeys(clusters)

export const workbenchHandlers = {
  ...projectHandlers,
  ...overviewHandlers,
  ...proofreadHandlers,
  ...lifecycleHandlers,
  ...snapshotHandlers,
  ...importHandlers,
  ...proposalHandlers,
  ...memoryHandlers,
} satisfies Record<WorkbenchEndpoint, WorkbenchHandler>

type ExtraHandlerKeys = Exclude<keyof typeof workbenchHandlers, WorkbenchEndpoint>
type MissingHandlerKeys = Exclude<WorkbenchEndpoint, keyof typeof workbenchHandlers>
type AssertExactHandlerKeys<Extra, Missing> = [Extra] extends [never]
  ? [Missing] extends [never]
    ? true
    : never
  : never
const _exactHandlerKeys: AssertExactHandlerKeys<ExtraHandlerKeys, MissingHandlerKeys> = true
void _exactHandlerKeys

export function getWorkbenchHandler(endpoint: string): WorkbenchHandler | undefined {
  if (!Object.hasOwn(workbenchHandlers, endpoint)) return undefined
  return workbenchHandlers[endpoint as WorkbenchEndpoint]
}

export function workbenchMutationEndpoints(): string[] {
  return (Object.keys(workbenchHandlers) as WorkbenchEndpoint[]).filter((endpoint) => {
    const handler: WorkbenchHandler = workbenchHandlers[endpoint]
    return handler.mutation === true
  })
}

export type { WorkbenchHandler, WorkbenchHandlers, WorkbenchRequestContext } from './types.ts'
export { str } from './types.ts'
