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

function Get-NodeCommand {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  $candidate = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path $candidate) {
    $env:Path = "$(Split-Path $candidate);$env:Path"
    return $candidate
  }
  Write-Host 'Installo Node.js LTS...'
  winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  if (-not (Test-Path $candidate)) { throw 'Node.js non installato. Riavvia questo file.' }
  $env:Path = "$(Split-Path $candidate);$env:Path"
  return $candidate
}

function Get-LanAddresses {
  @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' } |
    Select-Object -ExpandProperty IPAddress -Unique)
}

Set-Location $root
$null = Get-NodeCommand

if (-not (Test-Path (Join-Path $root 'node_modules\vite'))) {
  Write-Host 'Installo dipendenze applicazione...'
  npm.cmd ci --ignore-scripts
}
if (-not (Test-Path (Join-Path $root 'server\node_modules\better-sqlite3'))) {
  Write-Host 'Installo dipendenze server...'
  npm.cmd ci --prefix server
}

$distIndex = Join-Path $root 'dist\index.html'
$latestSource = Get-ChildItem (Join-Path $root 'src') -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $distIndex) -or ($latestSource -and $latestSource.LastWriteTime -gt (Get-Item $distIndex).LastWriteTime)) {
  Write-Host 'Creo interfaccia web...'
  npm.cmd run build
}

if (-not (Get-NetFirewallRule -DisplayName 'CRM Marmeria LAN HTTPS' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'CRM Marmeria LAN HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
}

$addresses = Get-LanAddresses
$env:CRM_WEB_ROOT = (Join-Path $root 'dist')
$env:CRM_WEB_ORIGINS = (($addresses | ForEach-Object { "https://$($_):$port" }) -join ',')

$serverActive = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet
if (-not $serverActive) {
  $usersPath = Join-Path $root 'server\data\users.json'
  $setupRequired = $true
  if (Test-Path $usersPath) {
    try {
      $setupRequired = -not @((Get-Content $usersPath -Raw | ConvertFrom-Json) | Where-Object { $_.role -eq 'admin' -and $_.isActive }).Count
    } catch { $setupRequired = $true }
  }
  Start-Process cmd.exe -ArgumentList '/d', '/k', "cd /d `"$root`" && npm.cmd run server" | Out-Null
  if ($setupRequired) {
    Write-Host 'Configura ora primo amministratore del CRM.' -ForegroundColor Yellow
    $firstName = Read-Host 'Nome'
    $lastName = Read-Host 'Cognome'
    $email = Read-Host 'Email'
    $username = Read-Host 'Username'
    $securePassword = Read-Host 'Password (almeno 10 caratteri)' -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword))
    $env:CRM_FIRST_ADMIN_JSON = @{ firstName = $firstName; lastName = $lastName; email = $email; username = $username; password = $password } | ConvertTo-Json -Compress
    try { node.exe server\first-admin-cli.js } finally { Remove-Item Env:CRM_FIRST_ADMIN_JSON -ErrorAction SilentlyContinue }
  }
}

Write-Host ''
Write-Host 'Server CRM attivo. Apri da ogni dispositivo Wi-Fi:' -ForegroundColor Green
if ($addresses.Count) { $addresses | ForEach-Object { Write-Host "  https://$($_):$port" } } else { Write-Host "  https://IP-DEL-PC:$port" }
Write-Host 'Primo accesso browser: conferma certificato locale solo dopo confronto con impronta mostrata nella finestra server.' -ForegroundColor Yellow
