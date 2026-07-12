param()

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 3001

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  exit
}

Set-Location $root
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host 'Installo Node.js LTS...'
  winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  $env:Path = "C:\Program Files\nodejs;$env:Path"
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js non trovato. Riavvia questo file.' }

if (-not (Test-Path 'node_modules\vite')) { npm.cmd ci --ignore-scripts }
if (-not (Test-Path 'server\node_modules\better-sqlite3')) { npm.cmd ci --prefix server }
if (-not (Test-Path 'dist\index.html')) { npm.cmd run build }

if (-not (Get-NetFirewallRule -DisplayName 'CRM Marmeria LAN' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'CRM Marmeria LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
}

$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
  Select-Object -ExpandProperty IPAddress -Unique)
$env:CRM_WEB_ROOT = (Join-Path $root 'dist')
$env:CRM_WEB_ORIGINS = (($addresses | ForEach-Object { "https://$($_):$port" }) -join ',')
Remove-Item Env:CRM_DISABLE_TLS -ErrorAction SilentlyContinue
$env:CRM_SIMPLE_DEFAULT_ADMIN = '1'

$existingPids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($existingPid in $existingPids) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid"
  if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'index\.js') {
    throw "La porta $port e usata da un altro programma. Chiudilo, poi riapri questo file."
  }
  Stop-Process -Id $existingPid -Force
}
Start-Process npm.cmd -WorkingDirectory $root -WindowStyle Hidden -ArgumentList 'run', 'server' | Out-Null

Write-Host ''
Write-Host 'CRM pronto. Apri da telefono o browser:' -ForegroundColor Green
if ($addresses.Count) { $addresses | ForEach-Object { Write-Host "  https://$($_):$port" } } else { Write-Host "  https://IP-DEL-PC:$port" }
Write-Host 'Se Chrome apre HTTPS, scegli Avanzate e Continua: certificato locale del PC server.' -ForegroundColor DarkYellow
Write-Host 'Login: admin / marmo2026!' -ForegroundColor Yellow
