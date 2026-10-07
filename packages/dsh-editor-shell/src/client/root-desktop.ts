import { useEffect, useState, type MutableRefObject } from 'react'
import type { EditorCoreHandle } from 'dsh-manuscript/client/editor-core'
import { windowBridge } from './window-controls.tsx'

// Desktop notifications and exit activity follow the shell's mount lifetime.
export function useRootDesktop(editorHandleRef: MutableRefObject<EditorCoreHandle | null>) {
  const [startupUpdate, setStartupUpdate] = useState<{ version: string } | null>(null)
  /* 启动更新检查:主进程在后台跑,挂载后拉取缓存结果;仅发现新版本时弹轻提示,
     已是最新/失败都静默。浏览器开发模式没有桥,直接不跑。 */
  useEffect(() => {
    const check = windowBridge()?.getStartupUpdate
    if (!check) return
    let live = true
    void check().then((result) => {
      if (!live || result.status !== 'update-available' || !result.latest) return
      setStartupUpdate({ version: result.latest.version })
    }).catch(() => undefined)
    return () => { live = false }
  }, [])
  /* 桌面端退出确认:每秒读一次编辑器命令状态,busy 翻转时经预加载桥上报主进程;
     卸载时若仍 busy 补一条 false。浏览器端没有桥,直接不跑。 */
  useEffect(() => {
    const report = windowBridge()?.reportActivity
    if (!report) return
    const read = () => Boolean(editorHandleRef.current?.getCommandState().busy)
    let last = read()
    report({ busy: last })
    const timer = globalThis.setInterval(() => {
      const busy = read()
      if (busy === last) return
      last = busy
      report({ busy })
    }, 1_000)
    return () => {
      globalThis.clearInterval(timer)
      if (last) report({ busy: false })
    }
  }, [])

  return { startupUpdate, setStartupUpdate }
}
