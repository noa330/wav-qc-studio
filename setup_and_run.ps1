param(
    [string]$InstallMain = "true",
    [string]$InstallNoise = "true",
    [string]$InstallSlice = "true"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
}
catch {
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$TempDir = Join-Path $Root ".tmp"
$PipCacheDir = Join-Path $TempDir "pip-cache"
New-Item -ItemType Directory -Force -Path $TempDir, $PipCacheDir | Out-Null
$env:TEMP = $TempDir
$env:TMP = $TempDir
$env:PIP_CACHE_DIR = $PipCacheDir
$env:PIP_NO_INPUT = "1"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONLEGACYWINDOWSSTDIO = "0"

$VenvDir = Join-Path $Root ".venv"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
$NoiseVenvDir = Join-Path $Root ".venv_noise"
$NoiseVenvPy = Join-Path $NoiseVenvDir "Scripts\python.exe"
$SlicerVenvDir = Join-Path $Root ".ven_slice"
$SlicerVenvPy = Join-Path $SlicerVenvDir "Scripts\python.exe"
$PythonInstallUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
$BundledPythonInstaller = Join-Path $Root "python-3.11.9-amd64.exe"

$script:TorchIndexUrl = $null
$script:NoiseTorchIndexUrl = $null
$script:CudaVersion = $null
$script:HasNvidiaGpu = $false

$InstallMainSelected = $InstallMain -match "^(1|true|yes)$"
$InstallNoiseSelected = $InstallNoise -match "^(1|true|yes)$"
$InstallSliceSelected = $InstallSlice -match "^(1|true|yes)$"
$AnyEnvironmentSelected = $InstallMainSelected -or $InstallNoiseSelected -or $InstallSliceSelected

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

function Invoke-OptionalNative {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $FilePath @Arguments *> $null
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }
}

function Test-PythonCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$PrefixArgs = @()
    )

    try {
        $version = & $Exe @PrefixArgs -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        if ($version -in @("3.12", "3.11", "3.10")) {
            return [pscustomobject]@{
                Exe = $Exe
                PrefixArgs = $PrefixArgs
                Version = $version
            }
        }
    }
    catch {
        return $null
    }

    return $null
}

function Test-PythonPackageVersion {
    param(
        [Parameter(Mandatory = $true)][string]$PythonExe,
        [Parameter(Mandatory = $true)][string]$PackageName,
        [string]$VersionPrefix = ""
    )

    $code = "import importlib.metadata as m, sys; name=sys.argv[1]; expected=sys.argv[2] if len(sys.argv)>2 else ''; v=m.version(name); raise SystemExit(0 if (not expected or v.startswith(expected)) else 1)"
    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $PythonExe -c $code $PackageName $VersionPrefix *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }
}

function Test-PythonPackages {
    param(
        [Parameter(Mandatory = $true)][string]$PythonExe,
        [Parameter(Mandatory = $true)][hashtable]$Packages
    )

    foreach ($packageName in $Packages.Keys) {
        if (-not (Test-PythonPackageVersion -PythonExe $PythonExe -PackageName $packageName -VersionPrefix $Packages[$packageName])) {
            return $false
        }
    }

    return $true
}

function Test-PythonScriptSuccess {
    param(
        [Parameter(Mandatory = $true)][string]$PythonExe,
        [Parameter(Mandatory = $true)][string]$ScriptPath
    )

    $oldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $PythonExe $ScriptPath *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $oldPreference
    }
}

function Find-Python {
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        foreach ($versionArg in @("-3.11", "-3.10", "-3.12")) {
            $candidate = Test-PythonCommand -Exe "py" -PrefixArgs @($versionArg)
            if ($candidate) {
                return $candidate
            }
        }
    }

    if (Get-Command python -ErrorAction SilentlyContinue) {
        $candidate = Test-PythonCommand -Exe "python"
        if ($candidate) {
            return $candidate
        }
    }

    $paths = @(
        "$env:LocalAppData\Programs\Python\Python311\python.exe",
        "$env:LocalAppData\Programs\Python\Python310\python.exe",
        "$env:LocalAppData\Programs\Python\Python312\python.exe",
        "$env:ProgramFiles\Python311\python.exe",
        "$env:ProgramFiles\Python310\python.exe",
        "$env:ProgramFiles\Python312\python.exe",
        "${env:ProgramW6432}\Python311\python.exe",
        "${env:ProgramW6432}\Python310\python.exe",
        "${env:ProgramW6432}\Python312\python.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($path in $paths) {
        $candidate = Test-PythonCommand -Exe $path
        if ($candidate) {
            return $candidate
        }
    }

    return $null
}

function Install-Python {
    $installer = $BundledPythonInstaller
    $removeInstaller = $false
    try {
        Write-Host "Supported Python was not found. Installing Python 3.11 for the current user..."
        if (Test-Path -LiteralPath $BundledPythonInstaller) {
            Write-Host "Using bundled Python installer: $BundledPythonInstaller"
        }
        else {
            $installer = Join-Path $env:TEMP ("wav_qc_python_3.11.9_{0}.exe" -f ([guid]::NewGuid().ToString("N")))
            $removeInstaller = $true
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $PythonInstallUrl -OutFile $installer
        }
        if (-not (Test-Path $installer)) {
            throw "Python installer was not downloaded."
        }

        $args = @(
            "/quiet",
            "InstallAllUsers=0",
            "PrependPath=1",
            "Include_launcher=1",
            "Include_pip=1",
            "Include_test=0",
            "SimpleInstall=1"
        )
        $process = Start-Process -FilePath $installer -ArgumentList $args -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw "Python installer failed with exit code $($process.ExitCode)."
        }

        $env:Path = "$env:LocalAppData\Programs\Python\Python311;$env:LocalAppData\Programs\Python\Python311\Scripts;$env:Path"
    }
    finally {
        if ($removeInstaller) {
            Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-Venv {
    param(
        [Parameter(Mandatory = $true)][string]$TargetVenv,
        [Parameter(Mandatory = $true)]$Python
    )

    $targetPython = Join-Path $TargetVenv "Scripts\python.exe"
    if (Test-Path $targetPython) {
        $venvVersion = & $targetPython -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and $venvVersion -eq $Python.Version) {
            Write-Host "Existing virtual environment found: $TargetVenv"
            return
        }

        Write-Host "Mismatched or broken virtual environment found. Recreating: $TargetVenv"
        Remove-Item -LiteralPath $TargetVenv -Recurse -Force
    }

    Invoke-Native -FilePath $Python.Exe -Arguments ($Python.PrefixArgs + @("-m", "venv", $TargetVenv)) -FailureMessage "Virtual environment creation failed: $TargetVenv"
}

function Find-NvidiaSmi {
    $systemRoot = $env:SystemRoot
    if ([string]::IsNullOrWhiteSpace($systemRoot)) {
        $systemRoot = $env:WINDIR
    }
    if ([string]::IsNullOrWhiteSpace($systemRoot)) {
        $systemRoot = "C:\Windows"
    }

    foreach ($path in @(
        (Join-Path $systemRoot "Sysnative\nvidia-smi.exe"),
        (Join-Path $systemRoot "System32\nvidia-smi.exe"),
        "$env:ProgramW6432\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        "${env:ProgramFiles(x86)}\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    )) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            return $path
        }
    }

    $command = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    return $null
}

function Detect-CudaIndex {
    $nvidiaSmi = Find-NvidiaSmi
    if (-not $nvidiaSmi) {
        $script:CudaVersion = "CPU"
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cpu"
        $script:HasNvidiaGpu = $false
        Write-Host "NVIDIA GPU driver was not detected. Installing CPU-compatible runtime."
        return
    }

    $output = & $nvidiaSmi 2>$null | Out-String
    $script:HasNvidiaGpu = $true
    if ($output -match "CUDA Version:\s*([0-9.]+)") {
        $script:CudaVersion = $matches[1]
        Write-Host "Detected NVIDIA CUDA version: $script:CudaVersion"
    }
    else {
        Write-Host "WARNING: CUDA version could not be parsed from nvidia-smi output. Defaulting to cu124 for .venv and cu121 for .venv_noise."
        $script:CudaVersion = "12.1"
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cu124"
        return
    }

    if ($script:CudaVersion.StartsWith("12.9") -or $script:CudaVersion.StartsWith("12.8") -or $script:CudaVersion.StartsWith("12.7") -or $script:CudaVersion.StartsWith("12.6")) {
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cu126"
    }
    elseif ($script:CudaVersion.StartsWith("12.5") -or $script:CudaVersion.StartsWith("12.4")) {
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cu124"
    }
    elseif ($script:CudaVersion.StartsWith("12.3") -or $script:CudaVersion.StartsWith("12.2") -or $script:CudaVersion.StartsWith("12.1")) {
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cu121"
    }
    elseif ($script:CudaVersion.StartsWith("11.8")) {
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cu118"
    }
    else {
        Write-Host "WARNING: Unsupported or uncommon CUDA version '$script:CudaVersion'. Defaulting to cu124 for .venv and cu121 for .venv_noise."
        $script:TorchIndexUrl = "https://download.pytorch.org/whl/cu124"
    }
}

function Detect-NoiseTorchIndex {
    if (-not $script:HasNvidiaGpu) {
        $script:NoiseTorchIndexUrl = "https://download.pytorch.org/whl/cpu"
        return
    }

    if ($script:CudaVersion -and $script:CudaVersion.StartsWith("11.8")) {
        $script:NoiseTorchIndexUrl = "https://download.pytorch.org/whl/cu118"
    }
    else {
        $script:NoiseTorchIndexUrl = "https://download.pytorch.org/whl/cu121"
    }
}

try {
    if (-not $AnyEnvironmentSelected) {
        Write-Host "No Python environments were selected. Skipping environment setup."
        exit 0
    }

    Write-Host "Selected environments:"
    Write-Host "  .venv        : $InstallMainSelected"
    Write-Host "  .venv_noise  : $InstallNoiseSelected"
    Write-Host "  .ven_slice   : $InstallSliceSelected"

    Write-Host "[1] Detecting supported Python..."
    $python = Find-Python
    if (-not $python -or $python.Version -ne "3.11") {
        Install-Python
        $python = Find-Python
    }
    if (-not $python) {
        throw "Supported Python was not found. Install Python 3.12, 3.11, or 3.10 from https://www.python.org/downloads/windows/ and run this file again."
    }
    if ($python.Version -ne "3.11") {
        throw "Python 3.11 was not found after installation. Python 3.11 is preferred because some audio packages do not provide Python 3.12 wheels on Windows."
    }
    Write-Host "Using Python $($python.Version)"

    if ($InstallMainSelected) {
        Write-Host "[2] Creating main virtual environment (.venv) if needed..."
        Ensure-Venv -TargetVenv $VenvDir -Python $python
    }

    if ($InstallNoiseSelected) {
        Write-Host "[3] Creating speaker virtual environment (.venv_noise) if needed..."
        Ensure-Venv -TargetVenv $NoiseVenvDir -Python $python
    }

    if ($InstallSliceSelected) {
        Write-Host "[4] Creating slicer virtual environment (.ven_slice) if needed..."
        Ensure-Venv -TargetVenv $SlicerVenvDir -Python $python
    }

    if ($InstallMainSelected -or $InstallSliceSelected) {
        Write-Host "[5] Detecting NVIDIA CUDA runtime..."
        Detect-CudaIndex
        Write-Host "Using main/slicer PyTorch wheel index: $script:TorchIndexUrl"
    }

    if ($InstallMainSelected) {
        Write-Host "[6] Ensuring pip tools in .venv..."
        Invoke-Native $VenvPy @("-m", "pip", "install", "pip", "setuptools", "wheel") "pip tool installation failed for .venv."

        Write-Host "[7] Ensuring GPU torch/torchaudio in .venv..."
        if (Test-PythonPackages -PythonExe $VenvPy -Packages @{ "torch" = "2.6.0"; "torchaudio" = "2.6.0" }) {
            Write-Host "torch/torchaudio already installed in .venv; skipping."
        }
        else {
            Invoke-OptionalNative $VenvPy @("-m", "pip", "uninstall", "-y", "torch", "torchaudio", "onnxruntime", "onnxruntime-gpu", "nvidia-cuda-runtime-cu12", "nvidia-cudnn-cu12", "nvidia-cublas-cu12", "nvidia-cufft-cu12", "nvidia-curand-cu12")
            Invoke-Native $VenvPy @("-m", "pip", "install", "--no-cache-dir", "--index-url", $script:TorchIndexUrl, "torch==2.6.0", "torchaudio==2.6.0") "GPU torch/torchaudio installation failed for .venv."
        }

        Write-Host "[8] Ensuring NeMo build helpers in .venv..."
        Invoke-Native $VenvPy @("-m", "pip", "install", "Cython", "packaging") "NeMo build helper installation failed for .venv."

        Write-Host "[9] Ensuring Python dependencies in .venv..."
        Invoke-Native $VenvPy @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "-r", (Join-Path $Root "requirements.txt")) "Python dependency installation failed for .venv."

        if ($script:HasNvidiaGpu) {
            $onnxVerifyScript = Join-Path $Root "verify_onnx_gpu.py"
            $onnxRuntimeReady = (Test-PythonPackageVersion -PythonExe $VenvPy -PackageName "onnxruntime-gpu" -VersionPrefix "1.") -and (Test-PythonScriptSuccess -PythonExe $VenvPy -ScriptPath $onnxVerifyScript)
            if ($onnxRuntimeReady) {
                Write-Host "[10] ONNX Runtime GPU already verified in .venv; skipping cleanup."
                Write-Host "[11] ONNX Runtime GPU already installed in .venv; skipping."
            }
            else {
                Write-Host "[10] Removing stale ONNX Runtime package remnants in .venv..."
                Invoke-OptionalNative $VenvPy @("-m", "pip", "uninstall", "-y", "onnxruntime", "onnxruntime-gpu", "nvidia-cuda-runtime-cu12", "nvidia-cudnn-cu12", "nvidia-cublas-cu12", "nvidia-cufft-cu12", "nvidia-curand-cu12")
                Invoke-Native $VenvPy @((Join-Path $Root "cleanup_onnxruntime_conflicts.py")) "ONNX Runtime cleanup failed for .venv."

                Write-Host "[11] Ensuring final ONNX Runtime GPU runtime in .venv..."
                Invoke-Native $VenvPy @("-m", "pip", "install", "--no-cache-dir", "onnxruntime-gpu[cuda,cudnn]>=1.21,<2") "ONNX Runtime GPU installation failed for .venv."
            }

            Write-Host "[12] Verifying ONNX Runtime CUDA provider in .venv..."
            Invoke-Native $VenvPy @($onnxVerifyScript) "ONNX Runtime CUDA provider verification failed for .venv."
        }
        else {
            Write-Host "[10] Removing stale ONNX Runtime GPU package remnants in .venv..."
            Invoke-OptionalNative $VenvPy @("-m", "pip", "uninstall", "-y", "onnxruntime", "onnxruntime-gpu", "nvidia-cuda-runtime-cu12", "nvidia-cudnn-cu12", "nvidia-cublas-cu12", "nvidia-cufft-cu12", "nvidia-curand-cu12")

            Write-Host "[11] Ensuring ONNX Runtime CPU fallback in .venv..."
            Invoke-Native $VenvPy @("-m", "pip", "install", "--no-cache-dir", "onnxruntime>=1.21,<2") "ONNX Runtime CPU installation failed for .venv."
            Write-Host "[12] Skipping ONNX Runtime CUDA verification because no NVIDIA GPU driver was detected."
        }
    }

    if ($InstallNoiseSelected) {
        Write-Host "[13] Ensuring pip tools in .venv_noise..."
        Invoke-Native $NoiseVenvPy @("-m", "pip", "install", "pip", "setuptools<81", "wheel") "pip tool installation failed for .venv_noise."

        Detect-NoiseTorchIndex
        Write-Host "Using speaker PyTorch wheel index: $script:NoiseTorchIndexUrl"

        Write-Host "[14] Ensuring speaker torch stack in .venv_noise..."
        if (Test-PythonPackages -PythonExe $NoiseVenvPy -Packages @{ "torch" = "2.1.2"; "torchvision" = "0.16.2"; "torchaudio" = "2.1.2" }) {
            Write-Host "Speaker torch stack already installed in .venv_noise; skipping."
        }
        else {
            Invoke-OptionalNative $NoiseVenvPy @("-m", "pip", "uninstall", "-y", "torch", "torchvision", "torchaudio")
            Invoke-Native $NoiseVenvPy @("-m", "pip", "install", "--no-cache-dir", "--index-url", $script:NoiseTorchIndexUrl, "torch==2.1.2", "torchvision==0.16.2", "torchaudio==2.1.2") "Speaker torch stack installation failed for .venv_noise."
        }

        Write-Host "[15] Ensuring speaker/Sidon inference dependencies in .venv_noise..."
        $noiseReq = Join-Path $Root "requirements_noise.txt"
        $noiseReqFiltered = Join-Path $env:TEMP ("wav_qc_noise_requirements_{0}.txt" -f ([guid]::NewGuid().ToString("N")))
        $noiseLines = Get-Content $noiseReq | Where-Object { $_ -notmatch "resemble-enhance" -and $_ -notmatch "haoheliu/voicefixer/archive/refs/heads/main.zip" }
        Set-Content -LiteralPath $noiseReqFiltered -Value $noiseLines -Encoding ASCII
        try {
            Invoke-Native $NoiseVenvPy @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "-r", $noiseReqFiltered) "Speaker dependency installation failed for .venv_noise."
            $resembleReq = Get-Content $noiseReq | Where-Object { $_ -match "^\s*resemble-enhance" } | Select-Object -First 1
            if ($resembleReq) {
                Invoke-Native $NoiseVenvPy @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "--no-deps", $resembleReq.Trim()) "resemble-enhance installation failed for .venv_noise."
            }
            $voicefixerReq = Get-Content $noiseReq | Where-Object { $_ -match "haoheliu/voicefixer/archive/refs/heads/main.zip" } | Select-Object -First 1
            if ($voicefixerReq) {
                Invoke-Native $NoiseVenvPy @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "--no-deps", $voicefixerReq.Trim()) "voicefixer installation failed for .venv_noise."
            }
        }
        finally {
            Remove-Item -LiteralPath $noiseReqFiltered -Force -ErrorAction SilentlyContinue
        }
    }

    if ($InstallSliceSelected) {
        Write-Host "[16] Ensuring pip tools in .ven_slice..."
        Invoke-Native $SlicerVenvPy @("-m", "pip", "install", "pip", "setuptools", "wheel") "pip tool installation failed for .ven_slice."

        Write-Host "Using slicer PyTorch wheel index: $script:TorchIndexUrl"

        Write-Host "[17] Ensuring slicer torch stack in .ven_slice..."
        if (Test-PythonPackages -PythonExe $SlicerVenvPy -Packages @{ "torch" = "2.6.0"; "torchaudio" = "2.6.0"; "torchvision" = "0.21.0" }) {
            Write-Host "Slicer torch stack already installed in .ven_slice; skipping."
        }
        else {
            Invoke-OptionalNative $SlicerVenvPy @("-m", "pip", "uninstall", "-y", "torch", "torchvision", "torchaudio")
            Invoke-Native $SlicerVenvPy @("-m", "pip", "install", "--no-cache-dir", "--index-url", $script:TorchIndexUrl, "torch==2.6.0", "torchaudio==2.6.0", "torchvision==0.21.0") "Slicer torch stack installation failed for .ven_slice."
        }

        Write-Host "[18] Ensuring slicer dependencies in .ven_slice..."
        Invoke-Native $SlicerVenvPy @("-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "-r", (Join-Path $Root "requirements_slicer.txt")) "Slicer dependency installation failed for .ven_slice."
    }

    Write-Host "Environment setup complete."
    exit 0
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
