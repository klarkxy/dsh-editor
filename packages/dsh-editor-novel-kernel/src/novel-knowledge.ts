import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NOVEL_KNOWLEDGE_TOOL_NAME } from './contracts.ts'

export { NOVEL_KNOWLEDGE_TOOL_NAME } from './contracts.ts'
export const NOVEL_KNOWLEDGE_VERSION = 1
export const NOVEL_KNOWLEDGE_MAX_TOPICS = 3
export const NOVEL_KNOWLEDGE_MAX_CARD_CHARS = 6_000

const KNOWLEDGE_FILES = {
  planning: 'planning.md',
  characters: 'characters.md',
  drafting: 'drafting.md',
  dialogue: 'dialogue.md',
  interiority: 'interiority.md',
  style: 'style.md',
  review: 'review.md',
  'chinese-flow': 'chinese-flow.md',
  'first-reader': 'first-reader.md',
  canon: 'canon.md',
} as const

export type NovelKnowledgeTopic = keyof typeof KNOWLEDGE_FILES

export type NovelKnowledgeResult = {
  version: typeof NOVEL_KNOWLEDGE_VERSION
  topics: Array<{ id: NovelKnowledgeTopic; content: string }>
}

const resourceRoot = new URL('../resources/novel-knowledge/', import.meta.url)

export function novelKnowledgeTopics(): NovelKnowledgeTopic[] {
  return Object.keys(KNOWLEDGE_FILES) as NovelKnowledgeTopic[]
}

export function normalizeNovelKnowledgeArguments(args: Readonly<Record<string, unknown>>): NovelKnowledgeTopic[] {
  const keys = Object.keys(args)
  if (keys.length !== 1 || keys[0] !== 'topics' || !Array.isArray(args.topics)) {
    throw new Error('novel_knowledge only accepts a topics array')
  }

  const topics = [...new Set(args.topics)]
  if (topics.length < 1 || topics.length > NOVEL_KNOWLEDGE_MAX_TOPICS) {
    throw new Error(`choose between one and ${NOVEL_KNOWLEDGE_MAX_TOPICS} unique topics`)
  }
  for (const topic of topics) {
    if (typeof topic !== 'string' || !(topic in KNOWLEDGE_FILES)) throw new Error(`unknown novel knowledge topic: ${String(topic)}`)
  }
  return topics as NovelKnowledgeTopic[]
}

export function isNovelKnowledgeArguments(args: Readonly<Record<string, unknown>>): boolean {
  try {
    normalizeNovelKnowledgeArguments(args)
    return true
  } catch {
    return false
  }
}

export async function loadNovelKnowledge(args: Readonly<Record<string, unknown>>): Promise<NovelKnowledgeResult> {
  const topics = normalizeNovelKnowledgeArguments(args)
  return {
    version: NOVEL_KNOWLEDGE_VERSION,
    topics: await Promise.all(topics.map(async (id) => {
      const content = (await readFile(new URL(KNOWLEDGE_FILES[id], resourceRoot), 'utf8')).trim()
      if (!content || content.length > NOVEL_KNOWLEDGE_MAX_CARD_CHARS) {
        throw new Error(`invalid bundled novel knowledge card: ${id}`)
      }
      return { id, content }
    })),
  }
}

export function createNovelKnowledgeTool() {
  const topicEnum = novelKnowledgeTopics()
  return defineTool({
    name: NOVEL_KNOWLEDGE_TOOL_NAME,
    description: 'Optionally load up to three bundled fiction-writing reference topics. This is advice, not a mode, workflow, project fact, or permission.',
    parameters: {
      topics: {
        type: 'array',
        required: true,
        description: 'One to three useful reference topics. Do not call ceremonially.',
        items: { type: 'string', enum: topicEnum },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'integer', required: true },
          topics: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render(_args, value) {
        const result = value as NovelKnowledgeResult
        return result.topics.map((topic) => ({
          type: 'text' as const,
          text: `<novel_knowledge topic="${topic.id}" version="${result.version}">\n${topic.content}\n</novel_knowledge>`,
        }))
      },
    },
    isConcurrencySafe() { return true },
    async execute(args) { return loadNovelKnowledge(args as Readonly<Record<string, unknown>>) },
  })
}
