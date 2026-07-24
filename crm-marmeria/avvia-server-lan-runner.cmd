@echo off
setlocal
cd /d "%~dp0"

rem Questo file e un runner interno. Se viene avviato direttamente,
rem inoltra sempre al bootstrap completo che installa e verifica i prerequisiti.
if /i not "%CRM_LAUNCHER_READY%"=="1" (
  echo Avvio controllo e installazione prerequisiti...
  start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvia-server-lan.ps1"
  exit /b 0
)

set "NODE_EXE="
set "NPM_CMD="

for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%~fI"
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%~fI"

if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NPM_CMD if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NPM_CMD if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles(x86)%\nodejs\npm.cmd"

if not defined NODE_EXE (
  echo [ERRORE] node.exe non trovato dopo il controllo dei prerequisiti.
  echo Chiudi questa finestra e avvia avvia-server-lan.cmd.
  exit /b 1
)
if not defined NPM_CMD (
  echo [ERRORE] npm.cmd non trovato dopo il controllo dei prerequisiti.
  echo Chiudi questa finestra e avvia avvia-server-lan.cmd.
  exit /b 1
)

if /i "%~1"=="--check" (
  echo [OK] node.exe: %NODE_EXE%
  echo [OK] npm.cmd: %NPM_CMD%
  exit /b 0
)

:run
call :port_in_use
if not errorlevel 1 (
  echo CRM gia attivo sulla porta 3001. Chiudi questa finestra.
  exit /b 0
)
if exist ".crm-update-pending" (
  echo Aggiornamento trovato. Verifico le dipendenze...
  call "%NODE_EXE%" verifica-dipendenze.cjs
  if errorlevel 1 goto retry
  del ".crm-update-pending"
)
call "%NPM_CMD%" run server
call :port_in_use
if not errorlevel 1 (
  echo Porta 3001 occupata da un altro processo. Riavvio automatico annullato.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto run

:retry
echo Controllo o installazione dipendenze non riuscito. Riprovo tra 5 secondi...
timeout /t 5 /nobreak >nul
goto run

:port_in_use
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 }; exit 1"
exit /b %ERRORLEVEL%
