param([switch]$BezOtwierania)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:5174/battle-city/#/sterowanie'
$vitePath = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'

function Open-Poligon {
    Write-Host "Strona: $url" -ForegroundColor Cyan
    if (-not $BezOtwierania) {
        try { Start-Process $url }
        catch { Write-Warning "Nie udalo sie otworzyc przegladarki. Otworz recznie: $url" }
    }
}

function Use-ExistingPoligon {
    $listeners = @(Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $false }

    # IPv4 odpowiada adresowi --host 0.0.0.0; localhost moze najpierw probowac IPv6.
    $ready = $false
    try {
        $page = Invoke-WebRequest 'http://127.0.0.1:5174/battle-city/' -UseBasicParsing -TimeoutSec 5
        $ready = $page.StatusCode -eq 200 -and $page.Content -match '<title>Battle City'
    } catch { }

    $ourServer = $false
    foreach ($ownerId in ($listeners.OwningProcess | Sort-Object -Unique)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue
        if ($process.Name -eq 'node.exe' -and $process.CommandLine -and
            $process.CommandLine.Replace('/', '\').IndexOf($vitePath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $ourServer = $true
        }
    }

    if (-not $ready -and -not $ourServer) {
        throw "Port 5174 zajmuje inny program (PID: $($listeners.OwningProcess -join ', ')). Nie uruchamiam drugiego serwera."
    }
    Write-Host 'Poligon sterowania juz dziala na porcie 5174.' -ForegroundColor Green
    if (-not $ready) {
        Write-Warning 'Proces poligonu dziala, ale strona jeszcze nie odpowiada. Jesli sie nie zaladuje, odswiez ja za chwile.'
    }
    Open-Poligon
    return $true
}

try {
    if (Use-ExistingPoligon) { exit 0 }
    Set-Location $projectRoot
    Write-Host "Uruchamiam poligon: $url" -ForegroundColor Cyan
    $viteArgs = @($vitePath, '--host', '0.0.0.0', '--port', '5174', '--strictPort')
    if (-not $BezOtwierania) { $viteArgs += @('--open', $url) }
    & node.exe @viteArgs
    $serverExitCode = $LASTEXITCODE
    # Drugie uruchomienie moglo zajac port juz po pierwszym sprawdzeniu.
    if ($serverExitCode -ne 0 -and (Use-ExistingPoligon)) { exit 0 }
    exit $serverExitCode
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
