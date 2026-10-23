# Wydanie 0.4.6-stable

Poligon ma suwaki poziomu czołgu LV1–LV5 oraz trzech cech XP. Pod planszą
pokazuje HP, prędkość i odstęp strzałów. „Trafienie −1 HP” i „Napraw pancerz”
pozwalają sprawdzić kolory; podgląd nie zmienia sesji serwera. Zapis profilu
zachowuje te suwaki, także w pliku na PC przy połączonym telefonie.
Panele XP, poligon i przyciski PC/TV mają wspólny czerwony styl pada.

Startowy poziom, czasy tarcz, maksymalne/początkowe poziomy XP oraz premie:
`config/rozgrywka.json`. Wartości są wbudowywane przy aktualizacji gry i serwera.
Pełny opis pól i pozostałych konfiguracji jest w `CONFIGURACJA.md`.

Opcjonalny XP drużyny (domyślnie wyłączony): w lobby „Rozwój XP” na PC/TV
lub MENU pierwszego gracza na telefonie. Włącz przed startem; rozwiń ustawienia,
aby ustawić koszt LV1 każdej cechy (100–10000 XP), szybkość na poziom (5–50%),
szybkostrzelność na poziom (5–50%) i wytrzymałość na poziom (1–3 HP).
Zmiany przelicznika są dozwolone tylko w lobby i zapisują się od razu w sesji.

Za pokonanych wrogów cała drużyna dostaje wspólne XP: 100/200/300/400 według
typu, również po granacie. Pierwszy gracz w MENU lub wspólny ekran PC/TV wybiera
zakup szybkości, szybkostrzelności albo wytrzymałości. Trzy paski pokazują osobne
poziomy 0–3. Koszt zakupu LV2 to 2×, LV3 to 3× cena LV1. Zakupy działają od razu,
także podczas pauzy, dla całej drużyny i graczy w kolejnych rozgrywkach.
Szybkostrzelność skraca odstęp między strzałami (obowiązuje też limit pocisków
czołgu). Pancerz zwiększa HP, kolory zmieniają się jak u ciężkich wrogów;
pasek nad czołgiem pokazuje pozostałe HP i zachowuje kolor gracza.
Zakup dodaje nowe HP, lecz kolejne klatki nie leczą uszkodzeń. Odrodzenie daje
pełny pancerz. Gwiazdki i poziomy czołgów działają niezależnie od XP.

Pula i zakupy należą do uruchomionego procesu serwera: zostają po śmierci,
zmianie mapy, restarcie rozgrywki, odświeżeniu przeglądarki i opróżnieniu pokoju.
Ponowne uruchomienie serwera zeruje pulę XP i przywraca poziomy oraz ustawienia z pliku konfiguracji. Wyłączenie XP
przed grą zawiesza zdobywanie punktów i premie, ale nie kasuje postępu tej sesji.

Do jednego PC/TV można podłączyć 2–4 pady sprzętowe. Każdy indeks Gamepad API
ma osobne połączenie i slot gracza; limit czterech obejmuje łącznie klawiaturę,
pady sprzętowe i telefony. Naciśnij przycisk na każdym padzie, aby go ujawnić
przeglądarce. Testy sprawdzają niezależne wejścia czterech padów i cztery sloty
serwera. Rzeczywistego modelu TV oraz padów nie testowano sprzętowo.

Pad gry ma osobny suwak „Czułość” (siatka skrętu od 0 do 2 kratek, co ¼).
Wybór jest zapisywany na telefonie i przesyłany do serwera po dołączeniu lub
ponownym połączeniu. Działa dla danego gracza także po odrodzeniu i zmianie mapy.
Przycisk strzelania jest powiększony o 50%; małe ekrany ograniczają go do
wolnego miejsca, żeby nie zasłaniał suwaków i menu.

Gwiazdka podnosi o jeden poziom wszystkie żyjące czołgi graczy na mapie,
maksymalnie do LV5. Na LV5 gracz dostaje dotychczasową premię punktową.
Czołgi w animacji odrodzenia nie dostają ulepszenia. Wskrzeszanie po bonusie
odbywa się po jego zwykłym efekcie.

Poligon ma dwa niezależne suwaki: „Czułość (siatka skrętu)” i „Filtr wejścia
(klatki)”, 0–12 kroków silnika. Oba zapisuje przycisk Zapisz. Zatrzymanie i ogień
omijają filtr. Skrypt poligon.bat wykrywa istniejący poligon na 5174,
podaje adres i otwiera stronę zamiast uruchamiać drugi serwer.

Podniesienie dowolnego bonusu (czołg, gwiazdka, granat, zegar, tarcza, łopata)
wskrzesza wszystkich poległych graczy bez zapasu żyć. Wracają ze standardową
tarczą odrodzenia, bez dodatkowego zapasu. Żyjący gracze nie dostają za to życia;
zwykłe działanie bonusów pozostaje zachowane, w tym dodatkowe życie za czołg.
Trwająca eksplozja kończy się przed odrodzeniem. Kolejne bonusy nie dublują powrotu.

Głośność na PC/TV: minimum (15%), middle (50%, domyślnie), max (100%).
Przyciski są w lobby i podczas pauzy. Wybór jest zapisywany w przeglądarce
pod `battle-city-volume`, działa również na trwające dźwięki i respektuje `?mute`.
Sprawdzono zapis po odświeżeniu i wybór klawiaturą bez wznawiania gry.

Poprawka startu lokalnego: skrypty korzystają bezpośrednio z zainstalowanych
TypeScript i Vite, bez uruchamiania pnpm i odpytywania rejestru pakietów.
Przyszłe instalacje korzystają z oficjalnego `registry.npmjs.org`.
Gra, test na PC, tryb developera i poligon mają poprawione uruchamianie.

Każdy wróg dostaje tarczę przeciw pociskom na 3000 ms od zakończenia animacji
pojawiania się. Zamrożenie wrogów nie przedłuża tarczy. Poligon nadal nie ma
wrogów ani tarczy gracza.

Sterowanie dotykowe w zwykłej grze używa profilu „Stabilniejszy” z poligonu:
martwa strefa 10%, strefa obrotu 30%, margines zmiany osi 18%, margines
powrotu do obrotu 4%, czułość 1,2, stały środek, wibracja 8 ms.

Próg obrotu można nadal zmieniać suwakiem telefonu. Jest zapisywany osobno
pod `party-turn-zone-stable`, więc zapis ze starej wersji nie zmienia domyślnego
profilu stable. Klawiatura i pady sprzętowe zachowują swoje mapowanie.

## Lokalnie

Uruchom `uruchom_lokalnie_stable.bat` (buduje bieżące źródła).
PC: http://localhost:8090/#/pc. Telefon: QR z lobby, w tej samej sieci Wi-Fi.
W lobby i na padzie widoczny jest dopisek STABLE.

Zachowana kopia tego wydania: `build/0.4.6-stable/` — zawiera `www`,
`dist-server`, manifest z numerem wersji i `uruchom.bat`.
Do uruchomienia kopii potrzebny jest Node.js i wolny port 8090.

## Serwer

Paczka tego samego wydania: `deploy/battle-city-party-0.4.6-stable.tar.gz`.
Zawiera wyłącznie `www/`, `dist-server/` i `package.json` z numerem wersji.
Nie zawiera kluczy ani lokalnych zapisów z poligonu.

Aktualizacja korzysta z istniejącego `deploy-battle-city` na Mikrusie.
Zachowuje stan ONLINE/OFFLINE. Po włączeniu gry odśwież TV i telefony.
Do późniejszych aktualizacji bieżących źródeł służy `aktualizuj_serwer.bat`.

0.4.6-stable jest zbudowana lokalnie i spakowana. Przy poprzedniej aktualizacji
do 0.4.3-stable automatyczna kontrola odrzuciła wgranie na serwer komunikatem
`blocked by policy`. W tej aktualizacji nie ponawiano wdrożenia.
Ostatnie wdrożenie na serwerze to 0.4.2-stable; sprawdzenie przed próbą aktualizacji
potwierdziło ONLINE i HTTP 200.

## Sprawdzenie przed wdrożeniem

W 0.4.6-stable pełny zestaw ma 231 zaliczonych testów oraz jeden domyślnie
pominięty test statystyczny arena. Dziesięć testów w `test/powerupRevive.test.ts`
sprawdza wszystkie bonusy, odrodzenie trzech poległych graczy, ochronę po powrocie,
brak dodatkowych żyć dla żyjących i brak podwójnego odrodzenia.
TypeScript i oba buildy poprawne. Sprawdzono lokalne lobby, dołączenie pada
przez adres Wi-Fi, próg 30% oraz uruchomienie gry z pada.
Test integracyjny `test/stablePad.test.ts` sprawdza profil w rzeczywistym
komponencie pada, ignorowanie starego progu, stabilizację kierunku i STOP po
utracie fokusu.

Test `botSpawnShield.test.ts` sprawdza tarczę podczas animacji, ochronę przed
pociskami, wygaśnięcie dokładnie po 3 sekundach i działanie przy zamrożeniu.
Ślady deterministycznej symulacji pozostały zgodne z istniejącymi snapshotami.
Skrypt `uruchom_lokalnie_stable.bat -BezOtwierania` przeszedł pełne budowanie
i uruchomił lokalny serwer HTTP.

Testy `sessionXp.test.ts` i `partyXp.test.ts` obejmują koszty i limit poziomów,
walidację ustawień, klasyczny tryb bez premii, HP po trafieniu/odrodzeniu,
aktualizację podczas pauzy oraz zachowanie postępu po restarcie rozgrywki.
Sprawdzono też panel w przeglądarce: ustawienie cen, zakup pancerza z telefonu,
zakup szybkostrzelności z PC i aktualizację wspólnych pasków. W poziomym
widoku telefonu 844×390 menu przewija się do zakupów i przycisków gry.


