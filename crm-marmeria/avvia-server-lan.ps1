param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$port = 3001
$script:WingetExe = $null

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WinGetExecutable {
  $command = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $package = Get-AppxPackage -AllUsers -Name Microsoft.DesktopAppInstaller -ErrorAction SilentlyContinue |
    Sort-Object Version -Descending |
    Select-Object -First 1
  if ($package) {
    $candidate = Join-Path $package.InstallLocation 'winget.exe'
    if (Test-Path $candidate) { return $candidate }
  }

  return $null
}

function Test-WinGetExecutable {
  param([string]$Executable)

  if (-not $Executable -or -not (Test-Path $Executable)) { return $false }
  try {
    & $Executable --version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Ensure-WinGet {
  $existing = Get-WinGetExecutable
  if (Test-WinGetExecutable $existing) {
    $script:WingetExe = $existing
    Write-Host '[OK] WinGet disponibile.'
    return
  }

  $windowsBuild = [Environment]::OSVersion.Version.Build
  if ($windowsBuild -lt 17763) {
    throw 'WinGet richiede Windows 10 versione 1809 (build 17763) o successiva.'
  }

  Write-Host 'WinGet non trovato. Installo Windows Package Manager...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  Install-PackageProvider -Name NuGet -Force | Out-Null
  Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery -Scope AllUsers -AllowClobber | Out-Null
  Import-Module Microsoft.WinGet.Client -Force
  Repair-WinGetPackageManager -AllUsers

  $windowsApps = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
  if ((Test-Path $windowsApps) -and ($env:Path -notlike "*$windowsApps*")) {
    $env:Path = "$windowsApps;$env:Path"
  }

  $installed = Get-WinGetExecutable
  if (-not (Test-WinGetExecutable $installed)) {
    throw 'Installazione di WinGet non riuscita. Verifica la connessione Internet e Windows Update.'
  }

  $script:WingetExe = $installed
  Write-Host '[OK] WinGet installato e verificato.' -ForegroundColor Green
}

function Install-WithWinGet {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Write-Host "Installo $Label..."
  & $script:WingetExe install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) {
    throw "Installazione di $Label non riuscita tramite WinGet."
  }
}

if (-not (Test-Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  exit
}

# WinGet deve essere disponibile prima di qualunque altro prerequisito.
Ensure-WinGet

Set-Location $root

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  Install-WithWinGet -Id 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS e npm'
  $env:Path = "C:\Program Files\nodejs;$env:Path"
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js non trovato dopo l installazione.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm non trovato dopo l installazione di Node.js.' }

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
  Install-WithWinGet -Id 'Git.Git' -Label 'Git per gli aggiornamenti del server'
  $env:Path = "C:\Program Files\Git\cmd;$env:Path"
}
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Git non trovato dopo l installazione.' }

$dependencyCheck = Join-Path $root 'verifica-dipendenze.cjs'
if (-not (Test-Path $dependencyCheck)) { throw 'File verifica-dipendenze.cjs non trovato.' }
& node.exe $dependencyCheck
if ($LASTEXITCODE -ne 0) { throw 'Controllo o installazione delle dipendenze non riuscito.' }

if (-not (Test-Path 'dist\index.html')) {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build dell interfaccia web non riuscita.' }
}

if (-not (Get-NetFirewallRule -DisplayName 'CRM Marmeria LAN' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'CRM Marmeria LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
}

$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
  Select-Object -ExpandProperty IPAddress -Unique)
$env:CRM_WEB_ROOT = (Join-Path $root 'dist')
$env:CRM_WEB_ORIGINS = (($addresses | ForEach-Object { "http://$($_):$port" }) -join ',')
$env:CRM_DISABLE_TLS = '1'
$env:CRM_SIMPLE_DEFAULT_ADMIN = '1'
$env:CRM_LAUNCHER_READY = '1'

$runners = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'avvia-server-lan-runner\.cmd' })
foreach ($runner in $runners) {
  taskkill.exe /PID $runner.ProcessId /T /F | Out-Null
}
if ($runners.Count) { Start-Sleep -Milliseconds 500 }
$existingPids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($existingPid in $existingPids) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid"
  if (-not $process) { continue }
  if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'index\.js') {
    throw "La porta $port e usata da un altro programma. Chiudilo, poi riapri questo file."
  }
  Stop-Process -Id $existingPid -Force
}
Start-Process cmd.exe -WorkingDirectory $root -WindowStyle Hidden -ArgumentList '/d', '/c', 'avvia-server-lan-runner.cmd' | Out-Null

Write-Host ''
Write-Host 'CRM pronto. Apri da telefono o browser:' -ForegroundColor Green
if ($addresses.Count) { $addresses | ForEach-Object { Write-Host "  http://$($_):$port" } } else { Write-Host "  http://IP-DEL-PC:$port" }
Write-Host 'Login: admin / marmo2026!' -ForegroundColor Yellow
