from __future__ import annotations

from typing import Callable, Literal

import torch

LogFn = Callable[[str], None]
DevicePreference = Literal["auto", "cuda", "cpu"]

_RESOLVE_DEVICE_LOGGED: set[tuple[str, str]] = set()


def check_runtime(log: LogFn) -> None:
    log(f"[RUNTIME] torch {torch.__version__}")
    cuda_build = getattr(torch.version, "cuda", None)
    if cuda_build:
        log(f"[RUNTIME] PyTorch CUDA build: {cuda_build}")
    else:
        log("[RUNTIME] PyTorch CPU build")

    if torch.cuda.is_available():
        try:
            gpu_name = torch.cuda.get_device_name(0)
        except Exception:
            gpu_name = "Unknown NVIDIA GPU"
        log(f"[RUNTIME] CUDA 사용 가능: {gpu_name}")
    else:
        log("[RUNTIME] CUDA 사용 불가: CPU로 실행됩니다.")



def _log_device_once(preference: str, resolved: str, message: str, log: LogFn) -> None:
    key = (preference, resolved)
    if key in _RESOLVE_DEVICE_LOGGED:
        return
    _RESOLVE_DEVICE_LOGGED.add(key)
    log(message)


def resolve_device(preference: DevicePreference, log: LogFn) -> tuple[str, bool]:
    cuda_available = torch.cuda.is_available()

    if preference == "cuda":
        if cuda_available:
            gpu_name = torch.cuda.get_device_name(0)
            _log_device_once(preference, "cuda", f"[DEVICE] CUDA 강제 선택: {gpu_name}", log)
            return "cuda", True
        _log_device_once(preference, "cpu", "[DEVICE] CUDA 강제 선택이 요청됐지만 현재 사용 불가하여 CPU로 전환합니다.", log)
        return "cpu", False

    if preference == "cpu":
        _log_device_once(preference, "cpu", "[DEVICE] CPU 강제 선택", log)
        return "cpu", False

    if cuda_available:
        gpu_name = torch.cuda.get_device_name(0)
        _log_device_once(preference, "cuda", f"[DEVICE] 자동 선택 결과: CUDA ({gpu_name})", log)
        return "cuda", True

    _log_device_once(preference, "cpu", "[DEVICE] 자동 선택 결과: CPU", log)
    return "cpu", False
