from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable, Literal

import torch
import torchaudio

from ..model_setup import ensure_model_available, get_resemble_run_dir
from ..runtime import resolve_device
from ...runtime import suppress_external_console

LogFn = Callable[[str], None]
ProgressFn = Callable[[str], None]
ResembleTask = Literal["enhance", "denoise_only"]


def _bind_resemble_local_repo(local_run_dir: Path):
    import resemble_enhance.enhancer.inference as re_inf  # type: ignore

    def _use_local_run_dir(run_dir=None):
        return local_run_dir

    re_inf.download = _use_local_run_dir
    return re_inf


class ResembleRuntime:
    def __init__(self, device: str, log: LogFn) -> None:
        ensure_model_available("resemble", log)
        self.device = device
        self.local_run_dir = get_resemble_run_dir()
        self.re_inf = _bind_resemble_local_repo(local_run_dir=self.local_run_dir)
        self._warmup_done = False

    def warmup(self, log: LogFn) -> None:
        if self._warmup_done:
            return
        log(f"[모델 로딩] Resemble Enhance 준비 중 · 장치={self.device}")
        loader = getattr(self.re_inf, "load_enhancer", None)
        if callable(loader):
            attempts = (
                {"run_dir": self.local_run_dir, "device": self.device},
                {"device": self.device, "run_dir": self.local_run_dir},
                {"run_dir": self.local_run_dir},
                {"device": self.device},
                {},
            )
            for kwargs in attempts:
                try:
                    with suppress_external_console():
                        loader(**kwargs)
                    break
                except TypeError:
                    continue
                except Exception as exc:  # noqa: BLE001
                    log(f"[모델 로딩 안내] Resemble 사전 로딩을 건너뜁니다: {exc}")
                    break
        self._warmup_done = True
        log("[모델 로딩 완료] Resemble Enhance 준비 완료")


_RUNTIME_LOCK = threading.Lock()
_RUNTIMES: dict[str, ResembleRuntime] = {}


def get_resemble_runtime(device_preference: str, log: LogFn) -> ResembleRuntime:
    device, _ = resolve_device(device_preference, log)
    with _RUNTIME_LOCK:
        runtime = _RUNTIMES.get(device)
        if runtime is None:
            runtime = ResembleRuntime(device=device, log=log)
            _RUNTIMES[device] = runtime
        return runtime


def prepare_resemble(device_preference: str, log: LogFn) -> None:
    runtime = get_resemble_runtime(device_preference, log)
    runtime.warmup(log)


def run_resemble(
    input_path: Path,
    output_dir: Path,
    task: ResembleTask,
    solver: str,
    nfe: int,
    tau: float,
    lambd: float,
    device_preference: str,
    log: LogFn,
    on_detail_changed: ProgressFn | None = None,
) -> Path:
    runtime = get_resemble_runtime(device_preference, log)
    runtime.warmup(log)
    device = runtime.device

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / (
        f"{input_path.stem}_resemble_denoised.wav"
        if task == "denoise_only"
        else f"{input_path.stem}_resemble_enhanced.wav"
    )

    re_inf = runtime.re_inf
    local_run_dir = runtime.local_run_dir

    if on_detail_changed is not None:
        on_detail_changed(f"Resemble 로딩 · 장치={device}")
    dwav, sr = torchaudio.load(str(input_path))
    dwav = dwav.mean(dim=0)

    if task == "denoise_only":
        if on_detail_changed is not None:
            on_detail_changed("Resemble 추론 · denoise_only")
        with suppress_external_console():
            hwav, out_sr = re_inf.denoise(dwav=dwav, sr=sr, device=device, run_dir=local_run_dir)
    else:
        if on_detail_changed is not None:
            on_detail_changed(
                f"Resemble 추론 · enhance · solver={solver} · nfe={int(nfe)} · tau={float(tau):.2f} · lambda={float(lambd):.2f}"
            )
        with suppress_external_console():
            hwav, out_sr = re_inf.enhance(
                dwav=dwav,
                sr=sr,
                device=device,
                nfe=int(nfe),
                solver=solver,
                lambd=float(lambd),
                tau=float(tau),
                run_dir=local_run_dir,
            )

    torchaudio.save(str(output_path), hwav.unsqueeze(0).cpu(), int(out_sr))
    if device == "cuda":
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
    return output_path
