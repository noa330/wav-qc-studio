from __future__ import annotations

import importlib.metadata as importlib_metadata
import os
import site
from pathlib import Path


_DLL_DIR_HANDLES = []


def _package_version(name: str) -> str | None:
    try:
        return importlib_metadata.version(name)
    except importlib_metadata.PackageNotFoundError:
        return None
    except Exception:
        return None


def _existing_dirs() -> list[str]:
    out: list[str] = []

    try:
        import torch
        out.append(str((Path(torch.__file__).resolve().parent / "lib")))
    except Exception:
        pass

    for env_name, env_value in os.environ.items():
        if env_name == "CUDA_PATH" or env_name.startswith("CUDA_PATH_V"):
            if env_value:
                out.append(str(Path(env_value) / "bin"))

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
                out.append(str(base / rel))
            try:
                for child in base.iterdir():
                    if not child.is_dir():
                        continue
                    if child.name.lower().startswith("nvidia"):
                        for nested in (child / "bin", child / "lib", child / "Library" / "bin"):
                            out.append(str(nested))
            except Exception:
                pass
    except Exception:
        pass

    dedup: list[str] = []
    seen: set[str] = set()
    for raw in out:
        try:
            p = str(Path(raw).resolve())
        except Exception:
            p = raw
        low = p.lower()
        if low in seen or not os.path.isdir(p):
            continue
        seen.add(low)
        dedup.append(p)
    return dedup


def _prime() -> list[str]:
    added: list[str] = []
    if os.name != "nt":
        return added
    parts = os.environ.get("PATH", "").split(os.pathsep) if os.environ.get("PATH") else []
    lower = {x.lower() for x in parts}
    global _DLL_DIR_HANDLES
    for dll_dir in _existing_dirs():
        if hasattr(os, "add_dll_directory"):
            try:
                handle = os.add_dll_directory(dll_dir)
                _DLL_DIR_HANDLES.append(handle)
            except OSError:
                pass
        if dll_dir.lower() not in lower:
            parts.insert(0, dll_dir)
            lower.add(dll_dir.lower())
            added.append(dll_dir)
    os.environ["PATH"] = os.pathsep.join(parts)
    return added


def _dist_info_paths() -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for site_dir in site.getsitepackages():
        base = Path(site_dir)
        for pattern in ("onnxruntime-*.dist-info", "onnxruntime_gpu-*.dist-info"):
            for p in base.glob(pattern):
                key = str(p).lower()
                if key in seen:
                    continue
                seen.add(key)
                found.append(str(p))
    return found


def main() -> int:
    print("== verify_onnx_gpu ==")
    added = _prime()
    if added:
        print("Primed DLL dirs:")
        for path in added:
            print(f"  - {path}")

    try:
        import torch
        print(
            f"torch={torch.__version__} cuda={torch.version.cuda} "
            f"cudnn={torch.backends.cudnn.version()} is_cuda={torch.cuda.is_available()}"
        )
    except Exception as e:
        print(f"[FAIL] torch import failed: {type(e).__name__}: {e}")
        return 1

    print(f"dist onnxruntime={_package_version('onnxruntime') or '(none)'}")
    print(f"dist onnxruntime-gpu={_package_version('onnxruntime-gpu') or '(none)'}")
    dist_info_paths = _dist_info_paths()
    if dist_info_paths:
        print('dist-info paths:')
        for path in dist_info_paths:
            print(f'  - {path}')
    for name in (
        "nvidia-cuda-runtime-cu12",
        "nvidia-cudnn-cu12",
        "nvidia-cublas-cu12",
        "nvidia-cufft-cu12",
        "nvidia-curand-cu12",
    ):
        print(f"dist {name}={_package_version(name) or '(none)'}")

    try:
        import onnxruntime as ort
    except Exception as e:
        print(f"[FAIL] onnxruntime import failed: {type(e).__name__}: {e}")
        return 1

    if hasattr(ort, "preload_dlls"):
        for kwargs in ({}, {"directory": ""}):
            try:
                ort.preload_dlls(**kwargs)
                print(f"onnxruntime.preload_dlls{kwargs}: ok")
            except Exception as e:
                print(f"onnxruntime.preload_dlls{kwargs}: {type(e).__name__}: {e}")

    providers = ort.get_available_providers()
    print(f"onnxruntime={getattr(ort, '__version__', 'unknown')} providers={providers}")

    if hasattr(ort, "print_debug_info"):
        try:
            ort.print_debug_info()
        except Exception as e:
            print(f"onnxruntime.print_debug_info(): {type(e).__name__}: {e}")

    if "CUDAExecutionProvider" not in providers:
        cpu_ver = _package_version('onnxruntime')
        gpu_ver = _package_version('onnxruntime-gpu')
        if cpu_ver and gpu_ver:
            print('[HINT] CPU/GPU onnxruntime packages are both installed. Remove both, scrub stale dist-info, then install only onnxruntime-gpu.')
        print("[FAIL] CUDAExecutionProvider not available")
        return 2

    print("[OK] CUDAExecutionProvider available")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
