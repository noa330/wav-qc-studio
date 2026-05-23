$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$FrontendDir = Join-Path $Root "frontend"
$PackageJson = Join-Path $FrontendDir "package.json"
$NodeDir = Join-Path $Root ".tools\node-v24.14.0-win-x64"
$BundledNpm = Join-Path $NodeDir "npm.cmd"
$ElectronExe = Join-Path $FrontendDir "node_modules\electron\dist\electron.exe"
$ElectronBuilderBin = Join-Path $FrontendDir "node_modules\.bin\electron-builder.cmd"
$TempDir = Join-Path $Root ".tmp"

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$env:TEMP = $TempDir
$env:TMP = $TempDir

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$FailureMessage
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        if ([string]::IsNullOrWhiteSpace($FailureMessage)) {
            throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
        }
        throw $FailureMessage
    }
}

function Resolve-Npm {
    $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($systemNpm) {
        return [pscustomobject]@{
            Path = $systemNpm.Source
            UsesBundledNode = $false
        }
    }

    if (Test-Path $BundledNpm) {
        return [pscustomobject]@{
            Path = $BundledNpm
            UsesBundledNode = $true
        }
    }

    throw "npm was not found. Expected system npm or bundled npm at: $BundledNpm"
}

try {
    if (-not (Test-Path $PackageJson)) {
        throw "frontend package.json was not found: $PackageJson"
    }

    $package = Get-Content -Raw -LiteralPath $PackageJson | ConvertFrom-Json
    $InstallerPath = Join-Path $FrontendDir "release\wav-qc-studio-$($package.version)-setup.exe"

    $npmInfo = Resolve-Npm
    $Npm = [string]$npmInfo.Path
    if ($npmInfo.UsesBundledNode) {
        $env:Path = "$NodeDir;$env:Path"
    }
    Write-Host "Using npm: $Npm"

    Write-Host "[1/3] Checking installer build dependencies..."
    if (-not ((Test-Path $ElectronExe) -and (Test-Path $ElectronBuilderBin))) {
        Push-Location $FrontendDir
        try {
            Invoke-Native -FilePath $Npm -Arguments @("install") -FailureMessage "npm install failed."
        }
        finally {
            Pop-Location
        }
    }

    if (-not (Test-Path $ElectronExe)) {
        throw "Electron executable was not found after dependency check: $ElectronExe"
    }

    if (-not (Test-Path $ElectronBuilderBin)) {
        throw "electron-builder was not found after dependency check: $ElectronBuilderBin"
    }

    Write-Host "[2/3] Building Windows installer..."
    Push-Location $FrontendDir
    try {
        Invoke-Native -FilePath $Npm -Arguments @("run", "build:installer") -FailureMessage "installer build failed."
    }
    finally {
        Pop-Location
    }

    Write-Host "[3/3] Verifying installer artifact..."
    if (-not (Test-Path $InstallerPath)) {
        throw "Build finished, but installer was not found: $InstallerPath"
    }

    $installer = Get-Item -LiteralPath $InstallerPath
    $sizeMb = [math]::Round($installer.Length / 1MB, 1)
    Write-Host "Installer built successfully:"
    Write-Host "  $($installer.FullName)"
    Write-Host "  Size: $sizeMb MB"
    exit 0
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
