from __future__ import annotations

import os
import site
from pathlib import Path
from typing import Any

import torch

_DLL_DIR_HANDLES: list[Any] = []


def _iter_existing_windows_gpu_dirs() -> list[str]:
    if os.name != "nt":
        return []

    candidates: list[str] = []

    try:
        torch_lib = Path(torch.__file__).resolve().parent / "lib"
        candidates.append(str(torch_lib))
    except Exception:
        pass

    for env_name in sorted(os.environ):
        if env_name == "CUDA_PATH" or env_name.startswith("CUDA_PATH_V"):
            base = os.environ.get(env_name)
            if base:
                candidates.append(str(Path(base) / "bin"))

    try:
        for site_dir in site.getsitepackages():
            base = Path(site_dir)
            for rel in (
                "nvidia/cuda_runtime/bin",
                "nvidia/cudnn/bin",
                "nvidia/cublas/bin",
                "nvidia/cufft/bin",
                "nvidia/curand/bin",
                "nvidia_cuda_runtime_cu12/bin",
                "nvidia_cudnn_cu12/bin",
                "nvidia_cublas_cu12/bin",
                "nvidia_cufft_cu12/bin",
                "nvidia_curand_cu12/bin",
            ):
                candidates.append(str(base / rel))
            try:
                for child in base.iterdir():
                    if not child.is_dir():
                        continue
                    name = child.name.lower()
                    if name.startswith("nvidia"):
                        for nested in (child / "bin", child / "lib", child / "Library" / "bin"):
                            candidates.append(str(nested))
            except Exception:
                pass
    except Exception:
        pass

    deduped: list[str] = []
    seen: set[str] = set()
    for raw in candidates:
        try:
            norm = str(Path(raw).resolve())
        except Exception:
            norm = raw
        low = norm.lower()
        if low in seen:
            continue
        seen.add(low)
        if os.path.isdir(norm):
            deduped.append(norm)
    return deduped

def _prime_windows_gpu_runtime() -> list[str]:
    if os.name != "nt":
        return []

    global _DLL_DIR_HANDLES

    added: list[str] = []
    current_path = os.environ.get("PATH", "")
    current_parts = current_path.split(os.pathsep) if current_path else []
    current_lower = {x.lower() for x in current_parts}

    for dll_dir in _iter_existing_windows_gpu_dirs():
        if hasattr(os, "add_dll_directory"):
            try:
                handle = os.add_dll_directory(dll_dir)
                _DLL_DIR_HANDLES.append(handle)
            except OSError:
                pass
        if dll_dir.lower() not in current_lower:
            current_parts.insert(0, dll_dir)
            current_lower.add(dll_dir.lower())
            added.append(dll_dir)

    os.environ["PATH"] = os.pathsep.join(current_parts)
    return added
