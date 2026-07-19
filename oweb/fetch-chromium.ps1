# Download Chromium source for BrowserOS (Windows)
# Run once:  .\oweb\fetch-chromium.ps1
# Needs ~100 GB on C: and several hours.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Run .\oweb\setup-windows.ps1 first." -ForegroundColor Red
    exit 1
}

$chromiumSrc = if ($env:CHROMIUM_SRC) { $env:CHROMIUM_SRC } else { "C:\src\chromium\src" }
Write-Host "==> Chromium will be provisioned at: $chromiumSrc" -ForegroundColor Cyan
Write-Host "    This takes hours and ~100 GB. Go get coffee." -ForegroundColor Yellow

Push-Location packages\browseros
uv run browseros setup --chromium-src $chromiumSrc
Pop-Location

Write-Host "Done. Now run: .\oweb\build-windows.ps1" -ForegroundColor Green
