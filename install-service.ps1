# Registers the always-on server for this Windows account. It needs no admin rights.
#   Install or update:  powershell -ExecutionPolicy Bypass -File install-service.ps1
#   Remove:             powershell -ExecutionPolicy Bypass -File install-service.ps1 -Remove
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$taskName = 'Annotate Server'
$root = $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\pythonw.exe'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $taskName
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
if ($Remove) {
  "Removed $taskName. A server that is already running keeps going until you restart."
  return
}

if (-not (Test-Path $python)) { throw 'Run start.cmd once first, so the Python environment exists.' }

$action = New-ScheduledTaskAction -Execute $python -Argument "`"$root\service.pyw`"" -WorkingDirectory $root
$atLogin = New-ScheduledTaskTrigger -AtLogOn -User $account
# The supervisor restarts the server. This repeat brings the supervisor itself back if it stops.
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogin, $watchdog) `
  -Settings $settings -Principal $principal | Out-Null
Start-ScheduledTask -TaskName $taskName
"Installed $taskName. The tool stays on at http://localhost:3190"
