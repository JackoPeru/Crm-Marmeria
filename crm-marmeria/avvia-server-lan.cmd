@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "ROOT=%~dp0"
set "PORT=3001"

if /i "%~1"=="--serve" goto serve
if /i "%~1"=="--check" goto check
if /i "%~1"=="--addresses-check" goto addresses_check
if /i "%~1"=="--elevated" goto bootstrap

rem L'installazione di programmi e la regola firewall richiedono privilegi elevati.
net session >nul 2>&1
if not errorlevel 1 goto bootstrap

echo Richiedo autorizzazione amministratore per preparare questo PC...
set "CRM_ELEVATED_ARGUMENTS=/d /c ""%~f0"" --elevated"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$process = Start-Process -FilePath $env:ComSpec -Verb RunAs -Wait -PassThru -ArgumentList $env:CRM_ELEVATED_ARGUMENTS; exit $process.ExitCode"
set "ELEVATION_EXIT=%ERRORLEVEL%"
if not "%ELEVATION_EXIT%"=="0" (
  echo [ERRORE] Autorizzazione amministratore annullata.
  pause
)
exit /b %ELEVATION_EXIT%

:bootstrap
cd /d "%ROOT%"
call :port_status
if %ERRORLEVEL% EQU 0 goto already_running
if %ERRORLEVEL% EQU 2 goto port_used

call :ensure_winget
if errorlevel 1 goto failed

call :find_node
if not defined NODE_EXE (
  call :install_with_winget OpenJS.NodeJS.LTS "Node.js LTS e npm"
  if errorlevel 1 goto failed
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  call :find_node
)
if not defined NODE_EXE (
  echo [ERRORE] Node.js non trovato dopo installazione.
  goto failed
)
if not defined NPM_CMD (
  echo [ERRORE] npm non trovato dopo installazione Node.js.
  goto failed
)

where git.exe >nul 2>&1
if errorlevel 1 (
  call :install_with_winget Git.Git "Git per aggiornamenti server"
  if errorlevel 1 goto failed
  set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
)
where git.exe >nul 2>&1
if errorlevel 1 (
  echo [ERRORE] Git non trovato dopo installazione.
  goto failed
)

if not exist "verifica-dipendenze.cjs" (
  echo [ERRORE] File verifica-dipendenze.cjs mancante.
  goto failed
)
echo Verifico dipendenze applicazione...
call "%NODE_EXE%" verifica-dipendenze.cjs
if errorlevel 1 goto failed

if not exist "dist\index.html" (
  echo Compilo interfaccia web...
  call "%NPM_CMD%" run build
  if errorlevel 1 goto failed
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-NetFirewallRule -DisplayName 'CRM Marmeria LAN' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName 'CRM Marmeria LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort %PORT% -Profile Private | Out-Null }"
if errorlevel 1 (
  echo [ERRORE] Impossibile aprire porta %PORT% nel firewall.
  goto failed
)

start "CRM Marmeria server" /min "%ComSpec%" /d /c ""%~f0" --serve"
timeout /t 2 /nobreak >nul
goto show_address

:serve
cd /d "%ROOT%"
call :find_node
if not defined NODE_EXE exit /b 1
if not defined NPM_CMD exit /b 1
call :set_server_environment

:serve_loop
call :port_status
if %ERRORLEVEL% EQU 0 exit /b 0
if %ERRORLEVEL% EQU 2 exit /b 1
if exist ".crm-update-pending" (
  echo Aggiornamento trovato. Verifico dipendenze...
  call "%NODE_EXE%" verifica-dipendenze.cjs
  if errorlevel 1 goto serve_retry
  del ".crm-update-pending"
)
call "%NODE_EXE%" server\index.js
call :port_status
if %ERRORLEVEL% EQU 0 exit /b 0
if %ERRORLEVEL% EQU 2 exit /b 1

:serve_retry
timeout /t 2 /nobreak >nul
goto serve_loop

:check
cd /d "%ROOT%"
call :find_node
if not defined NODE_EXE exit /b 1
if not defined NPM_CMD exit /b 1
echo [OK] node.exe: %NODE_EXE%
echo [OK] npm.cmd: %NPM_CMD%
exit /b 0

:ensure_winget
call :find_winget
if defined WINGET_EXE exit /b 0
echo WinGet non trovato. Installo Windows Package Manager...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; if ([Environment]::OSVersion.Version.Build -lt 17763) { throw 'Serve Windows 10 1809 o successivo.' }; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; Install-PackageProvider -Name NuGet -Force | Out-Null; Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery -Scope AllUsers -AllowClobber | Out-Null; Import-Module Microsoft.WinGet.Client -Force; Repair-WinGetPackageManager -AllUsers"
if errorlevel 1 exit /b 1
set "PATH=%LOCALAPPDATA%\Microsoft\WindowsApps;%PATH%"
call :find_winget
if not defined WINGET_EXE exit /b 1
exit /b 0

:find_winget
set "WINGET_EXE="
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$command = Get-Command winget.exe -ErrorAction SilentlyContinue; if ($command) { $command.Source } else { $package = Get-AppxPackage -AllUsers -Name Microsoft.DesktopAppInstaller -ErrorAction SilentlyContinue ^| Sort-Object Version -Descending ^| Select-Object -First 1; if ($package) { $candidate = Join-Path $package.InstallLocation 'winget.exe'; if (Test-Path $candidate) { $candidate } } }"`) do set "WINGET_EXE=%%I"
exit /b 0

:install_with_winget
echo Installo %~2...
"%WINGET_EXE%" install --id %~1 --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
exit /b %ERRORLEVEL%

:find_node
set "NODE_EXE="
set "NPM_CMD="
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%~fI"
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%~fI"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NPM_CMD if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NPM_CMD if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles(x86)%\nodejs\npm.cmd"
exit /b 0

:set_server_environment
set "CRM_WEB_ROOT=%ROOT%dist"
set "CRM_WEB_ORIGINS="
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -Unique"`) do (
  if defined CRM_WEB_ORIGINS (set "CRM_WEB_ORIGINS=!CRM_WEB_ORIGINS!,http://%%I:%PORT%") else set "CRM_WEB_ORIGINS=http://%%I:%PORT%"
)
set "CRM_SIMPLE_DEFAULT_ADMIN=1"
exit /b 0

:port_status
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$connection = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $connection) { exit 1 }; $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $connection.OwningProcess) -ErrorAction SilentlyContinue; if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -match 'index\.js') { exit 0 }; exit 2"
exit /b %ERRORLEVEL%

:show_address
echo.
echo CRM pronto. Apri da telefono o browser:
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -Unique"`) do echo   http://%%I:%PORT%
echo Login iniziale: admin / marmo2026!
echo Puoi chiudere questa finestra: server resta attivo.
pause
exit /b 0

:addresses_check
for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -Unique"`) do echo [OK] LAN IPv4: %%I
exit /b 0

:already_running
echo CRM gia attivo sulla porta %PORT%.
goto show_address

:port_used
echo [ERRORE] Porta %PORT% usata da altro programma. Chiudilo, poi riapri questo file.
goto failed

:failed
echo.
echo Avvio non completato. Correggi errore mostrato, poi riapri avvia-server-lan.cmd.
pause
exit /b 1
