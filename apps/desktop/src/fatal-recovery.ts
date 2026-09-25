import type { CrashReportSource } from './crash-report.js'

/** 原生恢复对话框的输入;按钮顺序即 response 下标。 */
export interface FatalDialogOptions {
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

export interface FatalRecoveryOperations {
  showDialog(options: FatalDialogOptions): Promise<number>
  /** 落崩溃报告;resolve 文件路径,写失败为 undefined。实现不得抛出。 */
  writeReport(error: unknown, source: CrashReportSource): Promise<string | undefined>
  stopBackend(): Promise<void>
  disablePlugins(): Promise<void>
  relaunch(): void
  exit(): void
  /** 关机途中为 true:只落报告,不再弹窗。 */
  isShuttingDown(): boolean
}

/** 等崩溃报告落盘的上限;超时直接弹窗,不阻塞恢复。 */
export const CRASH_REPORT_WAIT_MS = 1_000
/** 对话框 detail 的字符预算;完整错误在报告文件里。 */
const DETAIL_BUDGET = 1200
const DETAIL_TAIL_LINES = 8

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map((item) => errorMessage(item))].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

/** 对话框只展示错误尾部几行与报告路径;全文在崩溃报告文件里。 */
function dialogDetail(error: string, reportPath: string | undefined): string {
  const report = reportPath === undefined ? '' : `\n\n完整诊断已写入：\n${reportPath}`
  const tail = error.split(/\r\n|[\n\r\u2028\u2029]/u).slice(-DETAIL_TAIL_LINES).join('\n')
  const budget = Math.max(200, DETAIL_BUDGET - report.length)
  const shortened = tail.length <= budget ? tail : `……（前文省略，完整错误见诊断文件）\n${tail.slice(-budget)}`
  return `${shortened}${report}`
}

/**
 * 单个进程内的首个致命错误恢复:首错胜出,后续错误只 console.error,
 * 保证多窗口/多来源下恢复对话框只弹一次。
 */
export class DesktopFatalRecovery {
  private reported = false

  constructor(private readonly operations: FatalRecoveryOperations) {}

  get active(): boolean {
    return this.reported
  }

  async report(error: unknown, source: CrashReportSource): Promise<void> {
    if (this.reported) {
      console.error('dsh desktop: 已有一个致命错误在处理中，后续错误只记录', error)
      return
    }
    this.reported = true
    const reportPath = await this.persist(error, source)
    let message = 'DSH Editor 遇到无法自动恢复的错误'
    let detail = dialogDetail(errorMessage(error), reportPath)
    for (;;) {
      let response: number
      try {
        response = await this.operations.showDialog({
          title: 'DSH Editor',
          message,
          detail,
          buttons: ['退出', '重启', '禁用第三方插件并重启'],
          defaultId: 1,
          cancelId: 0,
        })
      } catch (failure) {
        /* 对话框不可用（如 app 尚未 ready）时不再尝试恢复，直接退出。 */
        console.error(failure)
        this.operations.exit()
        return
      }
      if (response === 0) {
        try { await this.operations.stopBackend() } catch (failure) { console.error(failure) }
        this.operations.exit()
        return
      }
      try {
        await this.operations.stopBackend()
        if (response === 2) await this.operations.disablePlugins()
        this.operations.relaunch()
        return
      } catch (failure) {
        /* 停后端/停用插件失败：换错误信息再弹一次，作者可改选其它出口。 */
        console.error(failure)
        message = '恢复操作未能完成'
        detail = dialogDetail(errorMessage(failure), reportPath)
      }
    }
  }

  /** 关机途中只落崩溃报告；否则进入恢复对话框。 */
  async reportFatal(error: unknown, source: CrashReportSource): Promise<void> {
    if (this.operations.isShuttingDown()) {
      await this.operations.writeReport(error, source)
      return
    }
    await this.report(error, source)
  }

  private async persist(error: unknown, source: CrashReportSource): Promise<string | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.operations.writeReport(error, source),
        new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), CRASH_REPORT_WAIT_MS) }),
      ])
    } catch (failure) {
      console.error('dsh desktop: crash report failed', failure)
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
}
