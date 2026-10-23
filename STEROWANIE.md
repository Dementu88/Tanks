# Poligon

Uruchom `poligon.bat`. Skrypt uruchamia Vite na porcie 5174 i otwiera
`http://localhost:5174/battle-city/#/poligon`.
Na telefonie w tej samej sieci możesz otworzyć `http://IP-KOMPUTERA:5174/battle-city/#/poligon`
do samodzielnego testu lub zeskanować QR panelu PC, aby używać telefonu wyłącznie jako pada.
Adresy sieciowe pokazuje Vite. Jeśli port 5174 jest już zajęty przez ten poligon,
wystarczy ponownie otworzyć link. Zamknięcie procesu Vite kończy udostępnianie strony.

Poligon działa w przeglądarce telefonu lub komputera. Serwer dostarcza pliki strony;
ruch, kolizje i strzały liczy lokalnie ten sam silnik co w grze. Nie łączy się z pokojem
party. Nie ma wrogów, autopilota ani przechodzenia do następnej planszy. Poligon jest
wyciszony. Po zbudowaniu zwykłej wersji gry dostępny jest także pod `#/poligon`.
Połączenie PC–telefon działa na Vite oraz lokalnym serwerze party bez `PARTY_KEY`.
Na serwerze z kluczem funkcja sterowania poligonem i zapisu profilu nie jest udostępniana.

## Telefon jako pad, suwaki na PC

1. Na PC otwórz poligon i zaznacz „Telefon jako pad · panel na PC”.
2. Telefonem w tej samej sieci Wi-Fi zeskanuj kod QR. Jeśli PC ma kilka kart sieciowych,
   wybierz jego adres Wi-Fi w panelu. Nie używaj `localhost` na telefonie.
3. Telefon pokazuje sam joystick i ogień, zawsze w poziomie. Przy pionowym ekranie
   układ jest obracany; przycisk „Pełny ekran” próbuje również zablokować orientację.
4. Patrz na labirynt na PC i zmieniaj suwaki na PC. Telefon dostaje je od razu.
   Po zmianie profilu trzeba puścić i ponownie dotknąć pada.
5. Kliknij „Zapisz”, aby zachować profil w `config/sterowanie.json` na komputerze.
   „Wczytaj zapisane” przywraca zapisane wartości na panelu i telefonie.

Stare suwaki sterowania (progi gałki, czułość, filtr wejścia, rozmiary przycisków) zniknęły
z panelu — poligon używa ostatnio zapisanego profilu. Strojenie robimy teraz w sekcji
„Siatka i obrysy”. Zmiany nie nadpisują zapisanego profilu automatycznie.
Bez włączonego połączenia telefonu przycisk zapisuje profil tylko w przeglądarce.
Zapis dotyczy poligonu; nie zmienia jeszcze ustawień zwykłej rozgrywki party.

Poligon obsługuje jeden telefon na sesję. Utrata połączenia zatrzymuje czołg;
brak świeżego sygnału ruchu również powoduje STOP. Po restarcie serwera należy
zeskanować nowy kod QR. Pozostaw kartę z labiryntem widoczną na PC.

## Testowanie

- Joystick: środek zatrzymuje, małe wychylenie obraca, większe uruchamia jazdę.
- Przycisk ognia można trzymać drugim palcem. Na PC działa mysz oraz WASD/strzałki,
  Shift do obrotu w miejscu i spacja do ognia.
- „Ustawienia / logi” otwiera panel na małym ekranie; na dużym panel jest stale widoczny.
- Pod planszą linijka „Siatka …” mówi, co działa teraz: krok ruchu, linie skrętu
  i wymiary obszaru dmg. Pomarańczowy prostokąt przed lufą pokazuje, co wytnie strzał.
- Labirynt zawiera pełne bloki, pionowe i poziome połówki, stal i cegły do rozbijania.
- „Poziomo” w nagłówku wymusza poziomy układ również w teście na jednym urządzeniu.
- Wyłącz labirynt, aby otrzymać pusty plac. Zmiana tej opcji i „Reset planszy”
  przywracają pozycję startową i odbudowują zniszczone cegły.

Profil zapisany przyciskiem jest też przechowywany w pamięci przeglądarki pod kluczem
`party-control-lab-profile-v1`. Wybór przeszkód i orientacji dotyczy bieżącej sesji.
Zmiana ustawień zatrzymuje sterowanie — należy rozpocząć nowy gest.
Te ustawienia nie zmieniają konfiguracji pada podczas zwykłej gry.

## Logi

Panel pokazuje zmiany wejścia, faktyczne reakcje czołgu (obrót/jazda/blokada/stop),
wystrzelone pociski, ustawienia i zdarzenia zwolnienia sterowania. Ruch palca jest
próbkowany maksymalnie 10 razy na sekundę, zmiany poleceń nie są ograniczane.
Wyświetlane jest ostatnich 60 wpisów; eksport JSON zawiera ostatnich 2000 wpisów,
liczbę odrzuconych starszych wpisów, ustawienia i informacje o przeglądarce/ekranie.
Logi pozostają w pamięci do odświeżenia strony; „Pobierz JSON” zapisuje je do pliku.

„Wejście → krok” mierzy czas od odbioru polecenia do następnego kroku lokalnego
silnika. Nie jest to pomiar opóźnienia Wi-Fi, serwera party ani telewizora.

Testy: `pnpm exec vitest run test/stick.test.ts test/touchJoystick.test.ts test/controlLab.test.ts test/controlLabRelay.test.ts`.

## Siatka i obrysy (tylko poligon)

Panel **Ustawienia → Siatka i obrysy**. Kratka (16 px) dzieli się na komórki — domyślnie 8 × 8,
czyli komórka 2 px. Komórka to najmniejszy krok ruchu, wyrównania skrętu i niszczenia.

- **Fizyka siatki** — wyłączona: poligon działa jak gra. Włączona: działają suwaki poniżej.
- **Podział kratki** 1–16, **Ruch co komórkę** (czołg staje tylko na liniach siatki, średnia
  prędkość bez zmian), **Wyrównanie skrętu** w komórkach, **Obszar dmg** — szerokość w poprzek
  lotu i głębokość w ścianę (8 komórek po 2 px = szerokość czołgu).
- **Obrysy**: siatka (białe komórki, czerwone kratki), kolizja czołgu (zielony 16 × 16)
  i miejsce zarezerwowane do skrętu (żółty), linie wyrównania skrętu (różowe), obszar
  niszczenia lecącego pocisku i ślad trafienia (pomarańczowy), ściany: cegły, stal, woda.

Ustawienia zapamiętuje przeglądarka (`party-control-lab-grid-v1`). Gra z rodziną ich nie używa —
jak się sprawdzą, przeniesiemy je do gry.
