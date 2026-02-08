# MakeXPI.ps1 | Strict Version Sanity Check
# Enforces version synchronization across all files before building.

param([string]$TargetDir = ".")

# --- CONFIGURATION ---
$7z = "C:\Program Files\7-Zip\7z.exe"
$ManifestFile = "manifest.json"
$FilesToCheck = @(
    @{ Path = "background.js"; Pattern = "Version:\s*([\d\.]+)" },
    @{ Path = "report.js";     Pattern = "Version:\s*([\d\.]+)" },
    @{ Path = "report.html";   Pattern = "Order Extractor v([\d\.]+)" }
)

if (Test-Path $TargetDir) { Set-Location $TargetDir } else { Write-Host "Path not found"; exit }

# --- 1. ESTABLISH SOURCE OF TRUTH ---
if (-not (Test-Path $ManifestFile)) { Write-Host "Error: manifest.json not found!" -ForegroundColor Red; exit }
$json = Get-Content $ManifestFile -Raw | ConvertFrom-Json
$ManifestVer = $json.version

Write-Host "Target Version (from Manifest): $ManifestVer" -ForegroundColor Cyan
$HasErrors = $false

# --- 2. SANITY CHECK ---
foreach ($file in $FilesToCheck) {
    if (Test-Path $file.Path) {
        $content = Get-Content $file.Path -Raw
        if ($content -match $file.Pattern) {
            $FoundVer = $matches[1]
            
            if ($FoundVer -eq $ManifestVer) {
                Write-Host "  [OK] $($file.Path) matches ($FoundVer)" -ForegroundColor Gray
            } else {
                Write-Host "  [FAIL] $($file.Path) is v$FoundVer (Expected v$ManifestVer)" -ForegroundColor Red
                $HasErrors = $true
            }
        } else {
            Write-Host "  [WARN] Could not find version string in $($file.Path)" -ForegroundColor Yellow
            $HasErrors = $true
        }
    } else {
        Write-Host "  [MISSING] $($file.Path) not found" -ForegroundColor Red
        $HasErrors = $true
    }
}

if ($HasErrors) {
    Write-Host "`nBUILD ABORTED: Version mismatch detected." -ForegroundColor Red
    Write-Host "Please update the files listed above to match manifest.json (v$ManifestVer)." -ForegroundColor White
    exit 1
}

# --- 3. CLEAN UP OLD BUILDS ---
$OutDir = Join-Path $TargetDir "out"
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$OldXPIs = Get-ChildItem -Path $OutDir -Filter "*.xpi"
if ($OldXPIs.Count -gt 0) {
    $BackupZip = Join-Path $OutDir "Backups.7z"
    & $7z a "$BackupZip" ($OldXPIs.FullName) | Out-Null
    $OldXPIs | Remove-Item -Force
}

# --- 4. PACKAGE XPI ---
$XpiName = "OrderExtractor_v$ManifestVer.xpi"
$XpiPath = Join-Path $OutDir $XpiName

Write-Host "`nVersions synchronized. Packaging $XpiName..." -ForegroundColor Green

$Exclude = @("*.git*", "*.ps1", "package*.json", "*.xpi", "node_modules", "out", ".eslintrc*", "icon-src", "*.7z", ".vscode")
$ExcludeArgs = $Exclude | ForEach-Object { "-xr!$_" }

& $7z a -tzip "$XpiPath" * $ExcludeArgs | Out-Null

if (Test-Path $XpiPath) { 
    Write-Host "SUCCESS: Created $XpiPath" -ForegroundColor Cyan 
}
