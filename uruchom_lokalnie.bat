@echo off
rem Budowanie z zainstalowanych narzedzi, bez zapytan pnpm do rejestru.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0narzedzia\test_na_pc.ps1" -Strona pc %*
if errorlevel 1 pause
