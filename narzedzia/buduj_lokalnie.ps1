# Korzystamy z narzedzi juz zainstalowanych w projekcie; start gry nie instaluje pakietow.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$tscFile = Join-Path $projectRoot 'node_modules\typescript\bin\tsc'
$viteFile = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
foreach ($toolFile in @($tscFile, $viteFile)) {
    if (-not (Test-Path -LiteralPath $toolFile)) {
        throw 'Brak zaleznosci projektu. W katalogu gry wykonaj pnpm install.'
    }
}
Push-Location $projectRoot
try {
    & $nodeExe $tscFile --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'Blad sprawdzania TypeScript' }
    & $nodeExe $viteFile build --base ./ --outDir www --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw 'Blad budowania gry' }
    & $nodeExe $viteFile build --ssr server/main.ts --outDir dist-server --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw 'Blad budowania serwera lokalnego' }
    & $nodeExe (Join-Path $projectRoot 'dist-server\main.js') --check-config
    if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie sprawdzic konfiguracji. Dokladna przyczyna (pole i zakres) jest w komunikacie powyzej.' }
} finally {
    Pop-Location
}
