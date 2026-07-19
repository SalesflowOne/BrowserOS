# Build OWeb Browser for Windows (debug, unsigned)
# Run:  .\oweb\build-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Run .\oweb\setup-windows.ps1 first." -ForegroundColor Red
    exit 1
}

$chromiumSrc = if ($env:CHROMIUM_SRC) { $env:CHROMIUM_SRC } else { "C:\src\chromium\src" }
if (-not (Test-Path $chromiumSrc)) {
    Write-Host "Chromium not found at $chromiumSrc" -ForegroundColor Red
    Write-Host "Run .\oweb\fetch-chromium.ps1 first." -ForegroundColor Yellow
    exit 1
}

Write-Host "==> Building OWeb Browser (debug, x64)..." -ForegroundColor Cyan
Push-Location packages\browseros
uv run browseros build --preset debug --product oweb --arch x64 --chromium-src $chromiumSrc
Pop-Location

Write-Host ""
Write-Host "Build finished. Check packages\browseros output for OWebBrowser.exe / installer." -ForegroundColor Green
