import { setChapterStatus } from '../chapter-status.ts'
import { readProjectOverview } from '../overview.ts'
import { readWritingHistory, recordWritingProgress } from '../writing-log.ts'
import { str, type WorkbenchHandlers } from './types.ts'

export const overviewHandlers = {
  'project.overview': {
    async run({ op }) {
      return await readProjectOverview(op)
    },
  },
  'chapter.statusSet': {
    mutation: true,
    async run({ op, body }) {
      return await setChapterStatus({ access: op, path: str(body, 'path'), status: body.status })
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
