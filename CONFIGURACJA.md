# Gdzie zmieniać ustawienia gry

Edytuj pliki w `C:\ZombieTanks\config`. Po zmianie uruchom
`uruchom_lokalnie_stable.bat`, a dla serwera `aktualizuj_serwer.bat` → Aktualizuj grę.
Sam zapis JSON nie zmienia już uruchomionej wersji produkcyjnej.

| Plik | Co ustawia |
| --- | --- |
| `config/rozgrywka.json` | startowy poziom czołgu, długość tarcz, początkowe poziomy i limit XP, koszty oraz premie |
| `config/czolgi.json` | statystyki czołgów LV1–LV5: ruch, pociski, odstęp strzałów, siła i skala grafiki |
| `config/gra.json` | poziomy trudności, życia, liczba i tempo wrogów, szerokość map |
| `config/sterowanie.json` | zapisany profil poligonu, razem z podglądem poziomu czołgu i XP; nie zmienia domyślnych poziomów zwykłej gry |

## Start, tarcze i XP — `config/rozgrywka.json`

| Pole | Domyślnie | Znaczenie / zakres |
| --- | --- | --- |
| `playerStartRank` | `1` | poziom po nowym starcie i odrodzeniu, 1–5; przejście mapy zachowuje zdobyty poziom |
| `playerSpawnShieldMs` | `2250` | tarcza gracza po animacji pojawiania się, 0–60000 ms |
| `enemySpawnShieldMs` | `3000` | tarcza wroga po animacji pojawiania się, 0–60000 ms |
| `bonusShieldMs` | `10500` | czas tarczy z bonusu, 0–60000 ms |
| `xp.enabled` | `false` | czy nowa sesja domyślnie włącza XP |
| `xp.maxLevel` | `3` | maksymalny poziom każdej cechy XP, 1–10 |
| `xp.startLevels.speed/fire/armor` | `0` | początkowe ulepszenia nowej sesji, 0–maxLevel |
| `xp.costs.speed/fire/armor` | `10000/10000/15000` | cena LV1, 1–1000000 XP; zakup poziomu N kosztuje N × tę cenę |
| `xp.killRewards.basic` | `100` | XP za zwykłego wroga, 0–1000000 |
| `xp.killRewards.fast` | `200` | XP za szybkiego wroga, 0–1000000 |
| `xp.killRewards.power` | `300` | XP za wroga z mocnym działem, 0–1000000 |
| `xp.killRewards.armor` | `400` | XP za opancerzonego wroga, 0–1000000 |
| `xp.speedPercent` | `10` | dodatkowa szybkość na poziom, 5–50% |
| `xp.firePercent` | `15` | dodatkowa szybkostrzelność na poziom, 5–50%; odstęp strzałów dzielony przez mnożnik |
| `xp.armorHp` | `1` | dodatkowe HP na poziom, 1–3 |
| `xp.costs.bullet/shield` | `8000/12000` | cena LV1 dwóch nowszych cech; brak w pliku = te wartości |
| `xp.startLevels.bullet/shield` | `0` | początkowe poziomy nowszych cech, 0–maxLevel |
| `xp.bulletPercent` | `20` | **Szybsze pociski**: dodatkowa prędkość pocisków na poziom, 5–50% |
| `xp.shieldMs` | `1500` | **Dłuższa tarcza**: dodatkowa tarcza po odrodzeniu na poziom, 250–5000 ms |

Przykład: `playerStartRank: 2`, `enemySpawnShieldMs: 4000`, `xp.enabled: true`
i `xp.startLevels.armor: 1` daje start czołgiem LV2, czterosekundowe tarcze
wrogów oraz jeden poziom pancerza XP dla drużyny. Pozostałe pola zachowaj.
1000 ms = 1 sekunda. JSON używa kropek dziesiętnych, bez komentarzy i przecinka po ostatnim polu.

Ustawienia XP z lobby zmieniają tylko bieżącą sesję. Nie zapisują się do tego pliku.
Nagrody `killRewards` trafiają do wspólnej puli raz za zniszczenie czołgu,
zarówno pociskiem, jak i granatem. Nie zmieniają zwykłych punktów wyniku gry.
Wartość 0 wyłącza nagrodę za dany typ. XP nalicza się tylko przy `xp.enabled: true`
lub po włączeniu przycisku „XP na tę sesję” w lobby przed startem.
Przykład: `costs.armor: 15000` i `killRewards.armor: 500` oznacza,
że 30 zniszczonych opancerzonych wrogów wystarczy na pierwszy poziom wytrzymałości.
Restart rozgrywki zachowuje XP; restart procesu serwera przywraca ustawienia
oraz poziomy startowe z konfiguracji i zeruje zdobyte punkty.

## Co trafia przy aktualizacji na serwer

Aktualizator buduje `www/` i `dist-server/main.js`. Pliki `rozgrywka.json`
i `gra.json` są **wbudowane w wynik budowania** — nowa paczka zawiera ich wartości.
Nie trzeba kopiować ich ręcznie przez SSH. Zmiana wymaga zbudowania i wdrożenia
nowej paczki; później odśwież PC/TV i telefony.
Budowanie sprawdza ustawienia, a konsola pokazuje poziom startowy, limit XP
i długość tarczy wroga.

`czolgi.json` również daje wartości wbudowane, ale istniejący plik
`config/czolgi.json` obok uruchomionego serwera ma pierwszeństwo przy starcie.
Nie nadpisujemy takiego pliku aktualizacją. Lokalnie można go edytować w `#/dev`
przez „Zapisz do pliku”. `sterowanie.json` pozostaje osobnym zapisem poligonu.

## Test bez zmieniania gry

Otwórz `#/poligon` → Ustawienia → „Poziom czołgu i XP — podgląd”.
Cztery suwaki zmieniają czołg od razu, bez zdobywania ani wydawania XP z serwera.
Pod planszą widać faktyczną prędkość, HP, odstęp strzałów i limit pocisków.
„Trafienie −1 HP” testuje pancerz do minimum 1 HP, „Napraw pancerz” go uzupełnia.
Poligon nadal ma zero wrogów i brak tarczy startowej.

„Zapisz” zachowuje również suwaki podglądu: w przeglądarce, a przy połączonym
telefonie w `config/sterowanie.json` na PC. „Wczytaj zapisane” je odtwarza.
