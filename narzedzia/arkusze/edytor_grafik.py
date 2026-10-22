"""Edytor grafik ZombieTanks: arkusz od czata (wiersze LV, kolumny = klatki) → pliki gry.

Wklej obrazek (Ctrl+V), przeciągnij plik albo „Otwórz arkusz”. Program sam wykrywa czołgi,
usuwa strzałki i podpisy, pokazuje to ramkami na arkuszu, a obok wynik w rozmiarach z gry
i animację. „Zapisz do gry” zapisuje do public/grafiki (tryb developera gry widzi to po odświeżeniu).
"""
from __future__ import annotations

import os
import sys
from dataclasses import replace
from pathlib import Path

from PIL import Image
from PIL.ImageQt import ImageQt
from PySide6.QtCore import QObject, QRectF, QRunnable, Qt, QThreadPool, QTimer, Signal
from PySide6.QtGui import QAction, QBrush, QColor, QFont, QImage, QKeySequence, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFileDialog,
    QFormLayout,
    QGraphicsScene,
    QGraphicsView,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSlider,
    QSpinBox,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from przetwarzanie import Ustawienia, Wynik, analizuj, zapisz  # noqa: E402

try:
    from firmowe_utils.styl import qt as styl
    from firmowe_utils.styl.ikony import ikona
except ImportError:  # program działa też bez wspólnego stylu
    styl = None
    ikona = None

KATALOG_GRAFIK = Path(__file__).resolve().parents[2] / 'public' / 'grafiki'

KOLORY_ROL = {
    'czolg': ('#3ddc84', 'czołg (klatka)'),
    'dolaczony': ('#3fa9ff', 'dołączony do czołgu (kolce, flaga)'),
    'strzalka': ('#ff4fd8', 'strzałka — usunięta'),
    'napis': ('#ffd23f', 'napis / numer — usunięty'),
    'pominiety': ('#6b6b6b', 'pominięty (za daleko od czołgu)'),
}


def do_pixmapy(obraz: Image.Image, skala: int = 1, tlo: str | None = None) -> QPixmap:
    if tlo is not None:
        podklad = Image.new('RGBA', obraz.size, tlo)
        podklad.alpha_composite(obraz.convert('RGBA'))
        obraz = podklad
    if skala != 1:
        obraz = obraz.resize((obraz.width * skala, obraz.height * skala), Image.NEAREST)
    return QPixmap.fromImage(QImage(ImageQt(obraz.convert('RGBA'))))


class _Sygnaly(QObject):
    gotowe = Signal(int, object)


class _Zadanie(QRunnable):
    """analiza w tle — okno nie zamarza przy przesuwaniu suwaków"""

    def __init__(self, nr: int, obraz: Image.Image, u: Ustawienia, sygnaly: _Sygnaly):
        super().__init__()
        self.nr, self.obraz, self.u, self.sygnaly = nr, obraz, u, sygnaly

    def run(self):
        try:
            wynik = analizuj(self.obraz, self.u)
        except Exception as e:  # noqa: BLE001 — pokazujemy w oknie, nie wywalamy programu
            wynik = e
        self.sygnaly.gotowe.emit(self.nr, wynik)


class WidokArkusza(QGraphicsView):
    """arkusz z ramkami: co program uznał za czołg, co dołączył, co wyciął"""

    plik_upuszczony = Signal(str)

    def __init__(self):
        super().__init__()
        self.setScene(QGraphicsScene(self))
        self.setRenderHint(QPainter.SmoothPixmapTransform, False)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setAcceptDrops(True)
        self.setBackgroundBrush(QBrush(QColor('#101010')))
        self._obraz: Image.Image | None = None

    def pokaz(self, obraz: Image.Image, wynik: Wynik | None, u: Ustawienia):
        nowy = obraz is not self._obraz
        self._obraz = obraz
        sc = self.scene()
        sc.clear()
        sc.addPixmap(do_pixmapy(obraz))
        if wynik is not None:
            for k in wynik.kawalki:
                kolor = QColor(KOLORY_ROL[k.rola][0])
                pioro = QPen(kolor, 1.5 if k.rola in ('czolg', 'strzalka', 'napis') else 1)
                pioro.setCosmetic(True)
                if k.rola == 'pominiety':
                    pioro.setStyle(Qt.DotLine)
                sc.addRect(QRectF(k.x, k.y, k.w, k.h), pioro)
            czcionka = QFont('Segoe UI', 11, QFont.Bold)
            for kafel in wynik.kafle:
                x, y, w, h = kafel.ramka
                pioro = QPen(QColor('#3ddc84'), 2)
                pioro.setCosmetic(True)
                sc.addRect(QRectF(x - 2, y - 2, w + 4, h + 4), pioro)
                t = sc.addSimpleText(f'LV{kafel.wiersz + u.pierwszy_poziom}·{kafel.kolumna + 1}', czcionka)
                t.setBrush(QBrush(QColor('#3ddc84')))
                t.setPos(x, y - 20)
        if nowy:
            self.fitInView(sc.itemsBoundingRect(), Qt.KeepAspectRatio)

    def wheelEvent(self, e):
        f = 1.15 if e.angleDelta().y() > 0 else 1 / 1.15
        self.scale(f, f)

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls() or e.mimeData().hasImage():
            e.acceptProposedAction()

    def dragMoveEvent(self, e):
        e.acceptProposedAction()

    def dropEvent(self, e):
        for url in e.mimeData().urls():
            self.plik_upuszczony.emit(url.toLocalFile())
            return


def suwak(od: int, do: int, wartosc: int, opis_fn) -> tuple[QWidget, QSlider]:
    w = QWidget()
    lay = QHBoxLayout(w)
    lay.setContentsMargins(0, 0, 0, 0)
    s = QSlider(Qt.Horizontal)
    s.setRange(od, do)
    s.setValue(wartosc)
    etykieta = QLabel(opis_fn(wartosc))
    etykieta.setMinimumWidth(56)
    s.valueChanged.connect(lambda v: etykieta.setText(opis_fn(v)))
    lay.addWidget(s, 1)
    lay.addWidget(etykieta)
    return w, s


class Okno(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('Edytor grafik ZombieTanks — arkusz → pliki gry')
        self.obraz: Image.Image | None = None
        self.wynik: Wynik | None = None
        self.u = Ustawienia()
        self._nr = 0
        self._sygnaly = _Sygnaly()
        self._sygnaly.gotowe.connect(self._gotowe)
        self._opoznienie = QTimer(self, singleShot=True, interval=250)
        self._opoznienie.timeout.connect(self._analizuj)
        self._klatka = 0
        self._animacja = QTimer(self, interval=1000 // 12)
        self._animacja.timeout.connect(self._nastepna_klatka)
        self._animacja.start()

        self.arkusz = WidokArkusza()
        self.arkusz.plik_upuszczony.connect(self.otworz_plik)

        lewa = QWidget()
        l_lay = QVBoxLayout(lewa)
        pasek = QHBoxLayout()
        b_otworz = QPushButton('Otwórz arkusz…')
        b_wklej = QPushButton('Wklej (Ctrl+V)')
        b_dopasuj = QPushButton('Dopasuj widok')
        if ikona is not None:
            b_otworz.setIcon(ikona('szukaj'))
            b_wklej.setIcon(ikona('nowe'))
            b_dopasuj.setIcon(ikona('odswiez'))
        b_otworz.clicked.connect(self.otworz_dialog)
        b_wklej.clicked.connect(self.wklej)
        b_dopasuj.clicked.connect(
            lambda: self.arkusz.fitInView(self.arkusz.scene().itemsBoundingRect(), Qt.KeepAspectRatio)
        )
        for b in (b_otworz, b_wklej, b_dopasuj):
            pasek.addWidget(b)
        pasek.addStretch(1)
        l_lay.addLayout(pasek)
        l_lay.addWidget(self.arkusz, 1)
        legenda = QLabel(
            ' &nbsp; '.join(
                f'<span style="color:{kolor}">&#9632;</span> {opis}' for kolor, opis in KOLORY_ROL.values()
            )
        )
        legenda.setWordWrap(True)
        l_lay.addWidget(legenda)
        self.status = QLabel('Wklej arkusz (Ctrl+V), przeciągnij plik albo otwórz go przyciskiem.')
        self.status.setWordWrap(True)
        l_lay.addWidget(self.status)

        prawa = QWidget()
        p_lay = QVBoxLayout(prawa)
        p_lay.addWidget(self._panel_ustawien())
        p_lay.addWidget(self._panel_podgladu(), 1)
        zapis = QHBoxLayout()
        self.b_zapisz = QPushButton('Zapisz do gry')
        self.b_zapisz.setObjectName('primary')
        if ikona is not None:
            self.b_zapisz.setIcon(ikona('zrobione', 'tekst_na_primary'))
        self.b_zapisz.setEnabled(False)
        self.b_zapisz.clicked.connect(self.zapisz_do_gry)
        b_folder = QPushButton('Otwórz folder grafik')
        b_folder.clicked.connect(lambda: os.startfile(KATALOG_GRAFIK) if KATALOG_GRAFIK.exists() else None)
        zapis.addWidget(self.b_zapisz, 1)
        zapis.addWidget(b_folder)
        p_lay.addLayout(zapis)

        podzial = QSplitter()
        podzial.addWidget(lewa)
        przewijana = QScrollArea()
        przewijana.setWidgetResizable(True)
        przewijana.setWidget(prawa)
        podzial.addWidget(przewijana)
        podzial.setStretchFactor(0, 3)
        podzial.setStretchFactor(1, 2)
        lewa.setMinimumWidth(400)
        przewijana.setMinimumWidth(800)
        self.setCentralWidget(podzial)

        akcja = QAction(self)
        akcja.setShortcut(QKeySequence.Paste)
        akcja.triggered.connect(self.wklej)
        self.addAction(akcja)

    # ---------- panele ----------

    def _panel_ustawien(self) -> QGroupBox:
        g = QGroupBox('Wykrywanie i piksele')
        f = QFormLayout(g)
        u = self.u

        def dodaj(opis, widget, suwak_, pole, przelicz=lambda v: v):
            f.addRow(opis, widget)
            suwak_.valueChanged.connect(lambda v: self._zmien(pole, przelicz(v)))

        w, s = suwak(5, 90, u.prog_tla, str)
        dodaj('Próg tła', w, s, 'prog_tla')
        w, s = suwak(1, 21, u.domkniecie, lambda v: f'{v} px')
        dodaj('Domknięcie konturu', w, s, 'domkniecie')
        w, s = suwak(0, 25, u.odstep, lambda v: f'{v} px')
        dodaj('Dołączanie (kolce, flaga)', w, s, 'odstep')
        w, s = suwak(50, 100, int(u.wypelnienie * 100), lambda v: f'{v}%')
        dodaj('Wypełnienie siatki', w, s, 'wypelnienie', lambda v: v / 100)
        w, s = suwak(0, 32, u.kolory, lambda v: 'bez limitu' if v == 0 else str(v))
        dodaj('Kolory (paleta)', w, s, 'kolory')
        w, s = suwak(10, 90, int(u.prog_alfa * 100), lambda v: f'{v}%')
        dodaj('Pełność piksela', w, s, 'prog_alfa', lambda v: v / 100)

        siatka = QSpinBox()
        siatka.setRange(8, 64)
        siatka.setValue(u.siatka)
        siatka.valueChanged.connect(lambda v: self._zmien('siatka', v))
        f.addRow('Siatka pixel artu', siatka)
        wiersze, kolumny, poziom = QSpinBox(), QSpinBox(), QSpinBox()
        for sp, pole, zakres in (
            (wiersze, 'wiersze', (0, 10)),
            (kolumny, 'kolumny', (0, 12)),
            (poziom, 'pierwszy_poziom', (1, 5)),
        ):
            sp.setRange(*zakres)
            sp.setValue(getattr(u, pole))
            sp.setSpecialValueText('auto' if zakres[0] == 0 else '')
            sp.valueChanged.connect(lambda v, p=pole: self._zmien(p, v))
        rzad = QHBoxLayout()
        rzad.addWidget(QLabel('wiersze'))
        rzad.addWidget(wiersze)
        rzad.addWidget(QLabel('klatki'))
        rzad.addWidget(kolumny)
        rzad.addWidget(QLabel('pierwszy LV'))
        rzad.addWidget(poziom)
        f.addRow('Układ arkusza', rzad)
        strzalki = QCheckBox('usuwaj strzałki obok czołgów')
        strzalki.setChecked(u.usun_strzalki)
        strzalki.toggled.connect(lambda v: self._zmien('usun_strzalki', v))
        f.addRow('', strzalki)
        return g

    def _panel_podgladu(self) -> QGroupBox:
        g = QGroupBox('Wynik — tak to będzie wyglądać w grze (czarne tło planszy)')
        self.podglad = QGridLayout(g)
        self.podglad.setSpacing(6)
        self.ostrzezenia = QLabel('')
        self.ostrzezenia.setObjectName('ostrzezenieTekst')
        self.ostrzezenia.setWordWrap(True)
        return g

    # ---------- dane ----------

    def otworz_dialog(self):
        plik, _ = QFileDialog.getOpenFileName(
            self, 'Arkusz z czołgami', '', 'Obrazy (*.png *.webp *.jpg *.jpeg)'
        )
        if plik:
            self.otworz_plik(plik)

    def otworz_plik(self, sciezka: str):
        try:
            self.ustaw_obraz(Image.open(sciezka).convert('RGBA'), Path(sciezka).name)
        except OSError as e:
            QMessageBox.warning(self, 'Nie da się otworzyć', str(e))

    def wklej(self):
        obraz = QApplication.clipboard().image()
        if obraz.isNull():
            self.status.setText('W schowku nie ma obrazka.')
            return
        bufor = obraz.convertToFormat(QImage.Format_RGBA8888)
        dane = bytes(bufor.constBits())[: bufor.sizeInBytes()]
        pil = Image.frombuffer('RGBA', (bufor.width(), bufor.height()), dane, 'raw', 'RGBA', bufor.bytesPerLine(), 1)
        self.ustaw_obraz(pil.copy(), 'ze schowka')

    def ustaw_obraz(self, obraz: Image.Image, nazwa: str):
        self.obraz = obraz
        self.status.setText(f'Arkusz: {nazwa} ({obraz.width}×{obraz.height}) — analizuję…')
        self.arkusz.pokaz(obraz, None, self.u)
        self._analizuj()

    def _zmien(self, pole: str, wartosc):
        self.u = replace(self.u, **{pole: wartosc})
        if self.obraz is not None:
            self._opoznienie.start()

    def _analizuj(self):
        if self.obraz is None:
            return
        self._nr += 1
        QThreadPool.globalInstance().start(_Zadanie(self._nr, self.obraz, self.u, self._sygnaly))

    def _gotowe(self, nr: int, wynik):
        if nr != self._nr:
            return  # w międzyczasie zmieniono ustawienia — czekamy na nowszy wynik
        if isinstance(wynik, Exception):
            self.status.setText(f'Błąd analizy: {wynik}')
            self.b_zapisz.setEnabled(False)
            return
        self.wynik = wynik
        self.arkusz.pokaz(self.obraz, wynik, self.u)
        role = {}
        for k in wynik.kawalki:
            role[k.rola] = role.get(k.rola, 0) + 1
        self.status.setText(
            f'Wykryto {wynik.wiersze} poziomów × {wynik.kolumny} klatek · '
            f'czołgów {len(wynik.kafle)} · strzałek usuniętych {role.get("strzalka", 0)} · '
            f'napisów {role.get("napis", 0)} · skala {wynik.skala:.3f}'
        )
        self._pokaz_wynik()
        self.b_zapisz.setEnabled(bool(wynik.kafle))

    def _pokaz_wynik(self):
        while self.podglad.count():
            w = self.podglad.takeAt(0).widget()
            if w is not None:
                w.deleteLater()
        if self.wynik is None:
            return
        self._animowane: list[tuple[QLabel, list[QPixmap]]] = []
        naglowki = ['', 'klatki (plik 64 px)', 'telefon 32 px', 'TV 72 px', 'animacja · 4 kierunki']
        for i, t in enumerate(naglowki):
            e = QLabel(t)
            e.setObjectName('przygaszony')
            self.podglad.addWidget(e, 0, i)
        wiersze: dict[int, list] = {}
        for k in self.wynik.kafle:
            wiersze.setdefault(k.wiersz, []).append(k)
        for r, (w, lista) in enumerate(sorted(wiersze.items()), start=1):
            lista.sort(key=lambda k: k.kolumna)
            self.podglad.addWidget(QLabel(f'<b>LV{w + self.u.pierwszy_poziom}</b>'), r, 0)
            klatki = QLabel()
            pas = Image.new('RGBA', (len(lista) * 68, 64), (0, 0, 0, 255))
            for i, k in enumerate(lista):
                pas.alpha_composite(k.obraz, (i * 68, 0))
            klatki.setPixmap(do_pixmapy(pas, 1))
            self.podglad.addWidget(klatki, r, 1)
            maly = QLabel()
            maly.setPixmap(do_pixmapy(lista[0].obraz.resize((32, 32), Image.NEAREST), 1, '#000000'))
            self.podglad.addWidget(maly, r, 2)
            tv = QLabel()
            tv.setPixmap(do_pixmapy(lista[0].obraz.resize((72, 72), Image.NEAREST), 1, '#000000'))
            self.podglad.addWidget(tv, r, 3)
            anim = QLabel()
            klatki_anim = []
            for k in lista:
                kafel = Image.new('RGBA', (4 * 68, 64), (0, 0, 0, 255))
                for j, kat in enumerate((0, -90, 180, 90)):
                    kafel.alpha_composite(k.obraz.rotate(kat), (j * 68, 0))
                klatki_anim.append(do_pixmapy(kafel, 1))
            anim.setPixmap(klatki_anim[0])
            self._animowane.append((anim, klatki_anim))
            self.podglad.addWidget(anim, r, 4)
        if self.wynik.ostrzezenia:
            self.ostrzezenia = QLabel('Uwaga: ' + '; '.join(self.wynik.ostrzezenia))
            self.ostrzezenia.setObjectName('ostrzezenieTekst')
            self.ostrzezenia.setWordWrap(True)
            self.podglad.addWidget(self.ostrzezenia, len(wiersze) + 1, 0, 1, 5)

    def _nastepna_klatka(self):
        self._klatka += 1
        for etykieta, klatki in getattr(self, '_animowane', []):
            etykieta.setPixmap(klatki[self._klatka % len(klatki)])

    def zapisz_do_gry(self):
        if self.wynik is None or not self.wynik.kafle:
            return
        poziomy = sorted({k.wiersz + self.u.pierwszy_poziom for k in self.wynik.kafle})
        odp = QMessageBox.question(
            self,
            'Zapisz do gry',
            f'Zapisać {len(self.wynik.kafle)} klatek (LV{poziomy[0]}–LV{poziomy[-1]}) do\n'
            f'{KATALOG_GRAFIK}?\nObecne klatki tych poziomów zostaną zastąpione.',
        )
        if odp != QMessageBox.Yes:
            return
        raport = zapisz(self.wynik, self.u, KATALOG_GRAFIK)
        bledy = [r for r in raport if not r.startswith('zapisano')]
        if bledy:
            QMessageBox.warning(self, 'Zapisano z błędami kontroli', '\n'.join(bledy))
        else:
            self.status.setText(
                f'Zapisano {len(raport)} plików do public/grafiki — w trybie developera gry odśwież stronę.'
            )


def main():
    app = QApplication(sys.argv)
    if styl is not None:
        styl.zastosuj(app)
    okno = Okno()
    okno.resize(1500, 900)
    okno.showMaximized()
    if len(sys.argv) > 1:
        okno.otworz_plik(sys.argv[1])
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
