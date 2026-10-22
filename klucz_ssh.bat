@echo off
rem Tworzy klucz SSH (jesli brak) i kopiuje klucz publiczny do schowka - do wklejenia czatowi.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0narzedzia\klucz_ssh.ps1"
pause
