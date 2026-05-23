from __future__ import annotations

import threading
import warnings
from pathlib import Path
from typing import Callable, Literal

import torch

from ..model_setup import bind_voicefixer_local_cache, ensure_model_available
from ..runtime import resolve_device
from ...runtime import suppress_external_console

LogFn = Callable[[str], None]
ProgressFn = Callable[[str], None]
VoiceFixerMode = Literal[0, 1, 2]


class VoiceFixerRuntime:
    def __init__(self, use_cuda: bool, log: LogFn) -> None:
        bind_voicefixer_local_cache(log)
        ensure_model_available("voicefixer", log)
        warnings.filterwarnings("ignore", message="pkg_resources is deprecated as an API.*", category=UserWarning)
        with suppress_external_console():
            from voicefixer import VoiceFixer  # type: ignore

        self.use_cuda = use_cuda
        log(f"[모델 로딩] VoiceFixer 엔진 초기화 중 · 장치={'CUDA' if use_cuda else 'CPU'}")
        with suppress_external_console():
            self.model = VoiceFixer()
        log("[모델 로딩 완료] VoiceFixer 엔진 준비 완료")

    def restore(self, input_path: Path, output_path: Path, mode: int, log: LogFn, on_detail_changed: ProgressFn | None = None) -> None:
        if on_detail_changed is not None:
            on_detail_changed(f"VoiceFixer 실행 · mode={int(mode)}")
        with suppress_external_console():
            self.model.restore(
                input=str(input_path),
                output=str(output_path),
                cuda=self.use_cuda,
                mode=int(mode),
            )


_RUNTIME_LOCK = threading.Lock()
_RUNTIMES: dict[bool, VoiceFixerRuntime] = {}


def get_voicefixer_runtime(device_preference: str, log: LogFn) -> VoiceFixerRuntime:
    _device, use_cuda = resolve_device(device_preference, log)
    with _RUNTIME_LOCK:
        runtime = _RUNTIMES.get(use_cuda)
        if runtime is None:
            runtime = VoiceFixerRuntime(use_cuda=use_cuda, log=log)
            _RUNTIMES[use_cuda] = runtime
        return runtime


def prepare_voicefixer(device_preference: str, log: LogFn) -> None:
    _ = get_voicefixer_runtime(device_preference, log)


def run_voicefixer(
    input_path: Path,
    output_dir: Path,
    mode: VoiceFixerMode,
    device_preference: str,
    log: LogFn,
    on_detail_changed: ProgressFn | None = None,
) -> Path:
    runtime = get_voicefixer_runtime(device_preference, log)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}_voicefixer_mode{int(mode)}.wav"

    runtime.restore(input_path=input_path, output_path=output_path, mode=int(mode), log=log, on_detail_changed=on_detail_changed)
    if runtime.use_cuda:
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
    return output_path
