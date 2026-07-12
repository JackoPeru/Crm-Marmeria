@echo off
setlocal
cd /d "%~dp0"
:run
if exist ".crm-update-pending" (
  echo Aggiornamento trovato. Installo dipendenze...
  call npm.cmd ci --ignore-scripts
  if errorlevel 1 goto retry
  call npm.cmd ci --prefix server
  if errorlevel 1 goto retry
  del ".crm-update-pending"
)
call npm.cmd run server
timeout /t 2 /nobreak >nul
goto run

:retry
echo Installazione aggiornamento non riuscita. Riprovo tra 5 secondi...
timeout /t 5 /nobreak >nul
goto run
