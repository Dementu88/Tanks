# Tryb party: TV jako ekrany, telefony jako pady

- `#/tv` (albo krótko `/tv`): ekran telewizora. Zakłada pokój z 4-cyfrowym kodem i pokazuje QR.
  Kolejne TV otwierają `#/tv/<kod>` i pokazują tę samą planszę. Dopisek `?mute` wycisza dźwięk,
  np. na drugim TV.
- `#/pad/<kod>`: pad na telefonie. Lewy okrąg to joystick, prawy to OGIEŃ, a pośrodku są START,
  plansza i pauza. Mieszczą się 2 pady; gra startuje z tyloma graczami, ilu jest podłączonych.
- Do **4 graczy** (żółty, zielony, niebieski, fioletowy). Gracze 3 i 4 startują w dolnym rzędzie
  w kolumnach 2 i 10 — plansza robi im tam miejsce. Trudność zależnie od liczby graczy:
  `config/gra.json` (1–2 graczy jak w oryginale, 3 → 30 wrogów, 4 → 40; więcej naraz na planszy;
  bonus na 4., 11., 18., 25. … wrogu) — `src/engine/difficulty.ts`.
- **Losowe plansze**: w lobby strzałka przed planszą 1 = „LOS” — cała gra na nowych, losowych
  planszach (R1, R2…; `src/engine/map/randomStage.ts`: symetryczne, twierdza orła jak w
  oryginale, wolne starty, zawsze przejezdne).
- Dźwięk: TV / PC same próbują go włączyć co sekundę — wystarczy dowolne kliknięcie albo klawisz.
- Jeden pokój na cały serwer (`MAX_ROOMS` w `server/party.ts`), do 4 ekranów i 12 połączeń.
- Rodzinny klucz: serwer z `PARTY_KEY` wpuszcza tylko z `?k=…` w adresie. Na TV otwierasz raz
  `<adres>/#/tv?k=<klucz>`, przeglądarka go zapamiętuje, a telefony dostają klucz z QR.
  Bez `PARTY_KEY` (lokalnie w domu) wpuszcza każdego.
- Gra liczy się na serwerze (`server/party.ts`, 60 Hz), a TV dostają klatki przez WebSocket `/party`.
  Telefony i TV same łączą się ponownie po zerwaniu połączenia.

## Jak grać (tryby)

| ekran | sterowanie | adres |
|---|---|---|
| telewizor | telefony (QR) | `#/tv` |
| telewizor | pad PS / Xbox podłączony do TV (jeśli przeglądarka TV obsługuje pady) | `#/tv` — naciśnij przycisk na padzie |
| telefon | pad PS / Xbox podłączony do telefonu (Bluetooth) | pad z QR, pad steruje zamiast dotyku |
| komputer | klawiatura i pady PS / Xbox, telefony opcjonalnie | `#/pc` (`uruchom_lokalnie.bat`) |

Pad: krzyżak = jazda, lewa gałka = obrót (małe wychylenie) lub jazda, ✕ / □ / R1 / R2 = ogień,
Options = start / pauza, L1 / △ = plansza, L2 / Share = poziom trudności. Gracze na ekranie to dla serwera zwykłe pady
(`src/party/localPad.ts`), mapowanie w `src/party/controls.ts`.

## Programy (dwuklik)

| plik | co robi |
|---|---|
| `uruchom_lokalnie.bat` | gra na tym PC (`#/pc`: klawiatura + pady); TV w domu: `http://<IP PC>:8090/tv` |
| `test_na_pc.bat` | szybki test: build, restart lokalnego serwera, otwiera `#/test` — TV i pad obok siebie, pad z klawiatury (`-BezBudowania`) |
| `aktualizuj_serwer.bat` | menu: aktualizacja serwera, włącz/wyłącz grę, stan (`-BezTestow`, `-TylkoPaczka`, `-Online`, `-Offline`, `-Status`) |
| `tryb_developera.bat` | `#/dev`: gra + panel (poziom LV1–LV5, statystyki z zapisem, nieśmiertelność, wrogowie, podgląd animacji) |
| `edytor_grafik.bat` | arkusz od czata → pliki gry: wykrywa czołgi, usuwa strzałki i napisy, siatka 32×32 → 64×64, podgląd 32/72 px i animacji, „Zapisz do gry” (`narzedzia/arkusze/`) |
| `klucz_ssh.bat` | tworzy klucz SSH i kopiuje publiczny do schowka (do wklejenia czatowi) |

Ustawienia serwera (host, port SSH, katalog) są na górze `narzedzia/aktualizuj_serwer.ps1`.
Przygotowanie serwera: `ZADANIE_battle_city_mikrus_dla_ChatGPT.md`, potem `ZADANIE_battle_city_uprawnienia_…` i `ZADANIE_battle_city_zabezpieczenia_…`.

## Komendy dla dewelopera

```bash
pnpm build:party        # www/ + dist-server/main.js (jeden plik, bez node_modules)
PORT=8090 pnpm party    # http://localhost:8090/tv
pnpm test               # w tym test/party.test.ts
```

Po przeniesieniu folderu odpal `CI=true pnpm install`: pnpm na Windows linkuje node_modules
ścieżkami bezwzględnymi.

## Gdzie co zmieniać

- wygląd lobby TV i padów: `src/party/TvScreen.tsx`, `src/party/PadScreen.tsx`, `src/party/party.css`
- zasady pokoju (sloty, start, pauza, wibracje): `server/party.ts`
- zdarzenia rozgrywki (podstawa profili, XP, osiągnięć): typy w `src/engine/events.ts`, emitowane
  przez `BattleScene` i `GameSession`; na serwerze odbiera je `onGameEvent` w `server/main.ts`.
  Gracz w zdarzeniach = identyfikator telefonu (`PlayerConfig.id`). Silnik od zdarzeń nie zależy,
  więc dopisywanie odbiorców nie zmienia rozgrywki (pilnuje tego `test/events.test.ts`).
- plansze: `src/stages/stage-*.json` (edytor w grze zapisuje plansze tylko w przeglądarce)

## Klawiatura (pad na PC, `#/test`)

Strzałki / WASD jazda, z Shift tylko obrót, spacja / J ogień, Enter start, P / Esc pauza, Q / E plansza, Z / X poziom trudności.

## Tryb developera i grafiki

- `#/dev` działa tylko z serwerem lokalnym (bez `PARTY_KEY`) albo z `PARTY_DEV=1`. Na Mikrusie,
  gdzie jest klucz, polecenia developera są ignorowane.
- Lewy panel: gra (start, restart, pauza, stop, plansza, tempo 0.25–2×), wrogowie (zniszcz,
  zamroź, bez nowych) i karty graczy (LV1–LV5, życie, nieśmiertelność, zniszcz czołg, bonusy).
  Prawy panel: statystyki i skala grafiki wybranego LV z podglądem na tle kratki oraz animacje.
- „Pokaż zaawansowane” (lewy panel): trasy i cele AI rysowane na planszy (`BattleScene.devDebug`,
  `src/engine/debug.ts`, rysowanie `Renderer.syncDebug`). Dane lecą w klatkach tylko po włączeniu
  i tylko w trybie developera.
- Statystyki czołgu gracza LV1–LV5: `config/czolgi.json` (moduł `src/engine/tankStats.ts`).
  Panel zmienia je na żywo, a „Zapisz do pliku” zapisuje je do tego pliku. Przy budowaniu plik
  trafia do gry, a lokalny serwer czyta go też przy starcie.
- Poziom LV1–LV5 to poziom czołgu w trakcie sesji: każda gwiazdka +1, a na LV5 premia punktowa.
  Wrogowie bez zmian.
- Grafiki wilczych czołgów są odłożone w `grafiki_odlozone/` (gra ma klasyczny wygląd). Żeby
  wróciły: przenieś katalog z powrotem jako `public/grafiki`.
- Grafiki z plików: `public/grafiki/…` według `ZADANIE_grafiki_czolgi_dla_ChatGPT.md`. Czego
  brakuje, rysujemy starym pixel artem. W trybie developera grafiki są czytane prosto z
  `public/`, więc po podmianie wystarczy odświeżyć stronę. Obecne pliki to tymczasowe wycinki z
  obrazka referencyjnego (`public/grafiki/TYMCZASOWE.txt`).
- Wczytywanie i animacja: `src/render/customSprites.ts`, rysowanie w `Renderer.syncTanks`.
  TV rysuje w wyższej rozdzielczości (`createApp(resolution)`), żeby szczegóły 64 px były widać.

## Poziom trudności

W lobby pierwszy podłączony gracz (zwykle Gracz 1) wybiera poziom: przycisk POZIOM na padzie,
Z / X na klawiaturze, L2 / Share na padzie PlayStation. Inni widzą tylko nazwę, TV pokazuje
poziom pod planszą. Poziomy są w `config/gra.json` → `poziomy` (Łatwy, Normalny, Trudny, Koszmar):
mnożnik liczby wrogów, ilu więcej naraz, tempo pojawiania się, co ilu wrogów bonus, życia na start
i jaka część wrogów jest o stopień mocniejsza. Sumuje się z mnożnikiem za liczbę graczy.
Normalny = oryginał.

## Menu Gracza 1 i szerokie plansze

Pierwszy podłączony gracz ma na padzie przycisk MENU. W lobby wybiera tam planszę, poziom
i START, a w grze menu pauzuje grę i daje WZNÓW / RESTART / KONIEC GRY. Planszę i poziom wybiera
tylko on, pozostali widzą je jako podgląd.

Wybór planszy idzie w kółko: losowa szeroka (SZER) → losowa (LOS) → 1…35. Losowa szeroka to cała
seria nowych plansz 13 × 21 (W1, W2…), każda następna też szeroka i losowa. Orzeł jest na środku,
gracze 3 i 4 startują dalej od niego, a wrogowie wjeżdżają z 5 miejsc. Szerokość ustawia się
w `src/engine/constants.ts` (`WIDE_FIELD_COLS`).

## Jeden link dla wszystkich

Wystarczy link do TV (`/tv`, na serwerze z kluczem `?k=…`). Na każdym urządzeniu w lobby jest
„Sterowanie tutaj”:

- **Ten ekran: TV + klawiatura / tylko TV** (klik przełącza). Na komputerze domyślnie
  z klawiaturą, na telewizorze i telefonie „tylko TV”, bo strzałki pilota nie powinny dołączać
  gracza. Wybór zapamiętuje przeglądarka, także w `#/pc` — PC może być samym ekranem, a grają
  telefony.
- **Pady PS / Xbox** działają zawsze: pierwszy przycisk dołącza gracza.
- **Telefon** dostaje przycisk „Steruj tym telefonem”, który przełącza go w pad. Można też
  zeskanować QR z ekranu.

`#/pc` dalej działa: to ten sam ekran, z klawiaturą, dopóki nie przełączysz na „tylko TV”.

## Profile drużyny

Profil to wspólny zapis drużyny: XP z kupionymi bonusami i rekord, czyli najdalsza plansza,
osobno dla plansz z gry, losowych i szerokich. Pierwszy profil to **TankMonsters**.

- Wybór: w lobby strzałki przy „Profil” na ekranie TV/PC albo MENU Gracza 1 → PROFIL.
- Po wyborze wczytuje się postęp profilu. Plansze z gry ustawiają się na rekord, a losowe
  i szerokie startują od rekordu; przełącznik „Start od rekordu / od początku” to zmienia.
- Postęp zapisuje się sam, chwilę po każdej zmianie i przy zamykaniu serwera, do
  `data/profile-postep.json` lokalnie albo do `PARTY_DATA_DIR` na serwerze.
- Nowy profil: `aktualizuj_serwer.bat` → 7 „Dodaj profil drużyny”, potem 1 (Aktualizuj grę).
  Lista profili leży w `config/profile.json`.
- XP jest domyślnie włączone (`config/rozgrywka.json` → `xp.enabled`).

## Profile graczy

Każdy gracz może grać na swoim profilu ze statystykami: zabici wrogowie (osobno każdy typ
i granatem), gry, rozegrane i ukończone rundy, najdalsza plansza, strzały, trafienia, śmierci,
bonusy, życia, punkty i czas gry. Pola `level` i `xp` czekają na przyszłe poziomy postaci.

- Wybór: na padzie w lobby strzałki przy nazwie (pierwsza pozycja to GOŚĆ, bez zapisu). Telefon
  pamięta swój profil i wybiera go sam po dołączeniu. Dwa telefony nie mogą mieć tego samego.
- Logo: kliknięcie nazwy na padzie zmienia logo na następne. Loga są w `config/loga.json`
  (SVG w polu 24 × 24); podmienimy je na loga od czata.
- TV pokazuje logo i nazwę gracza przy jego miejscu.
- Dodawanie, edycja (nazwa, logo) i usuwanie: `aktualizuj_serwer.bat` → 9–12, potem 1, żeby
  wgrać. Lista leży w `config/gracze.json`; `id` się nie zmienia, więc statystyki zostają.
- Statystyki zapisują się same (najwyżej raz na 3 s i przy zamykaniu) do
  `data/gracze-statystyki.json` lokalnie albo do `PARTY_DATA_DIR` na serwerze.

Profil drużyny (np. TankMonsters, XP i rekord) wybiera się osobno: „Drużyna” na TV i w MENU.
