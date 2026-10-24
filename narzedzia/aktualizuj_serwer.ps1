# Serwer gry na Mikrusie: aktualizacja (testy -> build -> paczka -> SSH) oraz wlaczanie/wylaczanie gry.
# Uruchamiane z aktualizuj_serwer.bat. Bez parametrow pokazuje menu. Parametry:
#   -BezTestow     aktualizacja bez pnpm test
#   -TylkoPaczka   buduje deploy\battle-city-party.tar.gz, niczego nie wysyla
#   -Online        wlacza gre (usluga startuje, takze po restarcie serwera)
#   -Offline       wylacza gre (usluga stoi, takze po restarcie serwera)
#   -Status        pokazuje stan gry na serwerze
#   -DodajProfil "Nazwa"   dopisuje profil druzyny do config\profile.json (potem Aktualizuj gre)
#   -Profile       pokazuje liste profili
#   -Gracze        pokazuje profile graczy (dodawanie / edycja / usuwanie: menu 9-12)
param([switch]$BezTestow, [switch]$TylkoPaczka, [switch]$Online, [switch]$Offline, [switch]$Status,
      [string]$DodajProfil = '', [switch]$Profile, [switch]$Gracze)

$ErrorActionPreference = 'Stop'

# ---- ustawienia serwera ----
$Serwer = 'srv42.mikr.us'
$PortSsh = 10174
$Uzytkownik = 'root'
$Katalog = '/srv/projects/battle-city'
$Usluga = 'battle-city'
$PortGry = 8091
# ----------------------------

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:Path = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:Path"
$Ssh = "$env:SystemRoot\System32\OpenSSH\ssh.exe"

function Krok($tekst) { Write-Host "`n== $tekst" -ForegroundColor Cyan }
function Uruchom($exe, [string[]]$argumenty) {
    & $exe @argumenty
    if ($LASTEXITCODE -ne 0) { throw "$exe $argumenty -> kod $LASTEXITCODE" }
}

# Klucz SSH pozwala wylacznie na kontrolowany program na serwerze (battle-city-deploy),
# ktory przyjmuje tylko te komendy: deploy-battle-city, battle-city-online/offline/status.
function Serwer($komenda) {
    & $Ssh -p $PortSsh "$Uzytkownik@$Serwer" $komenda
    if ($LASTEXITCODE -ne 0) { throw "ssh $komenda -> kod $LASTEXITCODE" }
}

function Aktualizuj([bool]$zTestami, [bool]$tylkoPaczka) {
    if ($zTestami) {
        Krok 'Testy'
        Uruchom 'node.exe' @((Join-Path $Root 'node_modules\vitest\vitest.mjs'), 'run')
    }

    Krok 'Budowanie gry i serwera (ustawienia z config\rozgrywka.json i config\gra.json)'
    & (Join-Path $PSScriptRoot 'buduj_lokalnie.ps1')

    Krok 'Pakowanie'
    $pkg = [IO.Path]::GetFullPath((Join-Path $Root 'deploy\pkg'))
    $expectedPkg = [IO.Path]::GetFullPath((Join-Path $Root 'deploy\pkg'))
    if ($pkg -ne $expectedPkg -or -not $pkg.StartsWith([IO.Path]::GetFullPath($Root) + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Nieprawidlowy katalog pakowania'
    }
    if (Test-Path -LiteralPath $pkg) { Remove-Item -LiteralPath $pkg -Recurse -Force }
    New-Item -ItemType Directory -Force (Join-Path $pkg 'dist-server') | Out-Null
    Copy-Item (Join-Path $Root 'www') $pkg -Recurse
    Copy-Item (Join-Path $Root 'dist-server\main.js') (Join-Path $pkg 'dist-server')
    # bez BOM: node czyta package.json jako czysty JSON
    $manifest = @{ name = 'battle-city-party'; version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version; private = $true; type = 'module' }
    [IO.File]::WriteAllText((Join-Path $pkg 'package.json'), ($manifest | ConvertTo-Json))
    $paczka = Join-Path $Root 'deploy\battle-city-party.tar.gz'
    if (Test-Path $paczka) { Remove-Item $paczka -Force }
    Uruchom "$env:SystemRoot\System32\tar.exe" @('-czf', $paczka, '-C', $pkg, '.')
    $rozmiar = [math]::Round((Get-Item $paczka).Length / 1KB)
    Write-Host "Paczka: $paczka ($rozmiar KB)"

    if ($tylkoPaczka) { return }

    Krok "Wysylanie na $Uzytkownik@${Serwer}:$PortSsh"
    # haslo (jesli nie ma klucza) ssh pyta z konsoli, a stdin to paczka
    $proc = Start-Process -FilePath $Ssh `
        -ArgumentList @('-p', $PortSsh, "$Uzytkownik@$Serwer", 'deploy-battle-city') `
        -RedirectStandardInput $paczka -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "ssh -> kod $($proc.ExitCode)" }

    Krok 'Gotowe'
    Write-Host 'Oczekiwane: "usluga: active" i "http: 200" (albo "offline", jesli gra jest wylaczona).' -ForegroundColor Green
    Write-Host 'Na TV i telefonach odswiez strone (nowa wersja).' -ForegroundColor Green
}

function GraOnline {
    Krok 'Wlaczanie gry (online)'
    Serwer 'battle-city-online'
}
function GraOffline {
    Krok 'Wylaczanie gry (offline)'
    Serwer 'battle-city-offline'
}
function GraStatus {
    Krok 'Stan gry na serwerze'
    Serwer 'battle-city-status'
}

# ---- profile druzyny (config\profile.json; postep zapisuje sam serwer) ----
$PlikProfili = Join-Path $Root 'config\profile.json'

function CzytajProfile {
    $dane = Get-Content -Raw -Encoding UTF8 $PlikProfili | ConvertFrom-Json
    return $dane
}
function PokazProfile {
    $dane = CzytajProfile
    Krok 'Profile druzyny'
    $i = 1
    foreach ($n in $dane.profile) { Write-Host ("  {0}. {1}" -f $i, $n); $i++ }
}
function DodajProfil($nazwa) {
    $nazwa = "$nazwa".Trim()
    if ($nazwa -notmatch '^[\p{L}\p{N} _-]{1,24}$') {
        throw 'Nazwa profilu: 1-24 znaki (litery, cyfry, spacja, - lub _)'
    }
    $dane = CzytajProfile
    $lista = @($dane.profile)
    if ($lista -contains $nazwa) {
        Write-Host "Profil '$nazwa' juz jest." -ForegroundColor Yellow
        return
    }
    $dane.profile = @($lista + $nazwa)
    $json = $dane | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($PlikProfili, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Dodano profil '$nazwa'." -ForegroundColor Green
    Write-Host 'Lokalnie: uruchom_lokalnie.bat. Na serwer: opcja 1 (Aktualizuj gre).' -ForegroundColor Green
}

# ---- profile graczy (config\gracze.json; statystyki zapisuje sam serwer) ----
$PlikGraczy = Join-Path $Root 'config\gracze.json'
$PlikLog = Join-Path $Root 'config\loga.json'

function ZapiszJson($sciezka, $dane) {
    $json = $dane | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($sciezka, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}
function CzytajGraczy { return (Get-Content -Raw -Encoding UTF8 $PlikGraczy | ConvertFrom-Json) }
function ListaLog { return @((Get-Content -Raw -Encoding UTF8 $PlikLog | ConvertFrom-Json).loga) }

function PokazGraczy {
    $dane = CzytajGraczy
    Krok 'Profile graczy'
    $i = 1
    foreach ($g in @($dane.gracze)) {
        Write-Host ("  {0}. {1}  (logo: {2}, id: {3})" -f $i, $g.nazwa, $g.logo, $g.id)
        $i++
    }
    if ($i -eq 1) { Write-Host '  (brak)' }
}
function WybierzLogo($obecne) {
    $loga = ListaLog
    $i = 1
    foreach ($l in $loga) { Write-Host ("  {0}. {1}" -f $i, $l.nazwa); $i++ }
    $nr = Read-Host "Logo (numer, Enter = $obecne)"
    if ($nr -eq '') { return $obecne }
    $n = [int]$nr
    if ($n -lt 1 -or $n -gt $loga.Count) { throw 'Nie ma takiego logo' }
    return $loga[$n - 1].id
}
function SprawdzNazwe($nazwa) {
    $nazwa = "$nazwa".Trim()
    if ($nazwa -notmatch '^[\p{L}\p{N} _-]{1,24}$') {
        throw 'Nazwa gracza: 1-24 znaki (litery, cyfry, spacja, - lub _)'
    }
    return $nazwa
}
function NoweId($nazwa, $zajete) {
    $baza = $nazwa.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
    $baza = ($baza -replace '\p{Mn}', '') -replace [char]0x0142, 'l' -replace '[^a-z0-9]+', '-'
    $baza = $baza.Trim('-')
    if ($baza -eq '') { $baza = 'gracz' }
    if ($baza.Length -gt 20) { $baza = $baza.Substring(0, 20) }
    $id = $baza
    $k = 2
    while ($zajete -contains $id) { $id = "$baza-$k"; $k++ }
    return $id
}
function DodajGracza {
    $nazwa = SprawdzNazwe (Read-Host 'Nazwa nowego gracza')
    $dane = CzytajGraczy
    $lista = @($dane.gracze)
    if (@($lista | Where-Object { $_.nazwa -eq $nazwa }).Count -gt 0) { throw "Gracz '$nazwa' juz jest" }
    $logo = WybierzLogo ((ListaLog)[0].id)
    $id = NoweId $nazwa @($lista | ForEach-Object { $_.id })
    $dane.gracze = @($lista + [pscustomobject]@{ id = $id; nazwa = $nazwa; logo = $logo })
    ZapiszJson $PlikGraczy $dane
    Write-Host "Dodano gracza '$nazwa'. Lokalnie: uruchom_lokalnie.bat. Na serwer: opcja 1." -ForegroundColor Green
}
function WybierzGracza($dane) {
    PokazGraczy
    $lista = @($dane.gracze)
    $nr = [int](Read-Host 'Numer gracza')
    if ($nr -lt 1 -or $nr -gt $lista.Count) { throw 'Nie ma takiego gracza' }
    return $nr - 1
}
function EdytujGracza {
    $dane = CzytajGraczy
    $i = WybierzGracza $dane
    $g = @($dane.gracze)[$i]
    $nowa = Read-Host "Nowa nazwa (Enter = $($g.nazwa))"
    if ($nowa -ne '') { $g.nazwa = SprawdzNazwe $nowa }
    $g.logo = WybierzLogo $g.logo
    ZapiszJson $PlikGraczy $dane
    Write-Host 'Zapisano. Statystyki zostaja (trzymane po id).' -ForegroundColor Green
}
function UsunGracza {
    $dane = CzytajGraczy
    $i = WybierzGracza $dane
    $lista = [System.Collections.ArrayList]@($dane.gracze)
    $g = $lista[$i]
    if ((Read-Host "Usunac '$($g.nazwa)'? (t/n)") -ne 't') { return }
    $lista.RemoveAt($i)
    $dane.gracze = @($lista)
    ZapiszJson $PlikGraczy $dane
    Write-Host "Usunieto '$($g.nazwa)'. Jego statystyki zostaja w pliku danych serwera." -ForegroundColor Green
}

if ($Gracze) { PokazGraczy; exit 0 }
if ($Profile) { PokazProfile; exit 0 }
if ($DodajProfil -ne '') { DodajProfil $DodajProfil; exit 0 }
if ($Online) { GraOnline; exit 0 }
if ($Offline) { GraOffline; exit 0 }
if ($Status) { GraStatus; exit 0 }
if ($BezTestow -or $TylkoPaczka) { Aktualizuj (-not $BezTestow) $TylkoPaczka; exit 0 }

while ($true) {
    Write-Host ''
    Write-Host '=== Serwer gry ZombieTanks ===' -ForegroundColor Red
    Write-Host '  1  Aktualizuj gre (z testami)'
    Write-Host '  2  Aktualizuj gre bez testow'
    Write-Host '  3  Wlacz gre (ONLINE)'
    Write-Host '  4  Wylacz gre (OFFLINE)'
    Write-Host '  5  Stan gry'
    Write-Host '  6  Tylko zbuduj paczke'
    Write-Host '  7  Dodaj profil druzyny'
    Write-Host '  8  Lista profili'
    Write-Host '  9  Gracze: lista'
    Write-Host ' 10  Gracze: dodaj'
    Write-Host ' 11  Gracze: edytuj (nazwa, logo)'
    Write-Host ' 12  Gracze: usun'
    Write-Host '  0  Wyjscie'
    $wybor = Read-Host 'Wybierz'
    try {
        switch ($wybor) {
            '1' { Aktualizuj $true $false }
            '2' { Aktualizuj $false $false }
            '3' { GraOnline }
            '4' { GraOffline }
            '5' { GraStatus }
            '6' { Aktualizuj $false $true }
            '7' { DodajProfil (Read-Host 'Nazwa nowego profilu') }
            '8' { PokazProfile }
            '9' { PokazGraczy }
            '10' { DodajGracza }
            '11' { EdytujGracza }
            '12' { UsunGracza }
            '0' { exit 0 }
            default { Write-Host 'Nieznana opcja' -ForegroundColor Yellow }
        }
    } catch {
        Write-Host "BLAD: $_" -ForegroundColor Red
    }
}
