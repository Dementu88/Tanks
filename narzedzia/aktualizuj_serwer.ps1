# Serwer gry na Mikrusie: aktualizacja (testy -> build -> paczka -> SSH) oraz wlaczanie/wylaczanie gry.
# Uruchamiane z aktualizuj_serwer.bat. Bez parametrow pokazuje menu. Parametry:
#   -BezTestow     aktualizacja bez pnpm test
#   -TylkoPaczka   buduje deploy\battle-city-party.tar.gz, niczego nie wysyla
#   -Online        wlacza gre (usluga startuje, takze po restarcie serwera)
#   -Offline       wylacza gre (usluga stoi, takze po restarcie serwera)
#   -Status        pokazuje stan gry na serwerze
#   -DodajProfil "Nazwa"   dopisuje profil druzyny do config\profile.json (potem Aktualizuj gre)
#   -Profile       pokazuje liste profili
param([switch]$BezTestow, [switch]$TylkoPaczka, [switch]$Online, [switch]$Offline, [switch]$Status,
      [string]$DodajProfil = '', [switch]$Profile)

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
            '0' { exit 0 }
            default { Write-Host 'Nieznana opcja' -ForegroundColor Yellow }
        }
    } catch {
        Write-Host "BLAD: $_" -ForegroundColor Red
    }
}
