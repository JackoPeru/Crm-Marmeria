@echo off
setlocal EnableExtensions

rem Compatibilita per installazioni precedenti: il bootstrap attuale gestisce
rem dipendenze, TLS, indirizzi LAN e riavvio dopo aggiornamento.
call "%~dp0avvia-server-lan.cmd" %*
exit /b %ERRORLEVEL%
