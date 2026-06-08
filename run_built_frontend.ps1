$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$FrontendDir = Join-Path $Root "frontend"
$NodeDirCandidates = @(
    (Join-Path $Root ".tools\node-v24.14.0-win-x64"),
    (Join-Path $Root "tools\nodejs"),
    (Join-Path (Split-Path -Parent $Root) "tools\nodejs")
)
$NodeDir = $NodeDirCandidates | Where-Object { Test-Path (Join-Path $_ "node.exe") } | Select-Object -First 1
$ElectronExe = Join-Path $FrontendDir "node_modules\electron\dist\electron.exe"
$MainBundle = Join-Path $FrontendDir "out\main\index.js"
$RendererIndex = Join-Path $FrontendDir "out\renderer\index.html"
$TempDir = Join-Path $Root ".tmp"

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$env:TEMP = $TempDir
$env:TMP = $TempDir

try {
    if (-not (Test-Path $FrontendDir)) {
        throw "frontend directory was not found: $FrontendDir"
    }

    if (-not (Test-Path $ElectronExe)) {
        throw "Electron executable was not found: $ElectronExe. Run build_and_run_frontend.bat once first."
    }

    if (-not (Test-Path $MainBundle)) {
        throw "Built Electron main bundle was not found: $MainBundle. Run build_and_run_frontend.bat first."
    }

    if (-not (Test-Path $RendererIndex)) {
        throw "Built renderer index was not found: $RendererIndex. Run build_and_run_frontend.bat first."
    }

    if ($NodeDir) {
        $env:Path = "$NodeDir;$env:Path"
    }

    Write-Host "Launching already-built Electron frontend..."
    $process = Start-Process -FilePath $ElectronExe -ArgumentList @($FrontendDir) -WorkingDirectory $FrontendDir -PassThru
    Start-Sleep -Seconds 2

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
