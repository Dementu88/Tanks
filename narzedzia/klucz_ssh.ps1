# Klucz SSH do Mikrusa: tworzy go, jesli nie ma, i kopiuje czesc publiczna do schowka.
# Klucz publiczny wklej czatowi (ZADANIE...md, krok 1), wtedy aktualizacja nie pyta o haslo.
$ErrorActionPreference = 'Stop'
$klucz = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
if (-not (Test-Path $klucz)) {
    New-Item -ItemType Directory -Force (Split-Path $klucz) | Out-Null
    & "$env:SystemRoot\System32\OpenSSH\ssh-keygen.exe" -t ed25519 -f $klucz -N '""' -C "zombietanks-$env:COMPUTERNAME"
    if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen nie zadzialal' }
}
$publiczny = (Get-Content "$klucz.pub" -Raw).Trim()
Set-Clipboard -Value $publiczny
Write-Host "Klucz publiczny (skopiowany do schowka):`n" -ForegroundColor Cyan
Write-Host $publiczny
Write-Host "`nTo NIE jest tajne - mozesz go wkleic czatowi. Pliku bez .pub nie wysylaj nikomu." -ForegroundColor Yellow
