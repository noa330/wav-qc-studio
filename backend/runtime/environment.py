from __future__ import annotations

from functools import lru_cache
from typing import Any

import torch

from .config import load_config
from .external_console import suppress_external_console
from .onnx_runtime import (
    ensure_gpu_runtime_for_onnx as _ensure_gpu_runtime_for_onnx_impl,
    patch_torchmetrics_dnsmos_for_ort as _patch_torchmetrics_dnsmos_for_ort_impl,
)
from .windows_gpu import _prime_windows_gpu_runtime


@lru_cache(maxsize=1)
def _runtime_cfg() -> dict[str, Any]:
    return load_config().get("runtime", {})


def _gpu_required() -> bool:
    return bool(_runtime_cfg().get("require_gpu", False))


def _fail_if_gpu_required() -> None:
    if not torch.cuda.is_available() and _gpu_required():
        raise RuntimeError(
            "GPU 전용 모드입니다. CUDA 가능한 NVIDIA GPU/드라이버와 GPU용 torch 설치가 필요합니다. "
            "repair_gpu_runtime.bat 를 먼저 실행하세요."
        )


@lru_cache(maxsize=1)
def get_runtime_device() -> torch.device:
    _fail_if_gpu_required()
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


@lru_cache(maxsize=1)
def get_runtime_device_str() -> str:
    return str(get_runtime_device())


@lru_cache(maxsize=1)
def get_runtime_summary() -> str:
    if torch.cuda.is_available():
        idx = torch.cuda.current_device()
        name = torch.cuda.get_device_name(idx)
        return f"device=cuda gpu={name}"
    return "device=cpu (GPU required but unavailable)" if _gpu_required() else "device=cpu"


def ensure_runtime_ready() -> None:
    _ = get_runtime_device()


def get_runtime_cuda_index() -> int:
    if torch.cuda.is_available():
        try:
            return int(torch.cuda.current_device())
        except Exception:
            return 0
    return 0


def get_runtime_device_str_for_onnx() -> str:
    if get_runtime_device_str() != "cuda":
        return "cpu"
    return f"cuda:{get_runtime_cuda_index()}"


def ensure_gpu_runtime_for_onnx(force_recheck: bool = False) -> None:
    return _ensure_gpu_runtime_for_onnx_impl(
        get_runtime_device_str=get_runtime_device_str,
        get_runtime_cuda_index=get_runtime_cuda_index,
        prime_windows_gpu_runtime=_prime_windows_gpu_runtime,
        force_recheck=force_recheck,
    )


def patch_torchmetrics_dnsmos_for_ort() -> None:
    return _patch_torchmetrics_dnsmos_for_ort_impl(
        get_runtime_device_str=get_runtime_device_str,
        get_runtime_cuda_index=get_runtime_cuda_index,
        ensure_gpu_runtime_for_onnx_callback=ensure_gpu_runtime_for_onnx,
    )
