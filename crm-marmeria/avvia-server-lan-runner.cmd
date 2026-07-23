@echo off
setlocal
cd /d "%~dp0"
:run
call :port_in_use
if not errorlevel 1 (
  echo CRM gia attivo sulla porta 3001. Chiudi questa finestra.
  exit /b 0
)
if exist ".crm-update-pending" (
  echo Aggiornamento trovato. Installo dipendenze...
  call npm.cmd ci --ignore-scripts
  if errorlevel 1 goto retry
  call npm.cmd ci --prefix server
  if errorlevel 1 goto retry
  del ".crm-update-pending"
)
call npm.cmd run server
call :port_in_use
if not errorlevel 1 (
  echo Porta 3001 occupata da un altro processo. Riavvio automatico annullato.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto run

:retry
echo Installazione aggiornamento non riuscita. Riprovo tra 5 secondi...
timeout /t 5 /nobreak >nul
goto run

:port_in_use
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 }; exit 1"
exit /b %ERRORLEVEL%
