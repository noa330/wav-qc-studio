from __future__ import annotations

from typing import Any

import numpy as np
import torch

from ..audio_utils import read_audio
from ..runtime import (
    ensure_gpu_runtime_for_onnx,
    get_runtime_device_str_for_onnx,
    patch_torchmetrics_dnsmos_for_ort,
    suppress_external_console,
)

class NoiseScorer:
    def __init__(self, cfg: dict[str, Any]) -> None:
        self.cfg = cfg["noise"]
        self.sample_rate = int(self.cfg.get("sample_rate", 16000))
        self.personalized = bool(self.cfg.get("personalized", False))
        self.num_threads = self.cfg.get("num_threads")
        print("[모델 준비] DNSMOS/ONNX 런타임 점검 중")
        if bool(self.cfg.get("require_cuda_provider", True)):
            ensure_gpu_runtime_for_onnx()
        print("[모델 준비 완료] DNSMOS/ONNX 런타임 준비 완료")

    def score(self, wav_path: str) -> dict[str, Any]:
        patch_torchmetrics_dnsmos_for_ort()
        with suppress_external_console():
            from torchmetrics.functional.audio.dnsmos import deep_noise_suppression_mean_opinion_score

        wav, _sr = read_audio(wav_path, target_sr=self.sample_rate, mono=True)
        tensor = torch.from_numpy(wav.astype(np.float32))
        with suppress_external_console():
            values = deep_noise_suppression_mean_opinion_score(
                preds=tensor,
                fs=self.sample_rate,
                personalized=self.personalized,
                device=get_runtime_device_str_for_onnx(),
                num_threads=self.num_threads,
            )
        vals = values.detach().cpu().numpy().tolist()
        if isinstance(vals[0], list):
            vals = vals[0]
        p808, sig, bak, ovr = [float(x) for x in vals]
        return {
            "noise_bak": round(bak, 3),
            "noise_sig": round(sig, 3),
            "noise_ovrl": round(ovr, 3),
            "noise_p808_mos": round(p808, 3),
        }
