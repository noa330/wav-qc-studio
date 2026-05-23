from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file as load_safetensors
from transformers import WhisperForConditionalGeneration, WhisperProcessor

from ..audio_utils import read_audio
from ..runtime import get_runtime_device, get_runtime_device_str, hf_hub_download, hf_repo_dir, hf_snapshot_download, suppress_external_console, transformer_cache_kwargs

SCORER_REQUIRED_FILES = (
    "preprocessor_config.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "normalizer.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "config.json",
    "generation_config.json",
    "model.safetensors",
)

WHISPER_BASE_REPO_ID = "openai/whisper-small"
WHISPER_BASE_REQUIRED_FILES = (
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "normalizer.json",
    "special_tokens_map.json",
    "model.safetensors",
    "pytorch_model.bin",
)


class WhisperPronunciationScorer(torch.nn.Module):
    def __init__(self, pretrained_model: WhisperForConditionalGeneration) -> None:
        super().__init__()
        self.whisper = pretrained_model
        self.score_head = torch.nn.Linear(self.whisper.config.d_model, 1)

    def forward(self, input_features: torch.Tensor, labels: torch.Tensor | None = None) -> torch.Tensor:
        outputs = self.whisper(input_features=input_features, labels=labels, output_hidden_states=True)
        last_hidden_state = outputs.decoder_hidden_states[-1]
        scores = self.score_head(last_hidden_state.mean(dim=1)).squeeze(-1)
        return scores


class KoreanPronunciationAnalyzer:
    def __init__(self, cfg: dict[str, Any], language: str | None = None) -> None:
        self.cfg = cfg["pronunciation"]
        self.language = self._normalize_language(language if language is not None else self.cfg.get("language", "ko"))
        self.device = get_runtime_device()
        self.device_str = get_runtime_device_str()

        asr_model = str(self.cfg["asr_model"])
        compute_type = str(
            self.cfg.get(
                "compute_type_cuda" if self.device_str == "cuda" else "compute_type_cpu",
                "float16" if self.device_str == "cuda" else "int8",
            )
        )
        from faster_whisper import WhisperModel

        print(f"[모델 로딩] 발음 평가 ASR 준비 중 · {asr_model} · device={self.device_str}")
        asr_model_path = self._resolve_faster_whisper_model(asr_model)
        with suppress_external_console():
            self.asr = WhisperModel(asr_model_path, device=self.device_str, compute_type=compute_type)
        self.repo_id = self.cfg["scorer_repo_id"]
        print(f"[모델 로딩] 발음 평가 보조 모델 준비 중 · repo={self.repo_id}")
        scorer_dir = self._resolve_scorer_dir(self.repo_id)
        base_dir = self._resolve_whisper_base_dir()
        with suppress_external_console():
            self.processor = WhisperProcessor.from_pretrained(scorer_dir, **transformer_cache_kwargs())
            base = WhisperForConditionalGeneration.from_pretrained(base_dir, **transformer_cache_kwargs())
        self.model = WhisperPronunciationScorer(base)
        state_path = Path(scorer_dir) / "model.safetensors"
        if not state_path.exists():
            state_path = Path(hf_hub_download(repo_id=self.repo_id, filename="model.safetensors", local_dir=scorer_dir, log=print, label="pronunciation scorer weights"))
        state = load_safetensors(state_path)
        self.model.load_state_dict(state, strict=False)
        self.model.to(self.device)
        self.model.eval()
        print("[모델 로딩 완료] 발음 평가 모델 준비 완료")

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
        return hf_snapshot_download(repo_id, local_dir=local_dir, log=print, label="faster-whisper ASR")

    @staticmethod
    def _resolve_scorer_dir(repo_id: str) -> str:
        local_dir = hf_repo_dir(repo_id)
        missing = [name for name in SCORER_REQUIRED_FILES if not (local_dir / name).exists()]
        if missing:
            print(f"[model cache] pronunciation scorer missing files: {', '.join(missing)}")
            return hf_snapshot_download(
                repo_id,
                local_dir=local_dir,
                log=print,
                label="pronunciation scorer",
                allow_patterns=list(SCORER_REQUIRED_FILES),
            )

        print(f"[model cache] pronunciation scorer ready: {local_dir}")
        return str(local_dir)

    @staticmethod
    def _resolve_whisper_base_dir() -> str:
        local_dir = hf_repo_dir(WHISPER_BASE_REPO_ID, namespace="transformers")
        has_config = (local_dir / "config.json").exists()
        has_weights = (local_dir / "model.safetensors").exists() or (local_dir / "pytorch_model.bin").exists()
        if has_config and has_weights:
            print(f"[model cache] pronunciation base model ready: {local_dir}")
            return str(local_dir)

        print(f"[model cache] pronunciation base model missing files: {WHISPER_BASE_REPO_ID}")
        return hf_snapshot_download(
            WHISPER_BASE_REPO_ID,
            local_dir=local_dir,
            log=print,
            label="pronunciation base model",
            allow_patterns=list(WHISPER_BASE_REQUIRED_FILES),
        )

    @staticmethod
    def _normalize_language(value: Any) -> str | None:
        normalized = str(value or "").strip().lower()
        if normalized in {"", "auto", "detect"}:
            return None
        return normalized

    def transcribe(self, wav_path: str) -> tuple[str, float | None, str]:
        with suppress_external_console():
            segments, _info = self.asr.transcribe(
                wav_path,
                language=self.language,
                vad_filter=bool(self.cfg.get("vad_filter", True)),
                beam_size=int(self.cfg.get("beam_size", 5)),
                condition_on_previous_text=False,
            )
            segments_list = list(segments)
        text = " ".join(seg.text.strip() for seg in segments_list if getattr(seg, "text", "").strip()).strip()
        logps = [float(seg.avg_logprob) for seg in segments_list if hasattr(seg, "avg_logprob")]
        avg_logprob = float(np.mean(logps)) if logps else None
        detected_language = str(getattr(_info, "language", "") or "").strip().lower()
        resolved_language = self.language or detected_language
        return text, avg_logprob, resolved_language

    def score(self, wav_path: str) -> dict[str, Any]:
        transcript, avg_logprob, language = self.transcribe(wav_path)
        wav, sr = read_audio(wav_path, target_sr=16000, mono=True)
        with suppress_external_console():
            input_features = self.processor(wav, sampling_rate=16000, return_tensors="pt").input_features.to(self.device)
            labels = self.processor(text=transcript or " ", return_tensors="pt").input_ids.to(self.device)

        with torch.inference_mode():
            raw_score = self.model(input_features=input_features, labels=labels)
            if raw_score.ndim:
                raw_score = raw_score.mean()
            raw_score_value = float(raw_score.detach().cpu().item())

        min_score = float(self.cfg.get("min_score", 1.0))
        max_score = float(self.cfg.get("max_score", 5.0))
        score = max(min(raw_score_value, max_score), min_score)
        bad = score < float(self.cfg["bad_threshold"])

        return {
            "transcript": transcript,
            "language": language,
            "pronunciation_score_1to5": round(score, 3),
            "pronunciation_flag_bad": "O" if bad else "X",
            "_avg_logprob": avg_logprob,
        }
