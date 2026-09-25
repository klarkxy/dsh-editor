import { writeFileSync } from 'node:fs'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'

/** 致命错误表面位置:后端守护进程、渲染进程或主进程自身。 */
export type CrashReportSource = 'supervisor' | 'renderer' | 'main'

/** 每份报告头部记录的运行时事实。 */
export interface CrashReportFacts {
  name: string
  version: string
  platform: string
  arch: string
  electron: string
  node: string
  locale: string
}

export interface CrashReportInput {
  source: CrashReportSource
  error: unknown
  /** 可选的补充诊断(如后端退出前自报的摘要)。 */
  diagnostic?: string
  /** 渲染进程最近的 error 级控制台输出,旧的在前。 */
  rendererConsole?: readonly string[]
}

export const CRASH_REPORT_PREFIX = 'crash-'
/** 只清理本命名法的文件;其它文件一律不动。 */
const CRASH_REPORT_NAME = /^crash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:supervisor|renderer|main)\.log$/u
export const CRASH_REPORTS_RETAINED = 10
export const RENDERER_CONSOLE_MAX_BYTES = 64 * 1024
/** 错误段上限: supervisor 的退出错误本身可能已带大段 stderr 尾部。 */
export const ERROR_SECTION_MAX_CHARS = 256 * 1024

/**
 * 渲染控制台尾部的有界环形缓冲:总量超过上限时从最旧的一行开始丢弃;
 * 单行超限则整行保留,避免把长栈从中间截断。
 */
export class RendererConsoleTail {
  private readonly lines: string[] = []
  private bytes = 0

  constructor(private readonly maxBytes = RENDERER_CONSOLE_MAX_BYTES) {}

  append(line: string): void {
    this.lines.push(line)
    this.bytes += Buffer.byteLength(line)
    while (this.lines.length > 1 && this.bytes > this.maxBytes) {
      this.bytes -= Buffer.byteLength(this.lines.shift()!)
    }
  }

  snapshot(): readonly string[] {
    return [...this.lines]
  }
}

/** 报告文件名:按 ISO 时间可排序,冒号与点换成连字符。 */
export function crashReportFileName(time: Date, source: CrashReportSource): string {
  return `${CRASH_REPORT_PREFIX}${time.toISOString().replaceAll(/[:.]/gu, '-')}-${source}.log`
}

function boundedErrorSection(error: unknown): string {
  const rendered = inspect(error, { depth: 6, maxStringLength: 64 * 1024, maxArrayLength: 100, breakLength: 120 })
  return rendered.length <= ERROR_SECTION_MAX_CHARS
    ? rendered
    : `${rendered.slice(0, ERROR_SECTION_MAX_CHARS)}\n… (error section cut at ${ERROR_SECTION_MAX_CHARS} characters)`
}

export function renderCrashReport(input: CrashReportInput, facts: CrashReportFacts, time: Date): string {
  const header = [
    `time: ${time.toISOString()}`,
    `source: ${input.source}`,
    `app: ${facts.name} ${facts.version}`,
    `platform: ${facts.platform} ${facts.arch}`,
    `electron: ${facts.electron}`,
    `node: ${facts.node}`,
    `locale: ${facts.locale}`,
    `pid: ${process.pid}`,
  ]
  const consoleLines = input.rendererConsole ?? []
  const consoleSection = consoleLines.length === 0
    ? '(no error-level renderer console output was captured)'
    : consoleLines.join('\n')
  return [
    header.join('\n'),
    '',
    '--- error ---',
    boundedErrorSection(input.error),
    '',
    ...(input.diagnostic === undefined ? [] : ['--- diagnostic ---', input.diagnostic, '']),
    '--- renderer console (error level, oldest first) ---',
    consoleSection,
    '',
  ].join('\n')
}

/**
 * 把一份崩溃报告写入 logsDir(目录不存在则创建)。文件 0600、目录 0700、
 * 'wx' 不覆盖已存在的同刻报告。写盘失败只 console.error 并返回 undefined:
 * 恢复流程不能因为诊断辅助失败而中断。
 */
export async function writeCrashReport(
  logsDir: string,
  input: CrashReportInput,
  facts: CrashReportFacts,
  time: Date = new Date(),
): Promise<string | undefined> {
  const path = join(logsDir, crashReportFileName(time, input.source))
  try {
    await mkdir(logsDir, { recursive: true, mode: 0o700 })
    await writeFile(path, renderCrashReport(input, facts, time), { mode: 0o600, flag: 'wx' })
    return path
  } catch (error) {
    console.error('dsh desktop: crash report could not be written', path, error)
    return undefined
  }
}

/** 按文件名排序删除最旧的报告,只保留 keep 份;目录不存在不算失败。 */
export async function pruneCrashReports(logsDir: string, keep = CRASH_REPORTS_RETAINED): Promise<void> {
  let names: string[]
  try {
    names = await readdir(logsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.error('dsh desktop: crash report directory could not be listed', logsDir, error)
    return
  }
  const reports = names.filter((name) => CRASH_REPORT_NAME.test(name)).sort()
  for (const name of reports.slice(0, Math.max(0, reports.length - keep))) {
    try {
      await unlink(join(logsDir, name))
    } catch (error) {
      console.error('dsh desktop: stale crash report could not be removed', join(logsDir, name), error)
    }
  }
}

/** 打包环境排障:模块级致命错误覆盖写入指定文件。失败只 console.error,绝不抛出。 */
export function writeStartupDiagnostic(path: string, error: unknown): void {
  try {
    writeFileSync(path, `${boundedErrorSection(error)}\n`, 'utf8')
  } catch (failure) {
    console.error('dsh desktop: startup diagnostic could not be written', path, failure)
  }
}
