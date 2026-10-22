@echo off
rem Lokalny poligon: bez serwera gry, otwierany rowniez na telefonie przez Wi-Fi.
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.local\bin;%PATH%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0narzedzia\poligon.ps1" %*
if errorlevel 1 pause
