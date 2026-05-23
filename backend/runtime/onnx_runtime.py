from __future__ import annotations

import importlib.metadata as importlib_metadata
import os
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import torch

from ..console_ui import DownloadProgress
from .external_console import suppress_external_console
from .model_cache import package_cache_dir

_ORT_GPU_RUNTIME_READY: bool = False
_ORT_GPU_RUNTIME_DETAIL: str = ""
_DNSMOS_FILES = (
    ("DNSMOS/DNSMOS/model_v8.onnx", "DNSMOS/model_v8.onnx"),
    ("DNSMOS/DNSMOS/sig_bak_ovr.onnx", "DNSMOS/sig_bak_ovr.onnx"),
    ("DNSMOS/pDNSMOS/sig_bak_ovr.onnx", "pDNSMOS/sig_bak_ovr.onnx"),
)
_DNSMOS_BASE_URL = "https://raw.githubusercontent.com/microsoft/DNS-Challenge/master"


def _package_version(name: str) -> str | None:
    try:
        return importlib_metadata.version(name)
    except importlib_metadata.PackageNotFoundError:
        return None
    except Exception:
        return None


def _build_onnx_debug_message(ort: Any, added_dirs: list[str]) -> str:
    providers = []
    try:
        providers = list(ort.get_available_providers())
    except Exception:
        pass

    parts = [
        f"onnxruntime={getattr(ort, '__version__', 'unknown')}",
        f"providers={providers}",
        f"torch_cuda={torch.version.cuda}",
        f"cudnn={torch.backends.cudnn.version()}",
    ]

    dist_ort = _package_version("onnxruntime")
    dist_ort_gpu = _package_version("onnxruntime-gpu")
    if dist_ort:
        parts.append(f"dist_onnxruntime={dist_ort}")
    if dist_ort_gpu:
        parts.append(f"dist_onnxruntime_gpu={dist_ort_gpu}")
    if dist_ort and dist_ort_gpu:
        parts.append("package_conflict=onnxruntime+onnxruntime-gpu")

    nvidia_dist_names = [
        "nvidia-cuda-runtime-cu12",
        "nvidia-cudnn-cu12",
        "nvidia-cublas-cu12",
        "nvidia-cufft-cu12",
        "nvidia-curand-cu12",
    ]
    installed_nvidia = [f"{name}={_package_version(name)}" for name in nvidia_dist_names if _package_version(name)]
    if installed_nvidia:
        parts.append("nvidia_dists=" + ";".join(installed_nvidia))
    if added_dirs:
        parts.append(f"dll_dirs_added={len(added_dirs)}")
    return ", ".join(parts)


def ensure_gpu_runtime_for_onnx(
    *,
    get_runtime_device_str: Callable[[], str],
    get_runtime_cuda_index: Callable[[], int],
    prime_windows_gpu_runtime: Callable[[], list[str]],
    force_recheck: bool = False,
) -> None:
    global _ORT_GPU_RUNTIME_READY, _ORT_GPU_RUNTIME_DETAIL

    if get_runtime_device_str() != "cuda":
        return

    if _ORT_GPU_RUNTIME_READY and not force_recheck:
        return

    added_dirs = prime_windows_gpu_runtime()

    try:
        import onnxruntime as ort
    except Exception as e:  # noqa: BLE001
        _ORT_GPU_RUNTIME_READY = False
        raise RuntimeError("onnxruntime-gpu 가 설치되지 않았습니다.") from e

    preload_errors: list[str] = []
    if hasattr(ort, "preload_dlls"):
        for kwargs in ({}, {"directory": ""}):
            try:
                ort.preload_dlls(**kwargs)
            except Exception as e:  # noqa: BLE001
                preload_errors.append(f"preload_dlls({kwargs}): {type(e).__name__}: {e}")

    detail = _build_onnx_debug_message(ort, added_dirs)
    _ORT_GPU_RUNTIME_DETAIL = detail
    providers = set(ort.get_available_providers())
    if "CUDAExecutionProvider" not in providers:
        _ORT_GPU_RUNTIME_READY = False
        preload_tail = f" preload_errors={preload_errors}" if preload_errors else ""
        raise RuntimeError(
            "onnxruntime-gpu CUDAExecutionProvider 를 찾지 못했습니다. "
            "CUDA/cuDNN DLL preload 또는 ORT GPU 런타임 설치가 필요합니다. "
            f"({detail}){preload_tail} "
            "onnxruntime 와 onnxruntime-gpu 가 동시에 설치된 경우 둘 다 제거 후 GPU 패키지만 다시 설치해야 합니다. "
            "repair_gpu_runtime.bat 를 다시 실행하세요."
        )

    _ORT_GPU_RUNTIME_READY = True


def patch_torchmetrics_dnsmos_for_ort(
    *,
    get_runtime_device_str: Callable[[], str],
    get_runtime_cuda_index: Callable[[], int],
    ensure_gpu_runtime_for_onnx_callback: Callable[[], None],
) -> None:
    from torchmetrics.functional.audio import dnsmos as tm_dnsmos

    _patch_dnsmos_assets(tm_dnsmos)

    if get_runtime_device_str() != "cuda":
        return

    ensure_gpu_runtime_for_onnx_callback()

    if getattr(tm_dnsmos, "_wav_qc_ort_patch_applied", False):
        return

    import onnxruntime as ort

    def _load_session_patched(path: str, device: torch.device, num_threads: int | None = None):
        path = os.path.expanduser(path)
        if not os.path.exists(path):
            tm_dnsmos._prepare_dnsmos(tm_dnsmos.DNSMOS_DIR)

        opts = ort.SessionOptions()
        if num_threads is not None:
            opts.inter_op_num_threads = num_threads
            opts.intra_op_num_threads = num_threads

        if device.type == "cpu":
            return tm_dnsmos.InferenceSession(path, providers=["CPUExecutionProvider"], sess_options=opts)

        device_id = int(device.index if device.index is not None else get_runtime_cuda_index())

        if "CUDAExecutionProvider" in ort.get_available_providers():
            providers = [("CUDAExecutionProvider", {"device_id": device_id}), "CPUExecutionProvider"]
            return tm_dnsmos.InferenceSession(path, providers=providers, sess_options=opts)

        if "CoreMLExecutionProvider" in ort.get_available_providers():
            providers = [("CoreMLExecutionProvider", {"device_id": device_id}), "CPUExecutionProvider"]
            return tm_dnsmos.InferenceSession(path, providers=providers, sess_options=opts)

        return tm_dnsmos.InferenceSession(path, providers=["CPUExecutionProvider"], sess_options=opts)

    tm_dnsmos._load_session = _load_session_patched
    tm_dnsmos._cached_load_session = lru_cache()(_load_session_patched)
    tm_dnsmos._wav_qc_ort_patch_applied = True


def _patch_dnsmos_assets(tm_dnsmos: Any) -> None:
    if getattr(tm_dnsmos, "_wav_qc_dnsmos_assets_patch_applied", False):
        return

    cache_root = package_cache_dir("dnsmos")
    tm_dnsmos.DNSMOS_DIR = str(cache_root)

    def _prepare_dnsmos_patched(dnsmos_dir: str) -> None:
        target_root = Path(os.path.expanduser(dnsmos_dir))
        for remote_name, relative_name in _DNSMOS_FILES:
            target_path = target_root / relative_name
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if _valid_onnx_session(tm_dnsmos, target_path):
                continue

            temp_path = target_path.with_suffix(target_path.suffix + ".part")
            if temp_path.exists():
                temp_path.unlink()
            progress = DownloadProgress(f"DNSMOS {target_path.name}")
            try:
                urllib.request.urlretrieve(
                    f"{_DNSMOS_BASE_URL}/{remote_name}",
                    temp_path,
                    reporthook=progress,
                )
                os.replace(temp_path, target_path)
                size_mb = target_path.stat().st_size / (1024 * 1024)
                progress.finish(f"[download complete] DNSMOS {target_path.name} - {size_mb:.1f} MB")
            except Exception:
                progress.finish(f"[download failed] DNSMOS {target_path.name}")
                if temp_path.exists():
                    temp_path.unlink()
                raise

    tm_dnsmos._prepare_dnsmos = _prepare_dnsmos_patched
    tm_dnsmos._wav_qc_dnsmos_assets_patch_applied = True


def _valid_onnx_session(tm_dnsmos: Any, path: Path) -> bool:
    if not path.exists() or path.stat().st_size <= 0:
        return False
    try:
        with suppress_external_console():
            _ = tm_dnsmos.InferenceSession(str(path))
        return True
    except Exception:
        try:
            path.unlink()
        except Exception:
            pass
        return False
