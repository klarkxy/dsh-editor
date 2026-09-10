import { scanProofread } from '../proofread.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const proofreadHandlers = {
  'proofread.scan': {
    async run({ op, body }) {
      return await scanProofread({
        access: op,
        scope: body.scope,
        path: str(body, 'path') || undefined,
        kinds: body.kinds,
      })
    },
  },
} satisfies WorkbenchHandlers
