$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$FrontendDir = Join-Path $Root "frontend"
$PackageJson = Join-Path $FrontendDir "package.json"
$NodeVersion = "24.14.0"
$BundledNodeDir = Join-Path $Root ".tools\node-v$NodeVersion-win-x64"
$NodeDirCandidates = @(
    $BundledNodeDir,
    (Join-Path $Root "tools\nodejs"),
    (Join-Path (Split-Path -Parent $Root) "tools\nodejs")
)
$ElectronExe = Join-Path $FrontendDir "node_modules\electron\dist\electron.exe"
$MainBundle = Join-Path $FrontendDir "out\main\index.js"
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

function Resolve-BundledNodeDir {
    return $NodeDirCandidates | Where-Object {
        (Test-Path (Join-Path $_ "node.exe")) -and (Test-Path (Join-Path $_ "npm.cmd"))
    } | Select-Object -First 1
}

function Install-BundledNode {
    $nodeZipName = "node-v$NodeVersion-win-x64.zip"
    $nodeZipUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeZipName"
    $toolsDir = Join-Path $Root ".tools"
    $nodeZipPath = Join-Path $TempDir $nodeZipName

    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

    Write-Host "Node.js/npm was not found. Installing portable Node.js v$NodeVersion..."
    Write-Host "Downloading: $nodeZipUrl"
    Invoke-WebRequest -Uri $nodeZipUrl -OutFile $nodeZipPath

    Write-Host "Extracting: $nodeZipPath"
    Expand-Archive -LiteralPath $nodeZipPath -DestinationPath $toolsDir -Force

    if (-not (Test-Path (Join-Path $BundledNodeDir "npm.cmd"))) {
        throw "Node.js install finished, but npm.cmd was not found: $BundledNodeDir"
    }

    return $BundledNodeDir
}

function Resolve-Npm {
    $nodeDir = Resolve-BundledNodeDir
    if ($nodeDir) {
        return [pscustomobject]@{
            Path = Join-Path $nodeDir "npm.cmd"
            NodeDir = $nodeDir
        }
    }

    $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($systemNpm) {
        return [pscustomobject]@{
            Path = $systemNpm.Source
            NodeDir = $null
        }
    }

    $nodeDir = Install-BundledNode
    return [pscustomobject]@{
        Path = Join-Path $nodeDir "npm.cmd"
        NodeDir = $nodeDir
    }
}

try {
    if (-not (Test-Path $PackageJson)) {
        throw "frontend package.json was not found: $PackageJson"
    }

    $npmInfo = Resolve-Npm
    $Npm = [string]$npmInfo.Path
    if ($npmInfo.NodeDir) {
        $env:Path = "$($npmInfo.NodeDir);$env:Path"
    }
    Write-Host "Using npm: $Npm"

    Write-Host "[1/3] Checking Electron frontend dependencies..."
    if (-not (Test-Path $ElectronExe)) {
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

    Write-Host "[2/3] Building Electron frontend..."
    Push-Location $FrontendDir
    try {
        Invoke-Native -FilePath $Npm -Arguments @("run", "build") -FailureMessage "frontend build failed."
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path $MainBundle)) {
        throw "Build finished, but Electron main bundle was not found: $MainBundle"
    }

    Write-Host "[3/3] Launching Electron frontend..."
    $process = Start-Process -FilePath $ElectronExe -ArgumentList @($FrontendDir) -WorkingDirectory $FrontendDir -PassThru
    Start-Sleep -Seconds 4

    $alive = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if (-not $alive) {
        throw "Electron exited immediately after launch."
    }

    Write-Host "Electron started. PID: $($alive.Id)"
    exit 0
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
