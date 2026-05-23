from __future__ import annotations

import unicodedata
from pathlib import Path
from typing import Any

import numpy as np

from ..runtime import get_runtime_device_str, hf_repo_dir, hf_snapshot_download, suppress_external_console

DEFAULT_INITIAL_PROMPT = ""


class BatchAsrTranscriber:
    """Batch QC automatic transcription backed by faster-whisper."""

    def __init__(self, cfg: dict[str, Any], language: str | None = None) -> None:
        self.cfg = _read_asr_config(cfg)
        self.language = self._normalize_language(language if language is not None else self.cfg.get("language", "auto"))
        self.device_str = get_runtime_device_str()
        compute_type_key = "compute_type_cuda" if self.device_str == "cuda" else "compute_type_cpu"
        self.compute_type = str(self.cfg.get(compute_type_key, "float16" if self.device_str == "cuda" else "int8"))
        self.initial_prompt = str(self.cfg.get("initial_prompt", DEFAULT_INITIAL_PROMPT) or "").strip()
        self.suppress_numerals = bool(self.cfg.get("suppress_numerals", True))

        from faster_whisper import WhisperModel

        asr_model = str(self.cfg.get("asr_model", "large-v3") or "large-v3")
        print(f"[model loading] Batch QC ASR readying - {asr_model} - device={self.device_str}")
        model_path = self._resolve_faster_whisper_model(asr_model)
        with suppress_external_console():
            self.asr = WhisperModel(model_path, device=self.device_str, compute_type=self.compute_type)
        self._numeral_suppress_tokens = _decimal_number_token_ids(self.asr.hf_tokenizer) if self.suppress_numerals else []
        print("[model loading complete] Batch QC ASR ready")

    def transcribe(self, wav_path: str | Path) -> dict[str, Any]:
        transcribe_kwargs: dict[str, Any] = {
            "language": self.language,
            "vad_filter": bool(self.cfg.get("vad_filter", True)),
            "beam_size": int(self.cfg.get("beam_size", 5)),
            "condition_on_previous_text": False,
        }
        if self.initial_prompt:
            transcribe_kwargs["initial_prompt"] = self.initial_prompt
        if self.suppress_numerals:
            transcribe_kwargs["suppress_tokens"] = [-1, *self._numeral_suppress_tokens]

        with suppress_external_console():
            segments, info = self.asr.transcribe(str(wav_path), **transcribe_kwargs)
            segments_list = list(segments)

        text = _segments_to_text(segments_list)
        logps = [float(segment.avg_logprob) for segment in segments_list if hasattr(segment, "avg_logprob")]
        avg_logprob = float(np.mean(logps)) if logps else None
        detected_language = str(getattr(info, "language", "") or "").strip().lower()
        return {
            "transcript": text,
            "language": self.language or detected_language,
            "avg_logprob": avg_logprob,
        }

    @staticmethod
    def _resolve_faster_whisper_model(model_name: str) -> str:
        model_path = Path(model_name)
        if model_path.exists():
            return str(model_path)

        repo_id = {
            "tiny": "Systran/faster-whisper-tiny",
            "tiny.en": "Systran/faster-whisper-tiny.en",
            "base": "Systran/faster-whisper-base",
            "base.en": "Systran/faster-whisper-base.en",
            "small": "Systran/faster-whisper-small",
            "small.en": "Systran/faster-whisper-small.en",
            "medium": "Systran/faster-whisper-medium",
            "medium.en": "Systran/faster-whisper-medium.en",
            "large-v1": "Systran/faster-whisper-large-v1",
            "large-v2": "Systran/faster-whisper-large-v2",
            "large-v3": "Systran/faster-whisper-large-v3",
            "large": "Systran/faster-whisper-large-v3",
        }.get(model_name.strip().lower(), model_name)
        local_dir = hf_repo_dir(repo_id, namespace="faster_whisper")
        return hf_snapshot_download(repo_id, local_dir=local_dir, log=print, label="Batch QC faster-whisper ASR")

    @staticmethod
    def _normalize_language(value: Any) -> str | None:
        normalized = str(value or "").strip().lower()
        if normalized in {"", "auto", "detect"}:
            return None
        return normalized


def _read_asr_config(cfg: dict[str, Any]) -> dict[str, Any]:
    batch_cfg = cfg.get("batch_transcription")
    if isinstance(batch_cfg, dict):
        return batch_cfg

    return {}


def _decimal_number_token_ids(tokenizer: Any) -> list[int]:
    eot = tokenizer.token_to_id("<|endoftext|>")
    max_text_token = int(eot) if isinstance(eot, int) else 50_000
    token_ids: set[int] = set()
    for token_id in set(tokenizer.get_vocab().values()):
        if not isinstance(token_id, int) or token_id >= max_text_token:
            continue
        try:
            text = tokenizer.decode([token_id])
        except Exception:  # noqa: BLE001
            continue
        if any(unicodedata.category(char) == "Nd" for char in text):
            token_ids.add(token_id)
    return sorted(token_ids)


def _segments_to_text(segments: list[Any]) -> str:
    pieces: list[str] = []
    for segment in segments:
        value = str(getattr(segment, "text", "") or "").strip()
        if value:
            pieces.append(value)
    return " ".join(pieces).strip()
