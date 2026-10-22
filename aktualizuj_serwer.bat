@echo off
rem Serwer gry na Mikrusie: menu (aktualizacja, wlacz/wylacz gre, stan).
rem Bez menu:  -BezTestow  -TylkoPaczka  -Online  -Offline  -Status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0narzedzia\aktualizuj_serwer.ps1" %*
pause
