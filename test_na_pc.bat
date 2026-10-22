@echo off
rem Szybki test na PC: buduje gre, restartuje lokalny serwer i otwiera TV + pad obok siebie.
rem   test_na_pc.bat -BezBudowania   bez budowania (gdy kod sie nie zmienil)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0narzedzia\test_na_pc.ps1" %*
pause
