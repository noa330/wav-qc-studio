Param (
    [Parameter(Mandatory=$true)][ValidateSet("CU126", "CU128", "CPU")][string]$Device,
    [Parameter(Mandatory=$true)][ValidateSet("HF", "HF-Mirror", "ModelScope")][string]$Source,
    [Parameter(Mandatory=$true)][string]$RepoPath,
    [string]$EnvName = "GPTSoVits",
    [string]$EnvPrefix = "",
    [string]$CondaExe = "conda",
    [string]$LogPath = "",
    [switch]$DownloadUVR5
)

$global:ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
$env:PIP_NO_INPUT = "1"
$env:CONDA_PLUGINS_AUTO_ACCEPT_TOS = "yes"
$script:BundledMinicondaDir = Join-Path $script:RepoPath ".miniconda3"
$script:BundledCondaExe = Join-Path $script:BundledMinicondaDir "Scripts\conda.exe"
if (-not $script:EnvPrefix) {
    $script:EnvPrefix = Join-Path $script:RepoPath ".conda"
}
$script:EnvPrefix = [System.IO.Path]::GetFullPath($script:EnvPrefix)
if ($script:CondaExe -eq "conda" -or $script:CondaExe -eq "conda.exe") {
    if (Test-Path $script:BundledCondaExe) {
        $script:CondaExe = $script:BundledCondaExe
    } else {
        throw [System.Exception]::new("GPT-SoVITS repo-local conda was not found: $script:BundledCondaExe. Run through the app launcher so Miniconda is installed inside the GPT-SoVITS repo first.")
    }
}

# Keep the GPT-SoVITS Windows runtime on the tested PyTorch/CUDA set.
# GPT-SoVITS lists Python 3.11 + PyTorch 2.7.0 + CUDA 12.8 as a tested environment.
# PyTorch 2.7.0 pairs with torchvision 0.22.0 and torchaudio 2.7.0.
$script:TorchVersion = "2.7.0"
$script:TorchVisionVersion = "0.22.0"
$script:TorchAudioVersion = "2.7.0"
$null = chcp.com 65001
if ($LogPath) {
    $logParent = Split-Path -Parent $LogPath
    if ($logParent) {
        New-Item -ItemType Directory -Force -Path $logParent | Out-Null
    }
    Start-Transcript -Path $LogPath -Append | Out-Null
}

trap {
    if ($LogPath) {
        try {
            Stop-Transcript | Out-Null
        } catch {
        }
    }
    Write-ErrorLog $_
}

function Write-ErrorLog {
    param ([System.Management.Automation.ErrorRecord]$ErrorRecord)
    Write-Host "`n[ERROR] Command failed:" -ForegroundColor Red
    if ($ErrorRecord.Exception.Message) {
        Write-Host "Message:" -ForegroundColor Red
        $ErrorRecord.Exception.Message -split "`n" | ForEach-Object { Write-Host "    $_" }
    }
    Write-Host "Command:" -ForegroundColor Red -NoNewline
    Write-Host " $($ErrorRecord.InvocationInfo.Line)".Replace("`r", "").Replace("`n", "")
    Write-Host "Location:" -ForegroundColor Red -NoNewline
    Write-Host " $($ErrorRecord.InvocationInfo.ScriptName):$($ErrorRecord.InvocationInfo.ScriptLineNumber)"
    Write-Host "Call Stack:" -ForegroundColor DarkRed
    $ErrorRecord.ScriptStackTrace -split "`n" | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkRed }
    exit 1
}

function Write-Info($msg) {
    Write-Host "[INFO]:" -ForegroundColor Green -NoNewline
    Write-Host " $msg"
}

function Write-Success($msg) {
    Write-Host "[SUCCESS]:" -ForegroundColor Blue -NoNewline
    Write-Host " $msg"
}

function Get-CondaTargetArgs {
    return @("-p", $script:EnvPrefix)
}

function Get-CondaTargetLabel {
    return $script:EnvPrefix
}

function Invoke-CondaPackage {
    param ([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    $targetArgs = Get-CondaTargetArgs
    & $script:CondaExe install -y @targetArgs -c conda-forge @Args
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Host "Conda Install $Args Failed" -ForegroundColor Red
        throw [System.Exception]::new("conda install failed with exit code $exitCode")
    }
}

function Invoke-Pip {
    param ([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    & python -m pip install @Args
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Host "Pip Install $Args Failed" -ForegroundColor Red
        throw [System.Exception]::new("pip install failed with exit code $exitCode")
    }
}

function Invoke-PinnedPytorchSet {
    param ([Parameter(Mandatory=$true)][string]$IndexUrl)
    Write-Info "Installing pinned PyTorch set: torch==$script:TorchVersion, torchvision==$script:TorchVisionVersion, torchaudio==$script:TorchAudioVersion"
    Invoke-Pip "--force-reinstall" "torch==$script:TorchVersion" "torchvision==$script:TorchVisionVersion" "torchaudio==$script:TorchAudioVersion" "--index-url" $IndexUrl
}

function Ensure-SetuptoolsVersion {
    Write-Info "Ensuring setuptools 80.9.0..."
    Invoke-Pip "--force-reinstall" "--index-url" "https://pypi.org/simple" "setuptools==80.9.0"
}

function Install-FilteredRequirements {
    param ([Parameter(Mandatory=$true)][string]$RequirementsPath)
    $tempPath = Join-Path $env:TEMP ("gpt_sovits_filtered_" + [System.IO.Path]::GetFileName($RequirementsPath))
    $excluded = @("torch", "torchvision", "torchaudio", "torchcodec")
    $lines = Get-Content -Path $RequirementsPath -Encoding UTF8
    $filtered = @()
    foreach ($line in $lines) {
        $trim = $line.Trim()
        if ($trim -eq "" -or $trim.StartsWith("#")) {
            $filtered += $line
            continue
        }
        $name = (($trim -split "[<>=~! ;	\[]", 2)[0]).Trim().ToLowerInvariant()
        if ($excluded -contains $name) {
            Write-Info "Skipping $trim from $RequirementsPath; pinned runtime manages it."
            continue
        }
        $filtered += $line
    }
    Set-Content -Path $tempPath -Value $filtered -Encoding UTF8
    Invoke-Pip -r $tempPath
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}

function Invoke-TorchRuntimeForDevice {
    switch ($script:Device) {
        "CU128" {
            Write-Info "Installing PyTorch For CUDA 12.8..."
            Invoke-PinnedPytorchSet "https://download.pytorch.org/whl/cu128"
        }
        "CU126" {
            Write-Info "Installing PyTorch For CUDA 12.6..."
            Invoke-PinnedPytorchSet "https://download.pytorch.org/whl/cu126"
        }
        "CPU" {
            Write-Info "Installing PyTorch For CPU..."
            Invoke-PinnedPytorchSet "https://download.pytorch.org/whl/cpu"
        }
    }
}

function Invoke-Download {
    param (
        [Parameter(Mandatory=$true)][string]$Uri,
        [Parameter()][string]$OutFile
    )
    try {
        $params = @{ Uri = $Uri }
        if ($OutFile) { $params["OutFile"] = $OutFile }
        $null = Invoke-WebRequest @params -ErrorAction Stop
    } catch {
        Write-Host "Failed to download:" -ForegroundColor Red
        Write-Host "  $Uri"
        throw
    }
}

function Invoke-Unzip {
    param($ZipPath, $DestPath)
    Expand-Archive -Path $ZipPath -DestinationPath $DestPath -Force
    Remove-Item $ZipPath -Force
}

function Ensure-CondaEnv {
    Accept-CondaTerms
    $pythonPath = Join-Path $script:EnvPrefix "python.exe"
    if (-not (Test-Path $pythonPath)) {
        $envParent = Split-Path -Parent $script:EnvPrefix
        if ($envParent) {
            New-Item -ItemType Directory -Force -Path $envParent | Out-Null
        }
        Write-Info "Creating conda env at $script:EnvPrefix with Python 3.10..."
        & $script:CondaExe create -y -p $script:EnvPrefix python=3.10
        if ($LASTEXITCODE -ne 0) {
            throw [System.Exception]::new("conda create failed for $script:EnvPrefix")
        }
    }
}

function Accept-CondaTerms {
    $channels = @(
        "https://repo.anaconda.com/pkgs/main",
        "https://repo.anaconda.com/pkgs/r",
        "https://repo.anaconda.com/pkgs/msys2"
    )
    foreach ($channel in $channels) {
        Write-Info "Accepting conda Terms of Service for $channel"
        & $script:CondaExe tos accept --override-channels --channel $channel
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw [System.Exception]::new("conda tos accept failed for $channel")
        }
    }
}

function Activate-CondaEnv {
    $condaBase = (& $script:CondaExe info --base).Trim()
    $hook = Join-Path $condaBase "shell\condabin\conda-hook.ps1"
    if (-not (Test-Path $hook)) {
        throw [System.Exception]::new("conda hook was not found: $hook")
    }
    . $hook
    $target = Get-CondaTargetLabel
    conda activate $target
}

function Assert-PytorchDevice {
    $payload = python -c "import json, importlib, importlib.metadata, importlib.util, torch; data={'torch': torch.__version__, 'cuda_build': torch.version.cuda, 'cuda_available': torch.cuda.is_available()}; [data.__setitem__(m, getattr(importlib.import_module(m), '__version__', 'import-ok')) for m in ['torchvision', 'torchaudio']]; data['torchcodec']=(importlib.metadata.version('torchcodec') if importlib.util.find_spec('torchcodec') else 'not-installed'); print(json.dumps(data, ensure_ascii=False))"
    Write-Info "PyTorch runtime $payload"
    $data = $payload | ConvertFrom-Json

    if (-not ($data.torch -like "$script:TorchVersion*")) {
        throw [System.Exception]::new("Wrong torch version: expected $script:TorchVersion, got $($data.torch)")
    }
    if (-not ($data.torchvision -like "$script:TorchVisionVersion*")) {
        throw [System.Exception]::new("Wrong torchvision version: expected $script:TorchVisionVersion, got $($data.torchvision)")
    }
    if (-not ($data.torchaudio -like "$script:TorchAudioVersion*")) {
        throw [System.Exception]::new("Wrong torchaudio version: expected $script:TorchAudioVersion, got $($data.torchaudio)")
    }

    if ($script:Device -eq "CU128") {
        if ($data.cuda_build -ne "12.8") {
            throw [System.Exception]::new("CUDA 12.8 PyTorch was requested but torch CUDA build is $($data.cuda_build).")
        }
    } elseif ($script:Device -eq "CU126") {
        if ($data.cuda_build -ne "12.6") {
            throw [System.Exception]::new("CUDA 12.6 PyTorch was requested but torch CUDA build is $($data.cuda_build).")
        }
    } elseif ($script:Device -eq "CPU") {
        if ($data.cuda_build) {
            throw [System.Exception]::new("CPU PyTorch was requested but CUDA torch is installed: $($data.cuda_build).")
        }
    }

    if ($script:Device -ne "CPU" -and -not $data.cuda_available) {
        Write-Info "CUDA build is correct, but torch.cuda.is_available() is false. Check NVIDIA driver/GPU visibility if training needs GPU."
    }
}

Ensure-CondaEnv
Activate-CondaEnv
Ensure-SetuptoolsVersion
Set-Location $RepoPath

Write-Info "Installing FFmpeg & CMake..."
Invoke-CondaPackage ffmpeg cmake
Write-Success "FFmpeg & CMake Installed"

$PretrainedURL = ""
$G2PWURL = ""
$UVR5URL = ""
$NLTKURL = ""
$OpenJTalkURL = ""

switch ($Source) {
    "HF" {
        Write-Info "Download Model From HuggingFace"
        $PretrainedURL = "https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/pretrained_models.zip"
        $G2PWURL = "https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/G2PWModel.zip"
        $UVR5URL = "https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/uvr5_weights.zip"
        $NLTKURL = "https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/nltk_data.zip"
        $OpenJTalkURL = "https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/open_jtalk_dic_utf_8-1.11.tar.gz"
    }
    "HF-Mirror" {
        Write-Info "Download Model From HuggingFace-Mirror"
        $PretrainedURL = "https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/pretrained_models.zip"
        $G2PWURL = "https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/G2PWModel.zip"
        $UVR5URL = "https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/uvr5_weights.zip"
        $NLTKURL = "https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/nltk_data.zip"
        $OpenJTalkURL = "https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/open_jtalk_dic_utf_8-1.11.tar.gz"
    }
    "ModelScope" {
        Write-Info "Download Model From ModelScope"
        $PretrainedURL = "https://www.modelscope.cn/models/XXXXRT/GPT-SoVITS-Pretrained/resolve/master/pretrained_models.zip"
        $G2PWURL = "https://www.modelscope.cn/models/XXXXRT/GPT-SoVITS-Pretrained/resolve/master/G2PWModel.zip"
        $UVR5URL = "https://www.modelscope.cn/models/XXXXRT/GPT-SoVITS-Pretrained/resolve/master/uvr5_weights.zip"
        $NLTKURL = "https://www.modelscope.cn/models/XXXXRT/GPT-SoVITS-Pretrained/resolve/master/nltk_data.zip"
        $OpenJTalkURL = "https://www.modelscope.cn/models/XXXXRT/GPT-SoVITS-Pretrained/resolve/master/open_jtalk_dic_utf_8-1.11.tar.gz"
    }
}

Write-Info "Pretrained models are managed by the launcher cache; skipping official pretrained_models.zip download."

if (-not (Test-Path "GPT_SoVITS/text/G2PWModel")) {
    Write-Info "Downloading G2PWModel..."
    Invoke-Download -Uri $G2PWURL -OutFile "G2PWModel.zip"
    Invoke-Unzip "G2PWModel.zip" "GPT_SoVITS/text"
    Write-Success "G2PWModel Downloaded"
} else {
    Write-Info "G2PWModel Exists"
    Write-Info "Skip Downloading G2PWModel"
}

if ($DownloadUVR5) {
    if (-not (Test-Path "tools/uvr5/uvr5_weights")) {
        Write-Info "Downloading UVR5 Models..."
        Invoke-Download -Uri $UVR5URL -OutFile "uvr5_weights.zip"
        Invoke-Unzip "uvr5_weights.zip" "tools/uvr5"
        Write-Success "UVR5 Models Downloaded"
    } else {
        Write-Info "UVR5 Models Exists"
        Write-Info "Skip Downloading UVR5 Models"
    }
}

Invoke-TorchRuntimeForDevice
Assert-PytorchDevice
Write-Success "PyTorch Installed"

Write-Info "Installing Python Dependencies From requirements.txt..."
Invoke-Pip -r extra-req.txt --no-deps
Install-FilteredRequirements "requirements.txt"
if ($IsWindows -or $env:OS -eq "Windows_NT") {
    Write-Info "Installing Windows Korean text frontend dependency..."
    Invoke-Pip "eunjeon==0.4.0"
}

# requirements.txt can contain unpinned torch-domain packages on upstream GPT-SoVITS.
# Re-apply the pinned runtime after requirements so pip cannot leave torch/torchaudio mismatched.
Write-Info "Re-aligning PyTorch package versions after requirements.txt..."
Invoke-TorchRuntimeForDevice
Assert-PytorchDevice
Ensure-SetuptoolsVersion
Write-Success "Python Dependencies Installed"

Write-Info "Downloading NLTK Data..."
Invoke-Download -Uri $NLTKURL -OutFile "nltk_data.zip"
Invoke-Unzip "nltk_data.zip" (python -c "import sys; print(sys.prefix)").Trim()

Write-Info "Downloading Open JTalk Dict..."
Invoke-Download -Uri $OpenJTalkURL -OutFile "open_jtalk_dic_utf_8-1.11.tar.gz"
$target = (python -c "import os, pyopenjtalk; print(os.path.dirname(pyopenjtalk.__file__))").Trim()
tar -xzf open_jtalk_dic_utf_8-1.11.tar.gz -C $target
Remove-Item "open_jtalk_dic_utf_8-1.11.tar.gz" -Force
Write-Success "Open JTalk Dic Downloaded"

Write-Success "Installation Completed"
if ($LogPath) {
    Stop-Transcript | Out-Null
}
