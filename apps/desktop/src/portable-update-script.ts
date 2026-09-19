// 便携版自替换脚本。
//
// 便携单文件运行时 EXE 被进程占用,无法在应用内存活期间替换。主进程把这个 bat
// 写进临时目录并 detached 启动,随后 app.quit()。
//
// 顺序:等旧进程退出 → 把新文件暂存到同目录 → 旧版本改名为 .bak → 新文件就位
// → 启动新进程。任一步失败都恢复旧版本(或根本没动旧文件)。没有“先删旧程序
// 再指望 move 一定成功”这条不可恢复路径。
//
// 纯模块,不引 Electron,方便单测。行尾必须 CRLF,否则 cmd 解析标签会出错。
// DSH_UPDATE_TEST_PAUSE / DSH_UPDATE_TEST_SKIP_START 只给故障注入测试用,
// 正式升级不会设置。跳过 start 是因为测试夹具是假 .cmd,start 会弹出
// 停在 vitest 工作目录的可见命令行窗口。
// `timeout` 在 detached / stdin 重定向时会立即报错退出；ping loopback
// 提供不依赖控制台输入的一秒延迟。

export function buildPortableSwapScript(pid: number, targetExe: string, newExe: string): string {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    `set "PID=${pid}"`,
    `set "TARGET=${targetExe}"`,
    `set "NEW=${newExe}"`,
    'set "LOG=%TEMP%\\dsh-editor-portable-update.log"',
    'set "MAX_WAIT=120"',
    '> "%LOG%" echo %DATE% %TIME% portable-update start',
    'set /a waited=0',
    ':wait_pid',
    'tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul',
    'if errorlevel 1 goto pid_gone',
    'if %waited% GEQ %MAX_WAIT% (',
    '  >> "%LOG%" echo timeout waiting for pid %PID%',
    '  goto fail_keep_old',
    ')',
    'ping 127.0.0.1 -n 2 >nul',
    'set /a waited+=1',
    'goto wait_pid',
    ':pid_gone',
    'if not exist "%NEW%" (',
    '  >> "%LOG%" echo new file missing',
    '  goto fail_keep_old',
    ')',
    'for %%I in ("%TARGET%") do (',
    '  set "TARGET_DIR=%%~dpI"',
    '  set "TARGET_NAME=%%~nxI"',
    ')',
    'set "BACKUP=%TARGET_DIR%%TARGET_NAME%.bak"',
    'set "STAGED=%TARGET_DIR%%TARGET_NAME%.new"',
    'if exist "%STAGED%\\" rd /s /q "%STAGED%"',
    'if exist "%STAGED%" del /f /q "%STAGED%" >nul 2>nul',
    'copy /y "%NEW%" "%STAGED%" >nul',
    'if errorlevel 1 (',
    '  >> "%LOG%" echo stage copy failed',
    '  goto fail_keep_old',
    ')',
    'if exist "%STAGED%\\" (',
    '  >> "%LOG%" echo staged path is a directory',
    '  rd /s /q "%STAGED%"',
    '  goto fail_keep_old',
    ')',
    'set /a waited=0',
    ':backup_old',
    'if exist "%BACKUP%" del /f /q "%BACKUP%" >nul 2>nul',
    'if exist "%TARGET%" ren "%TARGET%" "%TARGET_NAME%.bak"',
    'if exist "%BACKUP%" if not exist "%TARGET%" goto old_backed_up',
    'if %waited% GEQ 60 (',
    '  >> "%LOG%" echo backup rename failed',
    '  del /f /q "%STAGED%" >nul 2>nul',
    '  goto fail_keep_old',
    ')',
    'ping 127.0.0.1 -n 2 >nul',
    'set /a waited+=1',
    'goto backup_old',
    ':old_backed_up',
    'if defined DSH_UPDATE_TEST_PAUSE ping 127.0.0.1 -n 2 >nul',
    'move /y "%STAGED%" "%TARGET%" >nul',
    'if errorlevel 1 goto restore',
    'if not exist "%TARGET%" goto restore',
    'if not defined DSH_UPDATE_TEST_SKIP_START start "" "%TARGET%"',
    'if errorlevel 1 goto restore',
    '>> "%LOG%" echo replaced ok, backup at %BACKUP%',
    'goto self_delete',
    ':restore',
    '>> "%LOG%" echo restore old version',
    'if exist "%TARGET%" del /f /q "%TARGET%" >nul 2>nul',
    'if exist "%STAGED%" del /f /q "%STAGED%" >nul 2>nul',
    'if exist "%BACKUP%" move /y "%BACKUP%" "%TARGET%" >nul',
    'if not defined DSH_UPDATE_TEST_SKIP_START if exist "%TARGET%" start "" "%TARGET%"',
    'goto self_delete',
    ':fail_keep_old',
    '>> "%LOG%" echo keep old version',
    'if exist "%STAGED%" del /f /q "%STAGED%" >nul 2>nul',
    'if not defined DSH_UPDATE_TEST_SKIP_START if exist "%TARGET%" start "" "%TARGET%"',
    'goto self_delete',
    ':self_delete',
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n')
}
