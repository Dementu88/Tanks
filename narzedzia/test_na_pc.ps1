# Lokalna gra: build -> (re)start lokalnego serwera w tle -> wybrana strona.
# (telewizor + pad obok siebie, pad z klawiatury).
#   -BezBudowania   pomija budowanie (gdy nic nie zmieniales w kodzie)
#   -Strona dev     zamiast #/test otwiera tryb developera (#/dev)
param([switch]$BezBudowania, [ValidateSet('test', 'dev', 'pc')][string]$Strona = 'test', [switch]$BezOtwierania)

$ErrorActionPreference = 'Stop'
$Port = 8090
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:Path = "C:\Program Files\nodejs;$env:USERPROFILE\.local\bin;$env:Path"

if (-not $BezBudowania) {
    Write-Host '== Budowanie' -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'buduj_lokalnie.ps1')
}

# stary serwer na tym porcie (tylko node) zatrzymujemy, zeby wystartowal z nowym kodem
$stary = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $stary) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
    if ($p -and $p.ProcessName -eq 'node' -and $processInfo.CommandLine -match 'dist-server[\\/]main\.js') {
        Write-Host "== Zatrzymuje stary serwer (PID $id)" -ForegroundColor Cyan
        Stop-Process -Id $id -Force
    } elseif ($p) {
        throw "Port $Port zajmuje inny program: $($p.ProcessName)"
    }
}

Write-Host "== Start serwera na porcie $Port (w tle)" -ForegroundColor Cyan
$serverFile = Join-Path $Root 'dist-server\main.js'
if (-not (Test-Path -LiteralPath $serverFile)) { throw 'Brak zbudowanej gry. Uruchom bez -BezBudowania.' }
$logDir = Join-Path $Root 'staging'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$serverProcess = Start-Process -FilePath (Get-Command node.exe).Source `
    -ArgumentList @(('"' + $serverFile + '"'), '--port', "$Port") `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir 'local-server.log') `
    -RedirectStandardError (Join-Path $logDir 'local-server-error.log')

$url = "http://localhost:$Port/"
$ready = $false
for ($i = 0; $i -lt 50; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 200 }
}

if (-not $ready) { throw "Serwer nie uruchomil sie. Szczegoly: $logDir\local-server-error.log" }
if (-not $BezOtwierania) { Start-Process "http://localhost:$Port/#/$Strona" }
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "Otwarte:     http://localhost:$Port/#/$Strona" -ForegroundColor Green
if ($ip) { Write-Host "TV w domu:   http://${ip}:$Port/tv" -ForegroundColor Green }
