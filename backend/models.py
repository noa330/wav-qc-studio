from __future__ import annotations

"""Compatibility exports for older imports.

Internal code should import from backend.analyzers and backend.runtime.
"""

from .analyzers import (
    KoreanPronunciationAnalyzer,
    LocalSpeakerEmbedding,
    NoiseScorer,
    SpeakerAnalyzer,
    WhisperPronunciationScorer,
)
from .runtime import (
    CONFIG_PATH,
    ensure_gpu_runtime_for_onnx,
    ensure_runtime_ready,
    get_runtime_cuda_index,
    get_runtime_device,
    get_runtime_device_str,
    get_runtime_device_str_for_onnx,
    get_runtime_summary,
    load_config,
    patch_torchmetrics_dnsmos_for_ort,
    suppress_external_console,
)

__all__ = [
    "CONFIG_PATH",
    "KoreanPronunciationAnalyzer",
    "LocalSpeakerEmbedding",
    "NoiseScorer",
    "SpeakerAnalyzer",
    "WhisperPronunciationScorer",
    "ensure_gpu_runtime_for_onnx",
    "ensure_runtime_ready",
    "get_runtime_cuda_index",
    "get_runtime_device",
    "get_runtime_device_str",
    "get_runtime_device_str_for_onnx",
    "get_runtime_summary",
    "load_config",
    "patch_torchmetrics_dnsmos_for_ort",
    "suppress_external_console",
]
