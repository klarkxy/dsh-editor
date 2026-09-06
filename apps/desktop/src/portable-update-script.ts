// 便携版自替换脚本。
//
// 便携单文件运行时 EXE 被进程占用,无法在应用内存活期间替换。主进程把这个 bat
// 写进临时目录并 detached 启动,随后 app.quit():脚本等 PID 退出后删旧 EXE、
// 把下载的新 EXE 移到原路径(保持文件名,桌面快捷方式不失效),再启动它。
//
// 纯模块,不引 Electron,方便单测。行尾必须 CRLF,否则 cmd 解析标签会出错。

export function buildPortableSwapScript(pid: number, targetExe: string, newExe: string): string {
  return [
    '@echo off',
    'setlocal',
    `set "TARGET=${targetExe}"`,
    `set "NEW=${newExe}"`,
    // 等主进程退出:tasklist 按 PID 过滤,进程消失前输出里会一直带着这个 PID。
    ':wait',
    `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul`,
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    // 文件锁释放有延迟,del 失败就重试,直到旧 EXE 真正消失。
    ':replace',
    'del "%TARGET%" 2>nul',
    'if exist "%TARGET%" (',
    '  timeout /t 1 /nobreak >nul',
    '  goto replace',
    ')',
    'move /y "%NEW%" "%TARGET%" >nul',
    'start "" "%TARGET%"',
    // bat 自删除:(goto) 让 cmd 停止读脚本,之后的 del 仍能执行。
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n')
}
