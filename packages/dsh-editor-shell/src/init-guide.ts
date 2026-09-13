import type { SessionId } from './dsh-compat.ts'
import type { ProjectInspectionResponse } from 'dsh-editor-workbench/contracts'
import { buildNovelIndexPrompt } from './novel-index.ts'
import type { ShellContext } from './client/shared.ts'

/**
 * 空项目的采访式初始化：让助手扮演采访者，一次一个问题地收集构想，
 * 达成共识的结论立刻用 novel_propose 落成单张人物卡、单条世界书或大纲，
 * 而不是最后一次性倾泻到人物索引或设定总汇。
 */
export function buildInterviewPrompt(): string {
  return `这个项目还是空的。请扮演一位采访者，和我把这部作品的核心构想聊出来。

规则：
- 一次只问一个问题，等我回答后再问下一个；不要一次性抛出问卷。
- 依次澄清：题材与目标读者、风格与叙事口吻、主角与核心冲突、世界观的边界与规则。
- 每当一个结论达成共识，立即用 novel_propose 写入对应文件：作品级概述写项目总览.md；走向写大纲/下的 Markdown；每位角色单独写 人物卡/姓名.md；每条设定单独写 世界书/词条名.md。不要把多人写进同一张人物卡，也不要把多条地点、势力、规则或物品写成一份设定总汇或人物索引。一次提案只处理一个文件，等我确认。
- 落盘前先 glob/grep 确认有没有同名或相关卡片；已有文件用 edit，不要再 create 一份合订本。
- 我可以随时打断、跳过或结束采访；采访过程中不要虚构我尚未确认的内容。`
}

/** 初始化引导的三种状态：空项目走采访，有内容但索引未建走探索，其余不打扰。 */
export function initGuideState(inspection: Pick<ProjectInspectionResponse, 'textFiles' | 'indexReady'>): 'interview' | 'explore' | 'done' {
  if (inspection.textFiles.length === 0) return 'interview'
  return inspection.indexReady ? 'done' : 'explore'
}

export type InitGuideVisibility = {
  hasWorkspace: boolean
  inspected: boolean
  initState: 'interview' | 'explore' | 'done'
  dismissed: boolean
  interviewCompleted: boolean
  engaged: boolean
  workspaceHasConversation: boolean
}

/**
 * 空作品不占搭档栏：作者先写第一章，采访入口不自动出现。
 * 有稿但还没索引时，保留收起的「了解作品」一行，作者自己展开。
 * 已经点过开始（engaged）时留下进行/完成反馈。
 */
export function shouldShowInitGuide(input: InitGuideVisibility): boolean {
  if (!input.hasWorkspace || !input.inspected) return false
  if (input.initState === 'done' || input.dismissed) return false
  if (input.initState === 'interview' && input.interviewCompleted) return false
  if (input.initState === 'interview' && !input.engaged) return false
  return input.engaged || !input.workspaceHasConversation
}

export type AutoIndexInputs = {
  initState: 'interview' | 'explore' | 'done'
  initCompleted: boolean
  appliedDuringInterview: boolean
  running: boolean
  alreadyTriggered: boolean
}

/**
 * 采访初始化已开始且至少有一份提案被应用过、且当前会话空闲,才允许自动
 * 接上"建立作品索引"。alreadyTriggered 由调用方用 ref 记,只触发一次
 * （失败不重试,避免循环）。"刚停下"的判断在调用方做,这里只确认当前
 * 是空闲(running=false),不依赖历史值。
 */
export function shouldAutoIndexAfterInterview(inputs: AutoIndexInputs): boolean {
  if (inputs.alreadyTriggered) return false
  if (inputs.initState !== 'interview') return false
  if (!inputs.initCompleted) return false
  if (!inputs.appliedDuringInterview) return false
  if (inputs.running) return false
  return true
}

/**
 * 触发"通读项目并建立索引"的后台回合：索引由 novel_index_write 工具直接落盘，
 * 不再需要预建 stub，也不经提案确认。该回合在聊天界面按既有设计隐藏。
 */
export async function startExploreInit(ctx: ShellContext, sessionId: SessionId): Promise<boolean> {
  try {
    const session = ctx.sessions.binding(sessionId)?.session
    if (!session) return false
    const result = await session.prompt([{ type: 'text', text: buildNovelIndexPrompt() }], 'queue')
    return result.ok
  } catch {
    return false
  }
}

export const INIT_SETTINGS_NAMESPACE = 'dsh-editor-init'

export type InitSettings = { dismissedWorkspaceIds: string[] }

/** 宽容解析：坏数据一律当作"没有忽略过"。 */
export function decodeInitSettings(value: unknown): InitSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { dismissedWorkspaceIds: [] }
  const raw = (value as Record<string, unknown>)['dismissedWorkspaceIds']
  return {
    dismissedWorkspaceIds: Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [],
  }
}
