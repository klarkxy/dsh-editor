// A separate Windows PowerShell process owns the transaction after Electron exits.
// Paths are JSON data, not cmd.exe source: spaces, Unicode, %, !, & and parentheses
// must never change the meaning of an update command.
export interface WindowsUpdatePlan {
  mode: 'portable' | 'setup'
  parentPid: number
  source: string
  target: string
  size: number
  digest: string
  directory: string
  nonce: string
  waitMs?: number
  /** Disable native recovery dialogs in unattended integration tests. */
  interactive?: boolean
}

export function buildWindowsUpdateScript(plan: WindowsUpdatePlan): string {
  if (!Number.isSafeInteger(plan.parentPid) || plan.parentPid <= 0) throw new Error('Invalid update parent PID')
  if (!Number.isSafeInteger(plan.size) || plan.size <= 0) throw new Error('Invalid update size')
  if (!/^[a-f0-9]{64}$/i.test(plan.digest)) throw new Error('Invalid update digest')
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(plan.nonce)) throw new Error('Invalid update nonce')
  if (plan.mode !== 'portable' && plan.mode !== 'setup') throw new Error('Invalid update mode')
  for (const path of [plan.source, plan.target, plan.directory]) {
    if (!path || /[\0\r\n]/.test(path)) throw new Error('Invalid update path')
  }
  const waitMs = plan.waitMs ?? 120_000
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 600_000) throw new Error('Invalid update deadline')
  const data = Buffer.from(JSON.stringify({ ...plan, waitMs, interactive: plan.interactive ?? true }), 'utf8').toString('base64')
  // UTF-8 BOM is required for Windows PowerShell 5.1 to read diagnostic text.
  return '\uFEFF' + String.raw`$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$plan = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$status = [IO.Path]::Combine($plan.directory, 'status.json')
$log = [IO.Path]::Combine($plan.directory, 'install.log')
$commit = [IO.Path]::Combine($plan.directory, 'commit')
$cancel = [IO.Path]::Combine($plan.directory, 'cancel')
$targetDir = [IO.Path]::GetDirectoryName($plan.target)
$stage = [IO.Path]::Combine($targetDir, '.dsh-update-' + $plan.nonce + '.new')
$backup = $plan.target + '.bak-' + $plan.nonce
$staged = $false
$backedUp = $false
$swapped = $false
$committed = $false
$parentExited = $false
$exitCode = 1
function Log([string]$message) {
  [IO.File]::AppendAllText($log, ([DateTime]::UtcNow.ToString('o') + ' ' + $message + [Environment]::NewLine))
}
function State([string]$phase, [string]$message = '') {
  $text = @{ nonce = $plan.nonce; phase = $phase; message = $message; backup = $backup } | ConvertTo-Json -Compress
  $temp = $status + '.tmp'
  [IO.File]::WriteAllText($temp, $text, (New-Object Text.UTF8Encoding($false)))
  if ([IO.File]::Exists($status)) { [IO.File]::Replace($temp, $status, [NullString]::Value) }
  else { [IO.File]::Move($temp, $status) }
  Log ($phase + ': ' + $message)
}
function Verify([string]$path) {
  $file = Get-Item -LiteralPath $path -Force
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Update is not a regular file' }
  if ($file.Length -ne $plan.size) { throw 'Update size mismatch' }
  # Use the framework directly; PSModulePath may come from PowerShell 7.
  $stream = [IO.File]::OpenRead($path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
  finally { $algorithm.Dispose(); $stream.Dispose() }
  if ($hash -ne $plan.digest) { throw 'Update SHA-256 mismatch' }
}
function Cancelled {
  if ([IO.File]::Exists($cancel)) { throw 'Update cancelled before installation' }
}
try {
  $parent = [Diagnostics.Process]::GetProcessById($plan.parentPid)
  # Open a handle now, so PID reuse cannot make us wait for an unrelated process.
  $null = $parent.Handle
  Verify $plan.source
  if (-not [IO.File]::Exists($plan.target)) { throw 'Current application is missing' }
  $current = Get-Item -LiteralPath $plan.target -Force
  if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Current application must not be a reparse point' }
  if ($plan.mode -eq 'portable') {
    if ([IO.File]::Exists($stage) -or [IO.Directory]::Exists($stage) -or [IO.File]::Exists($backup) -or [IO.Directory]::Exists($backup)) {
      throw 'Update staging or backup path already exists; nothing was removed'
    }
    # Copy without overwrite. A permission/disk-space error happens before quit.
    $inputFile = [IO.File]::OpenRead($plan.source)
    try {
      $outputFile = [IO.File]::Open($stage, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $staged = $true
      try { $inputFile.CopyTo($outputFile) } finally { $outputFile.Dispose() }
    } finally { $inputFile.Dispose() }
    Verify $stage
  }
  Cancelled
  State 'ready'
  $deadline = [DateTime]::UtcNow.AddMilliseconds($plan.waitMs)
  while (-not [IO.File]::Exists($commit)) {
    Cancelled
    # Commit is published before parent exit. Recheck after observing exit: the
    # file may have appeared since the loop condition was evaluated.
    if (($parent.HasExited -or [DateTime]::UtcNow -ge $deadline) -and -not [IO.File]::Exists($commit)) { throw 'Update was not committed by the application' }
    Start-Sleep -Milliseconds 100
  }
  if ([IO.File]::ReadAllText($commit) -ne $plan.nonce) { throw 'Invalid update commit token' }
  $committed = $true
  if (-not $parent.WaitForExit($plan.waitMs)) { throw 'Application did not exit; the old version was left in place' }
  $parentExited = $true
  Cancelled
  State 'installing'
  # Do not leak Electron's/portable launcher's special mode into the next app.
  foreach ($key in @('ELECTRON_RUN_AS_NODE', 'PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_APP_FILENAME')) {
    [Environment]::SetEnvironmentVariable($key, $null, 'Process')
  }
  if ($plan.mode -eq 'portable') {
    Verify $stage
    # Both renames are in the destination directory. Never delete the live app
    # first, and never overwrite or recursively remove an existing backup.
    $renameDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while ($true) {
      Cancelled
      try { [IO.File]::Move($plan.target, $backup); break }
      catch {
        if ([IO.File]::Exists($backup) -or [IO.Directory]::Exists($backup) -or [DateTime]::UtcNow -ge $renameDeadline) { throw }
        Start-Sleep -Milliseconds 500
      }
    }
    $backedUp = $true
    [IO.File]::Move($stage, $plan.target)
    $staged = $false
    $swapped = $true
    Verify $plan.target
    $next = Start-Process -FilePath $plan.target -WorkingDirectory $targetDir -PassThru
    if ($next.WaitForExit(1000) -and $next.ExitCode -ne 0) { throw ('New application exited with code ' + $next.ExitCode) }
    State 'launched' ('Backup retained at ' + $backup)
  } else {
    Verify $plan.source
    # NSIS /D must be the final, unquoted command-line argument, including spaces.
    # Start-Process uses Windows shell execution and reports UAC cancellation.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $plan.source
    $start.Arguments = '/D=' + $targetDir
    $start.UseShellExecute = $true
    $installer = [Diagnostics.Process]::Start($start)
    $installer.WaitForExit()
    if ($installer.ExitCode -ne 0 -and $installer.ExitCode -ne 3010) {
      throw ('Installer cancelled or failed, exit code ' + $installer.ExitCode)
    }
    State 'completed'
  }
  $exitCode = 0
} catch {
  $message = $_.Exception.Message
  if ($backedUp) {
    try {
      # Only remove the replacement that this transaction actually installed.
      if ($swapped -and [IO.File]::Exists($plan.target)) { Verify $plan.target; [IO.File]::Delete($plan.target) }
      [IO.File]::Move($backup, $plan.target)
      $backedUp = $false
      Log 'Old version restored'
    } catch { $message += '; rollback: ' + $_.Exception.Message + '; backup: ' + $backup }
  }
  try { State 'failed' $message } catch { }
  if ($committed -and $parentExited -and $plan.interactive -ne $false) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      $text = "更新未完成。旧程序或备份已保留。" + [Environment]::NewLine + $message + [Environment]::NewLine + "安装包: " + $plan.source + [Environment]::NewLine + "日志: " + $log
      $null = [Windows.Forms.MessageBox]::Show($text, 'DSH Editor 更新', 'OK', 'Error')
      Start-Process -FilePath ([IO.Path]::GetDirectoryName($plan.source))
      if ([IO.File]::Exists($plan.target)) { Start-Process -FilePath $plan.target -WorkingDirectory $targetDir }
    } catch { try { Log $_.Exception.Message } catch { } }
  }
} finally {
  if ($staged) { try { [IO.File]::Delete($stage) } catch { } }
}
exit $exitCode
`
}
