"""Cięcie arkuszy z grafikami czołgów (jak od czata: wiersze LV1–LV5, kolumny = klatki animacji)
na pliki gry: public/grafiki/czolgi/gracz/lvN/ruch_F.png (64×64, pixel art z siatki 32×32) + akcent.png.

Czysta logika bez okna — używa jej edytor_grafik.py i testy.

Kroki:
1. tło = mediana kolorów z brzegu arkusza; piksel należy do rysunku, gdy różni się od tła o > próg,
2. spójne kawałki rysunku (OpenCV); bryły czołgów = duże i „pełne” kawałki,
3. bryły układają się w wiersze (poziomy) i kolumny (klatki),
4. do każdej bryły dokładamy kawałki leżące bliżej niż `odstep` px (kolce, flaga) — bez czerwonych
   strzałek i napisów,
5. wspólna skala arkusza: największy czołg wypełnia siatkę 32×32; pomniejszanie uśrednia
   (bez szumu), potem wspólna paleta kolorów i twarde krawędzie (alfa 0/255),
6. powiększenie ×2 bez wygładzania do 64×64; klatki jednego poziomu wyrównane do czubka lufy.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


@dataclass
class Ustawienia:
    prog_tla: int = 16
    """o ile kolor musi się różnić od tła (0–255), żeby był rysunkiem"""
    domkniecie: int = 7
    """px — łata szczeliny w obrysie (czarne detale na czarnym tle); dziury w środku są wypełniane"""
    odstep: int = 6
    """kawałki bliżej niż tyle px od bryły czołgu należą do niego (kolce, flaga)"""
    wiersze: int = 0
    """0 = wykryj; inaczej wymuszona liczba wierszy (poziomów)"""
    kolumny: int = 0
    """0 = wykryj; inaczej wymuszona liczba klatek w wierszu"""
    siatka: int = 32
    """rozdzielczość pixel artu (piksel sztuki)"""
    wyjscie: int = 64
    """rozmiar pliku gry (płótno klatki)"""
    wypelnienie: float = 1.0
    """ile siatki zajmuje największy czołg arkusza (0.5–1)"""
    kolory: int = 14
    """liczba kolorów wspólnej palety (0 = bez ograniczania)"""
    prog_alfa: float = 0.5
    """od jakiego pokrycia piksel siatki jest nieprzezroczysty"""
    usun_strzalki: bool = True
    """pomijaj wąskie czerwone kreski i grociki obok czołgów"""
    pierwszy_poziom: int = 1
    """który LV ma pierwszy wiersz arkusza"""


@dataclass
class Kawalek:
    """spójny kawałek rysunku na arkuszu"""
    nr: int
    x: int
    y: int
    w: int
    h: int
    pole: int
    rola: str = 'pominiety'
    """czolg / dolaczony / strzalka / napis / pominiety"""
    kafel: tuple[int, int] | None = None


@dataclass
class Kafel:
    """jeden czołg = jedna klatka: wiersz (poziom) × kolumna (klatka)"""
    wiersz: int
    kolumna: int
    ramka: tuple[int, int, int, int]
    """x, y, w, h na arkuszu (wszystkie zebrane kawałki)"""
    maska: np.ndarray
    """bool, rozmiar ramki"""
    kawalki: list[int] = field(default_factory=list)
    obraz: Image.Image | None = None
    """wynik 64×64 RGBA"""
    akcent: Image.Image | None = None


@dataclass
class Wynik:
    kawalki: list[Kawalek]
    kafle: list[Kafel]
    wiersze: int
    kolumny: int
    tlo: tuple[int, int, int]
    skala: float
    ostrzezenia: list[str]


def _kolor_tla(rgb: np.ndarray) -> np.ndarray:
    brzeg = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return np.median(brzeg, axis=0)


def _wypelnij_dziury(maska: np.ndarray) -> np.ndarray:
    """wszystko, czego nie da się osiągnąć z brzegu arkusza po tle, należy do rysunku"""
    h, w = maska.shape
    zalew = np.zeros((h + 2, w + 2), np.uint8)
    zalew[1:-1, 1:-1] = maska
    pomoc = np.zeros((h + 4, w + 4), np.uint8)
    cv2.floodFill(zalew, pomoc, (0, 0), 2)
    return (zalew[1:-1, 1:-1] != 2).astype(np.uint8)


def _grupy(srodki: list[float], wymuszone: int) -> list[list[int]]:
    """dzieli pozycje (posortowane indeksy) na grupy po przerwach — wiersze albo kolumny"""
    kolej = sorted(range(len(srodki)), key=lambda i: srodki[i])
    if not kolej:
        return []
    if wymuszone > 0:
        # największe przerwy wyznaczają granice
        przerwy = sorted(
            range(1, len(kolej)), key=lambda j: srodki[kolej[j]] - srodki[kolej[j - 1]], reverse=True
        )[: wymuszone - 1]
        granice = sorted(przerwy)
    else:
        odl = [srodki[kolej[j]] - srodki[kolej[j - 1]] for j in range(1, len(kolej))]
        mediana = float(np.median(odl)) if odl else 0
        prog = max(20.0, 3 * mediana) if mediana < 20 else mediana * 0.5
        granice = [j for j in range(1, len(kolej)) if odl[j - 1] > prog]
    grupy, start = [], 0
    for g in granice + [len(kolej)]:
        grupy.append(kolej[start:g])
        start = g
    return grupy


def _czerwony(px: np.ndarray) -> np.ndarray:
    r, g, b = px[..., 0].astype(int), px[..., 1].astype(int), px[..., 2].astype(int)
    return (r > 100) & (r > g * 2.2) & (r > b * 2.2)


def _ramka_napisu(wycinek: np.ndarray) -> bool:
    """pusta prostokątna ramka (podpis LV / numer klatki): piksele na wszystkich 4 brzegach, środek pusty"""
    h, w = wycinek.shape
    if w < 14 or h < 14 or wycinek.mean() > 0.45:
        return False
    brzegi = [wycinek[0:2].any(axis=0).mean(), wycinek[-2:].any(axis=0).mean(),
              wycinek[:, 0:2].any(axis=1).mean(), wycinek[:, -2:].any(axis=1).mean()]
    return min(brzegi) > 0.75


def _naklada(a: Kawalek, b: Kawalek) -> float:
    """jaka część ramki b leży w ramce a"""
    x0, y0 = max(a.x, b.x), max(a.y, b.y)
    x1, y1 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0) / max(1, b.w * b.h)


def _lancuchy_strzalek(et: np.ndarray, st: np.ndarray, czerwone: np.ndarray) -> set[int]:
    """przerywane pionowe strzałki: co najmniej 3 wąskie czerwone kawałki jeden pod drugim
    (te same x, małe przerwy) — paski na gąsienicach są ukośne i szersze, więc się nie łapią"""
    kandydaci = []
    for i in range(1, len(st)):
        x, y, w, h, pole = (int(v) for v in st[i])
        if w > 12 or pole < 4:
            continue
        wyc = et[y : y + h, x : x + w] == i
        if czerwone[y : y + h, x : x + w][wyc].mean() > 0.6:
            kandydaci.append((x + w / 2, y, y + h, i))
    kandydaci.sort(key=lambda k: (round(k[0] / 4), k[1]))
    wynik: set[int] = set()
    uzyte = [False] * len(kandydaci)
    for a in range(len(kandydaci)):
        if uzyte[a]:
            continue
        lancuch = [a]
        ostatni = kandydaci[a]
        for b in range(a + 1, len(kandydaci)):
            k = kandydaci[b]
            if abs(k[0] - ostatni[0]) <= 3 and 0 <= k[1] - ostatni[2] <= 8:
                lancuch.append(b)
                ostatni = k
        # kreski zlane w jeden wąski, wysoki pasek też są strzałką
        _, gy0, gy1, gi = kandydaci[a]
        gx, gy, gw, gh, _ = (int(v) for v in st[gi])
        if len(lancuch) >= 3 or (len(lancuch) == 1 and gh >= 3 * gw and gh >= 20):
            for j in lancuch:
                uzyte[j] = True
                wynik.add(kandydaci[j][3])
            # grot strzałki: czerwony kawałek (do 20 px) tuż pod ostatnią kreską, na tej samej osi
            sx, dol = ostatni[0], ostatni[2]
            for i in range(1, len(st)):
                x, y, w, h, _ = (int(v) for v in st[i])
                if i in wynik or w > 20 or abs(x + w / 2 - sx) > 4 or not (0 <= y - dol <= 8):
                    continue
                wyc = et[y : y + h, x : x + w] == i
                if czerwone[y : y + h, x : x + w][wyc].mean() > 0.5:
                    wynik.add(i)
    return wynik


def _obetnij_strzalki(
    obszar: np.ndarray, surowa: np.ndarray, czerwone: np.ndarray, kafel: Kafel, usuniete: list[Kawalek]
) -> np.ndarray:
    """strzałki stoją z boku czołgu, oddzielone pustą kolumną tła: dzielimy obszar czołgu na pasma
    kolumn (wg surowej maski, bez domykania) i odcinamy wąskie, głównie czerwone pasma przy krawędziach"""
    ys, xs = np.nonzero(obszar)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rysunek = surowa[y0:y1, x0:x1].astype(bool) & obszar[y0:y1, x0:x1]
    zajete = rysunek.sum(axis=0) >= 2
    pasma: list[tuple[int, int]] = []
    start = None
    for i, z in enumerate(list(zajete) + [False]):
        if z and start is None:
            start = i
        elif not z and start is not None:
            pasma.append((start, i))
            start = None
    if len(pasma) < 2:
        return obszar
    szer = x1 - x0
    czer = czerwone[y0:y1, x0:x1]

    def strzalka(a: int, b: int) -> bool:
        piks = rysunek[:, a:b]
        return (b - a) <= max(20, 0.18 * szer) and piks.sum() > 0 and czer[:, a:b][piks].mean() > 0.45

    wynik = obszar.copy()
    # odcinamy od lewej i od prawej, dopóki skrajne pasmo wygląda jak strzałka
    while len(pasma) > 1 and strzalka(*pasma[0]):
        a, b = pasma.pop(0)
        wynik[y0:y1, x0 + a : x0 + b] = False
        usuniete.append(Kawalek(-1, int(x0 + a), int(y0), int(b - a), int(y1 - y0), 0, 'strzalka'))
    while len(pasma) > 1 and strzalka(*pasma[-1]):
        a, b = pasma.pop()
        wynik[y0:y1, x0 + a : x0 + b] = False
        usuniete.append(Kawalek(-1, int(x0 + a), int(y0), int(b - a), int(y1 - y0), 0, 'strzalka'))
    return wynik


def _wolnostojacy(surowa: np.ndarray, x: int, y: int, w: int, h: int, margines: int = 4) -> bool:
    """dookoła prostokąta (pasek `margines` px) prawie samo tło — kawałek nie jest częścią czołgu"""
    H, W = surowa.shape
    x0, y0 = max(0, x - margines), max(0, y - margines)
    x1, y1 = min(W, x + w + margines), min(H, y + h + margines)
    okolica = surowa[y0:y1, x0:x1].astype(bool).copy()
    okolica[y - y0 : y - y0 + h, x - x0 : x - x0 + w] = False
    pas = (y1 - y0) * (x1 - x0) - w * h
    return pas > 0 and okolica.sum() / pas < 0.08


def analizuj(obraz: Image.Image, u: Ustawienia) -> Wynik:
    rgb = np.asarray(obraz.convert('RGB'))
    tlo = _kolor_tla(rgb)
    roznica = np.abs(rgb.astype(int) - tlo.astype(int)).max(axis=2)
    surowa = (roznica > u.prog_tla).astype(np.uint8)
    # wyraźna maska (wyższy próg): szum kompresji nie skleja tu strzałek i napisów z czołgami
    wyrazna = (roznica > max(40, u.prog_tla * 2)).astype(np.uint8)
    czerwone = _czerwony(rgb)

    # 1. na wyraźnej masce: strzałki (wąskie czerwone kreski) i ramki napisów — do wycięcia
    _, et_s, st_s, _ = cv2.connectedComponentsWithStats(wyrazna, connectivity=8)
    usuniete: list[Kawalek] = []
    wyciete = np.zeros_like(surowa, dtype=bool)
    strzalki: set[int] = set()
    for i in range(1, len(st_s)):
        x, y, w, h, pole = (int(v) for v in st_s[i])
        wyc = et_s[y : y + h, x : x + w] == i
        if i in strzalki:
            rola = 'strzalka'
        elif _ramka_napisu(wyc) and _wolnostojacy(wyrazna, x, y, w, h):
            rola = 'napis'
        else:
            continue
        usuniete.append(Kawalek(-i, x, y, w, h, pole, rola))
    # cały prostokąt strzałki / napisu (+2 px na rozmyte krawędzie kompresji) idzie do wycięcia
    H, W = surowa.shape
    for k in usuniete:
        wyciete[max(0, k.y - 2) : min(H, k.y + k.h + 2), max(0, k.x - 2) : min(W, k.x + k.w + 2)] = True
    maska = surowa.copy()
    maska[wyciete] = 0

    # 2. czarny obrys i czarne detale czołgu zlewają się z czarnym tłem: domykamy szczeliny
    #    i wypełniamy wszystko, co jest otoczone rysunkiem
    if u.domkniecie > 1:
        jadro_d = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (u.domkniecie, u.domkniecie))
        maska = cv2.morphologyEx(maska, cv2.MORPH_CLOSE, jadro_d)
        maska = _wypelnij_dziury(maska)
        maska[wyciete] = 0
    n, etykiety, staty, _ = cv2.connectedComponentsWithStats(maska, connectivity=8)
    kawalki = [
        Kawalek(i, int(s[0]), int(s[1]), int(s[2]), int(s[3]), int(s[4])) for i, s in enumerate(staty)
    ][1:]
    ostrzezenia: list[str] = []
    if not kawalki:
        return Wynik(usuniete, [], 0, 0, tuple(int(c) for c in tlo), 1.0, ['Nie znaleziono rysunku — zmniejsz próg tła'])

    # 3. bryły czołgów: duże, pełne i „czołgowe” (napis LV jest płaski, tytuł to długi pasek)
    najwieksze = sorted((k.pole for k in kawalki), reverse=True)
    wzor = najwieksze[min(len(najwieksze) - 1, 4)]
    for k in kawalki:
        pelnosc = k.pole / max(1, k.w * k.h)
        proporcja = k.h / max(1, k.w)
        if k.pole >= 0.25 * wzor and pelnosc >= 0.3 and k.h >= 24 and 0.7 <= proporcja <= 3:
            k.rola = 'czolg'
    bryly = [k for k in kawalki if k.rola == 'czolg']
    # czołg rozcięty ciemną linią daje dwie bryły jedna w drugiej — mniejszą doklejamy do większej
    bryly.sort(key=lambda k: k.pole, reverse=True)
    glowne: list[Kawalek] = []
    for k in bryly:
        rodzic = next((g for g in glowne if _naklada(g, k) > 0.5), None)
        if rodzic is None:
            glowne.append(k)
        else:
            k.rola = 'pominiety'
    bryly = glowne

    # wiersze i kolumny
    wiersze = _grupy([k.y + k.h / 2 for k in bryly], u.wiersze)
    kafle: list[Kafel] = []
    max_kolumn = 0
    for w_nr, wiersz in enumerate(wiersze):
        w_bryly = [bryly[i] for i in wiersz]
        w_bryly.sort(key=lambda k: k.x)
        if u.kolumny > 0 and len(w_bryly) > u.kolumny:
            w_bryly = sorted(w_bryly, key=lambda k: k.pole, reverse=True)[: u.kolumny]
            w_bryly.sort(key=lambda k: k.x)
        max_kolumn = max(max_kolumn, len(w_bryly))
        for k_nr, bryla in enumerate(w_bryly):
            bryla.kafel = (w_nr, k_nr)
            kafle.append(Kafel(w_nr, k_nr, (0, 0, 0, 0), np.zeros((1, 1), bool), [bryla.nr]))

    # dokładanie bliskich kawałków do brył (kolce, flaga) — powtarzane, bo kawałek dokłada kolejne
    jadro = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * u.odstep + 1, 2 * u.odstep + 1))
    po_nr = {k.nr: k for k in kawalki}
    for kafel in kafle:
        zebrane = set(kafel.kawalki)
        while True:
            obszar = np.isin(etykiety, list(zebrane))
            ys, xs = np.nonzero(obszar)
            x0, x1 = max(0, xs.min() - u.odstep - 1), min(rgb.shape[1], xs.max() + u.odstep + 2)
            y0, y1 = max(0, ys.min() - u.odstep - 1), min(rgb.shape[0], ys.max() + u.odstep + 2)
            sasiedztwo = cv2.dilate(obszar[y0:y1, x0:x1].astype(np.uint8), jadro).astype(bool)
            nowe = set(np.unique(etykiety[y0:y1, x0:x1][sasiedztwo])) - zebrane - {0}
            nowe = {
                nr
                for nr in nowe
                if po_nr[nr].rola == 'pominiety' and po_nr[nr].kafel is None
            }
            if not nowe:
                break
            for nr in nowe:
                po_nr[nr].rola = 'dolaczony'
                po_nr[nr].kafel = (kafel.wiersz, kafel.kolumna)
            zebrane |= nowe
        kafel.kawalki = sorted(zebrane)
        obszar = np.isin(etykiety, kafel.kawalki)
        if u.usun_strzalki:
            obszar = _obetnij_strzalki(obszar, wyrazna, czerwone, kafel, usuniete)
        ys, xs = np.nonzero(obszar)
        x, y = int(xs.min()), int(ys.min())
        w, h = int(xs.max()) - x + 1, int(ys.max()) - y + 1
        kafel.ramka = (x, y, w, h)
        kafel.maska = obszar[y : y + h, x : x + w]

    if not kafle:
        ostrzezenia.append('Nie znaleziono czołgów — zmniejsz próg tła albo sprawdź arkusz')
        return Wynik(kawalki + usuniete, [], 0, 0, tuple(int(c) for c in tlo), 1.0, ostrzezenia)

    # wspólna skala: największy czołg = cała siatka (× wypełnienie)
    najwiekszy = max(max(k.ramka[2], k.ramka[3]) for k in kafle)
    skala = u.siatka * u.wypelnienie / najwiekszy
    _renderuj(rgb, kafle, u, skala)

    licznik = {}
    for k in kafle:
        licznik[k.wiersz] = licznik.get(k.wiersz, 0) + 1
    for w, ile in licznik.items():
        if ile != max_kolumn:
            ostrzezenia.append(f'LV{w + u.pierwszy_poziom}: {ile} klatek zamiast {max_kolumn}')
    return Wynik(kawalki + usuniete, kafle, len(wiersze), max_kolumn, tuple(int(c) for c in tlo), skala, ostrzezenia)


def _renderuj(rgb: np.ndarray, kafle: list[Kafel], u: Ustawienia, skala: float) -> None:
    """pomniejszenie do siatki, wspólna paleta, powiększenie do pliku; klatki poziomu wyrównane"""
    male: dict[tuple[int, int], Image.Image] = {}
    for k in kafle:
        x, y, w, h = k.ramka
        wyc = np.zeros((h, w, 4), np.uint8)
        wyc[..., :3] = rgb[y : y + h, x : x + w]
        wyc[..., 3] = k.maska * 255
        cel = (max(1, round(w * skala)), max(1, round(h * skala)))
        # uśrednianie na kolorach przemnożonych przez alfę — krawędzie nie łapią koloru tła
        premul = wyc.astype(np.float32)
        premul[..., :3] *= premul[..., 3:4] / 255
        img = cv2.resize(premul, cel, interpolation=cv2.INTER_AREA)
        alfa = img[..., 3:4]
        kolor = np.where(alfa > 0, img[..., :3] * 255 / np.maximum(alfa, 1e-3), 0)
        twarda = (alfa[..., 0] >= u.prog_alfa * 255).astype(np.uint8) * 255
        out = np.dstack([np.clip(kolor, 0, 255).astype(np.uint8), twarda])
        male[(k.wiersz, k.kolumna)] = Image.fromarray(out, 'RGBA')

    paleta = None
    if u.kolory > 0:
        # wspólna paleta całego arkusza (wszystkie klatki razem) — te same kolory na każdym poziomie
        pelne = [np.asarray(m)[..., :3][np.asarray(m)[..., 3] > 0] for m in male.values()]
        probka = np.concatenate([p for p in pelne if len(p)]) if pelne else np.zeros((1, 3), np.uint8)
        pasek = Image.fromarray(probka.reshape(1, -1, 3).astype(np.uint8), 'RGB')
        paleta = pasek.quantize(colors=u.kolory, method=Image.Quantize.MEDIANCUT)

    # wyrównanie klatek jednego poziomu: środek w poziomie, czubek (góra) w pionie
    wiersze: dict[int, list[Kafel]] = {}
    for k in kafle:
        wiersze.setdefault(k.wiersz, []).append(k)
    mnoznik = u.wyjscie // u.siatka
    for lista in wiersze.values():
        wys = max(male[(k.wiersz, k.kolumna)].height for k in lista)
        for k in lista:
            m = male[(k.wiersz, k.kolumna)]
            if paleta is not None:
                alfa = m.getchannel('A')
                m = m.convert('RGB').quantize(palette=paleta, dither=Image.Dither.NONE).convert('RGBA')
                m.putalpha(alfa)
            plotno = Image.new('RGBA', (u.siatka, u.siatka), (0, 0, 0, 0))
            px = (u.siatka - m.width) // 2
            py = (u.siatka - wys) // 2
            plotno.paste(m, (px, py), m)
            # alfa tylko 0/255, kolor przezroczystych pikseli wyzerowany
            a = np.asarray(plotno).copy()
            a[a[..., 3] < 128] = 0
            a[a[..., 3] >= 128, 3] = 255
            duzy = Image.fromarray(a, 'RGBA').resize((u.siatka * mnoznik,) * 2, Image.NEAREST)
            k.obraz = duzy
            akc = _czerwony(np.asarray(duzy)) & (np.asarray(duzy)[..., 3] > 0)
            maska_akc = np.zeros((*akc.shape, 4), np.uint8)
            maska_akc[akc] = (255, 255, 255, 255)
            k.akcent = Image.fromarray(maska_akc, 'RGBA')


def sprawdz_plik(sciezka: Path, rozmiar: int = 64) -> list[str]:
    """kontrola jak w instrukcji: rozmiar, RGBA, alfa tylko 0/255"""
    bledy = []
    im = Image.open(sciezka)
    if im.size != (rozmiar, rozmiar):
        bledy.append(f'{sciezka.name}: rozmiar {im.size}, a ma być {rozmiar}×{rozmiar}')
    if im.mode != 'RGBA':
        bledy.append(f'{sciezka.name}: tryb {im.mode}, a ma być RGBA')
    else:
        alfa = np.unique(np.asarray(im)[..., 3])
        if not set(alfa.tolist()) <= {0, 255}:
            bledy.append(f'{sciezka.name}: półprzezroczyste piksele')
    return bledy


def zapisz(wynik: Wynik, u: Ustawienia, katalog_grafik: Path, fps: int = 12) -> list[str]:
    """zapisuje klatki do <katalog_grafik>/czolgi/gracz/lvN/ruch_F.png + akcent.png, dopisuje manifest;
    zwraca raport (zapisane pliki i błędy kontroli)"""
    raport = []
    poziomy: dict[int, list[Kafel]] = {}
    for k in wynik.kafle:
        poziomy.setdefault(k.wiersz + u.pierwszy_poziom, []).append(k)
    manifest_plik = katalog_grafik / 'manifest.json'
    try:
        manifest = json.loads(manifest_plik.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        manifest = {}
    for lv, lista in sorted(poziomy.items()):
        folder = katalog_grafik / 'czolgi' / 'gracz' / f'lv{lv}'
        folder.mkdir(parents=True, exist_ok=True)
        # stare klatki poziomu usuwamy, żeby nie zostały np. ruch_5 z poprzedniego arkusza
        for stary in folder.glob('ruch_*.png'):
            stary.unlink()
        for k in sorted(lista, key=lambda k: k.kolumna):
            plik = folder / f'ruch_{k.kolumna + 1}.png'
            k.obraz.save(plik)
            raport.append(f'zapisano {plik.relative_to(katalog_grafik.parent)}')
            raport += sprawdz_plik(plik, u.wyjscie)
        lista[0].akcent.save(folder / 'akcent.png')
        manifest[f'czolgi/gracz/lv{lv}/ruch'] = {'klatki': len(lista), 'fps': fps}
    manifest_plik.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    tymczasowe = katalog_grafik / 'TYMCZASOWE.txt'
    if tymczasowe.exists():
        tymczasowe.unlink()
    return raport
