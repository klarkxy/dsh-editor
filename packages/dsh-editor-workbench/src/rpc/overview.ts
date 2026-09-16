import { readProjectOverview } from '../overview.ts'
import { readWritingHistory, recordWritingProgress } from '../writing-log.ts'
import { type WorkbenchHandlers } from './types.ts'

export const overviewHandlers = {
  'project.overview': {
    async run({ op }) {
      return await readProjectOverview(op)
    },
  },
  'progress.record': {
    mutation: true,
    async run({ op, body }) {
      return await recordWritingProgress(op, body.totalChars)
    },
  },
  'progress.history': {
    async run({ op, body }) {
      return await readWritingHistory(op, body.days)
    },
  },
} satisfies WorkbenchHandlers
