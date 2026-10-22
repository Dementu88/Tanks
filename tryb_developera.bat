@echo off
rem Tryb developera: gra (klawiatura / pad) + panel statystyk LV1-LV5, sztuczek i podgladu animacji.
rem   tryb_developera.bat -BezBudowania   bez budowania (gdy kod sie nie zmienil)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0narzedzia\test_na_pc.ps1" -Strona dev %*
pause
