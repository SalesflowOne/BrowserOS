# OWeb Browser — Windows setup
# Run from repo root:  .\oweb\setup-windows.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "==> OWeb Browser Windows setup" -ForegroundColor Cyan

# Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Python 3.12+ required. https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

# Pillow for icons
python -m pip install --upgrade pip pillow -q
python oweb\generate-icons.py

# uv (BrowserOS build CLI)
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "==> Installing uv..."
    irm https://astral.sh/uv/install.ps1 | iex
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

# Copy icon tree from browseros template if missing win/linux dirs
$owebIcons = "packages\browseros\resources\oweb\icons"
$srcIcons = "packages\browseros\resources\browseros\icons"
if (-not (Test-Path "$owebIcons\win") -and (Test-Path $srcIcons)) {
    Write-Host "==> Copying Windows icon scaffolding from browseros template..."
    foreach ($dir in @("win", "linux", "mac", "default_100_percent", "default_200_percent", "chromeos")) {
        if (Test-Path "$srcIcons\$dir") {
            Copy-Item -Recurse -Force "$srcIcons\$dir" "$owebIcons\$dir"
        }
    }
}

Write-Host "==> Syncing Python deps (packages\browseros)..."
Push-Location packages\browseros
uv sync
Write-Host "==> Validating OWeb product..."
uv run browseros product doctor oweb
$doctorExit = $LASTEXITCODE
Pop-Location

if ($doctorExit -ne 0) {
    Write-Host "product doctor reported issues — fix above, then re-run setup." -ForegroundColor Yellow
    exit $doctorExit
}

Write-Host ""
Write-Host "Setup OK. Next steps:" -ForegroundColor Green
Write-Host "  .\oweb\fetch-chromium.ps1   # once, downloads ~100GB"
Write-Host "  .\oweb\build-windows.ps1      # compile OWeb Browser"
