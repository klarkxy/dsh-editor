import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FusionRuntime } from './runtime.ts'
import { requireFusion } from './validation.ts'

const taskFields = { taskId: { type: 'string' as const, required: true }, taskRevision: { type: 'integer' as const, required: true } } as const
const candidateFields = { ...taskFields, candidateId: { type: 'string' as const, required: true }, hash: { type: 'string' as const, required: true } } as const
const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }] }
/** Exact execution Agent identity is bound at registration and checked again on every call. */
export function fusionTools(runtime: FusionRuntime, agent: Agent, sidekick: boolean) {
  const bound = (exec: { agent?: unknown }) => {
    requireFusion(exec.agent === agent, 'UNAUTHORIZED', 'Fusion tools cannot be borrowed by another Agent.')
    return runtime.actor(agent)
  }
  if (sidekick) return [defineTool({ name: 'fusion_report', description: 'Report the exact candidate or a decision request for your current Fusion task. Never write the manuscript. Use a unique reportId; do not regenerate or resend after acknowledgement.',
    parameters: { ...taskFields, reportId: { type: 'string', required: true }, kind: { type: 'string', enum: ['candidate', 'decision'], required: true }, text: { type: 'string', required: true }, report: { type: 'string' } }, output,
    async execute(args, exec) { return JSON.stringify(await runtime.service.report(bound(exec), { ...args, signal: exec.signal })) },
  })]
  return [
    defineTool({ name: 'fusion_delegate', description: 'Delegate one bounded task to the same persistent Sidekick. In writing sessions the Writer authors exact prose; provide the original versioned target from read. Wait for its report, then read and review. Generic tasks retain ordinary execution tools; explicitly cancel before takeover.',
      parameters: { title: { type: 'string', required: true }, goal: { type: 'string', required: true }, context: { type: 'string' }, constraints: { type: 'array', items: { type: 'string' } }, acceptance: { type: 'array', items: { type: 'string' } }, target: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['edit', 'create'], required: true }, path: { type: 'string', required: true }, oldText: { type: 'string' }, targetVersion: { type: 'string' }, basis: { type: 'array', items: { type: 'object', properties: { path: { type: 'string', required: true }, version: { type: 'string', required: true }, label: { type: 'string' } }, additionalProperties: false } } }, description: 'Writing target: edit requires original targetVersion and unique exact oldText; Writer text replaces that fragment. create requires a nonexistent .md/.txt path; Writer text becomes full content. basis lists original context read versions. No replacement text is accepted here.' } }, output,
      async execute(args, exec) { bound(exec); return JSON.stringify(await runtime.delegate(agent, args, exec.signal)) },
    }),
    defineTool({ name: 'fusion_read', description: 'Read the saved exact Sidekick candidate and its hash. Review this content without rewriting it.', parameters: { taskId: { type: 'string', required: true }, candidateId: { type: 'string' } }, output,
      async execute(args, exec) { return JSON.stringify(runtime.service.read(bound(exec), args.taskId, args.candidateId)) },
    }),
    defineTool({ name: 'fusion_review', description: 'Review the exact candidate id and hash. accept is model review only; the author still decides manuscript adoption. revise requires concrete feedback. reject ends the task.',
      parameters: { ...candidateFields, verdict: { type: 'string', enum: ['accept', 'revise', 'reject'], required: true }, feedback: { type: 'string', required: true } }, output,
      async execute(args, exec) { return JSON.stringify(await runtime.service.review(bound(exec), { ...args, signal: exec.signal })) },
    }),
    defineTool({ name: 'fusion_decide', description: 'Resolve a Sidekick decision or explicitly resume an interrupted task with feedback, reusing its persistent session.', parameters: { ...taskFields, feedback: { type: 'string', required: true } }, output,
      async execute(args, exec) { return JSON.stringify(await runtime.service.decide(bound(exec), { ...args, signal: exec.signal })) },
    }),
    defineTool({ name: 'fusion_cancel', description: 'Cancel the owned Sidekick task before explicit takeover. This preserves unrelated child sessions and does not undo files already applied.', parameters: taskFields, output,
      async execute(args, exec) { const actor = bound(exec); await runtime.service.cancel(actor, args.taskId, args.taskRevision); return 'Fusion task cancelled; takeover is now explicit.' },
    }),
  ]
}
