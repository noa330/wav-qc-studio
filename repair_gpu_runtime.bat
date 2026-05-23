@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"
set "NOISE_VENV_PY=%ROOT%.venv_noise\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo ERROR: .venv\Scripts\python.exe not found. Run setup_and_run.bat first.
    pause
    exit /b 1
)

if not exist "%NOISE_VENV_PY%" (
    echo ERROR: .venv_noise\Scripts\python.exe not found. Run setup_and_run.bat first.
    pause
    exit /b 1
)

call :detect_cuda_index
if errorlevel 1 goto :fail
call :detect_noise_torch_index
if errorlevel 1 goto :fail

echo Using main PyTorch wheel index   : %TORCH_INDEX_URL%
echo Using speaker PyTorch wheel index: %NOISE_TORCH_INDEX_URL%

echo [1/7] Removing conflicting runtime packages from .venv...
"%VENV_PY%" -m pip uninstall -y torch torchaudio onnxruntime onnxruntime-gpu nvidia-cuda-runtime-cu12 nvidia-cudnn-cu12 nvidia-cublas-cu12 nvidia-cufft-cu12 nvidia-curand-cu12 >nul 2>nul

echo [2/7] Scrubbing stale ONNX Runtime package remnants from .venv...
"%VENV_PY%" "%ROOT%cleanup_onnxruntime_conflicts.py"
if errorlevel 1 goto :fail

echo [3/7] Installing GPU torch/torchaudio into .venv...
"%VENV_PY%" -m pip install --upgrade --index-url %TORCH_INDEX_URL% torch==2.6.0 torchaudio==2.6.0
if errorlevel 1 goto :fail

echo [4/7] Installing onnxruntime-gpu with CUDA/cuDNN runtime into .venv...
"%VENV_PY%" -m pip install --upgrade "onnxruntime-gpu[cuda,cudnn]>=1.21,<2"
if errorlevel 1 goto :fail

echo [5/7] Verifying ONNX Runtime CUDA provider in .venv...
"%VENV_PY%" "%ROOT%verify_onnx_gpu.py"
if errorlevel 1 goto :fail

echo [6/7] Reinstalling speaker torch stack into .venv_noise...
"%NOISE_VENV_PY%" -m pip uninstall -y torch torchvision torchaudio >nul 2>nul
"%NOISE_VENV_PY%" -m pip install --upgrade --index-url %NOISE_TORCH_INDEX_URL% torch==2.1.2 torchvision==0.16.2 torchaudio==2.1.2
if errorlevel 1 goto :fail

echo [7/7] Checking speaker GPU runtime in .venv_noise...
"%NOISE_VENV_PY%" -c "import torch; print('torch', torch.__version__, 'cuda_build', torch.version.cuda, 'cuda_available', torch.cuda.is_available())"
if errorlevel 1 goto :fail

echo.
echo GPU runtime repair completed for both .venv and .venv_noise.
pause
exit /b 0

:detect_noise_torch_index
set "NOISE_TORCH_INDEX_URL="
if "%CUDA_VER:~0,4%"=="11.8" set "NOISE_TORCH_INDEX_URL=https://download.pytorch.org/whl/cu118"
if not defined NOISE_TORCH_INDEX_URL set "NOISE_TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121"
exit /b 0

:detect_cuda_index
set "TORCH_INDEX_URL="
set "NVIDIA_SMI="
set "CUDA_VER="

for /f "delims=" %%I in ('where nvidia-smi 2^>nul') do if not defined NVIDIA_SMI set "NVIDIA_SMI=%%I"
if not defined NVIDIA_SMI if exist "%ProgramW6432%\NVIDIA Corporation\NVSMI\nvidia-smi.exe" set "NVIDIA_SMI=%ProgramW6432%\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
if not defined NVIDIA_SMI if exist "%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe" set "NVIDIA_SMI=%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
if not defined NVIDIA_SMI if exist "%ProgramFiles(x86)%\NVIDIA Corporation\NVSMI\nvidia-smi.exe" set "NVIDIA_SMI=%ProgramFiles(x86)%\NVIDIA Corporation\NVSMI\nvidia-smi.exe"

if not defined NVIDIA_SMI (
    echo ERROR: nvidia-smi not found. NVIDIA GPU driver is required.
    exit /b 1
)

set "CUDA_TMP=%TEMP%\wav_qc_nvidia_smi_%RANDOM%_%RANDOM%.txt"
"%NVIDIA_SMI%" > "%CUDA_TMP%" 2>nul
if exist "%CUDA_TMP%" (
    for /f "usebackq delims=" %%L in (`findstr /I /C:"CUDA Version" "%CUDA_TMP%"`) do if not defined CUDA_VER set "CUDA_VER=%%L"
    del /q "%CUDA_TMP%" >nul 2>nul
)
if not defined CUDA_VER (
    echo WARNING: CUDA version could not be parsed from nvidia-smi output. Defaulting to cu124 for .venv and cu121 for .venv_noise.
    set "CUDA_VER=12.1"
    set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124"
    exit /b 0
)

setlocal EnableDelayedExpansion
set "CUDA_VER=!CUDA_VER:*CUDA Version:=!"
for /f "tokens=1 delims=|" %%V in ("!CUDA_VER!") do set "CUDA_VER=%%V"
set "CUDA_VER=!CUDA_VER: =!"
endlocal & set "CUDA_VER=%CUDA_VER%"

echo Detected NVIDIA CUDA version: %CUDA_VER%

if "%CUDA_VER:~0,4%"=="12.9" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126"
if "%CUDA_VER:~0,4%"=="12.8" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126"
if "%CUDA_VER:~0,4%"=="12.7" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126"
if "%CUDA_VER:~0,4%"=="12.6" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126"
if "%CUDA_VER:~0,4%"=="12.5" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124"
if "%CUDA_VER:~0,4%"=="12.4" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124"
if "%CUDA_VER:~0,4%"=="12.3" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121"
if "%CUDA_VER:~0,4%"=="12.2" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121"
if "%CUDA_VER:~0,4%"=="12.1" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121"
if "%CUDA_VER:~0,4%"=="11.8" set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu118"

if defined TORCH_INDEX_URL exit /b 0

echo WARNING: Unsupported or uncommon CUDA version "%CUDA_VER%". Defaulting to cu124 for .venv and cu121 for .venv_noise.
set "TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124"
exit /b 0

:fail
echo.
echo GPU runtime installation failed.
pause
exit /b 1
