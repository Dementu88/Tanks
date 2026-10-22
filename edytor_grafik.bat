@echo off
rem Edytor grafik: arkusz od czata (wiersze LV1-LV5, kolumny = klatki) -> pliki gry w public\grafiki.
rem Mozna przeciagnac obrazek na ten plik albo wkleic go w programie (Ctrl+V).
cd /d "%~dp0"
start "" pythonw "%~dp0narzedzia\arkusze\edytor_grafik.py" %*
