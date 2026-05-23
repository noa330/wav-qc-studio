from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

import numpy as np

from .audio_ops import TARGET_SR, read_audio_frames, resample_linear, to_mono, write_wav
from .schema import SlicerSettings
from ..runtime import hf_repo_dir, hf_snapshot_download, suppress_external_console

LogFn = Callable[[str], None]

MODEL_REPO_ID = "FireRedTeam/FireRedVAD"
LEGACY_MODELS_DIR = Path(__file__).resolve().parent / "models" / "FireRedVAD"
MODELS_DIR = hf_repo_dir(MODEL_REPO_ID, namespace="slicer")
AED_DIR = MODELS_DIR / "AED"
MODEL_REQUIRED_FILES = [AED_DIR / "cmvn.ark", AED_DIR / "model.pth.tar"]


class FireRedSpeechDetector:
    def __init__(self) -> None:
        self._detector = None
        self._device_key = ""

    def ensure_model(self, log: LogFn) -> None:
        self._migrate_legacy_model(log)
        if all(path.exists() and path.stat().st_size > 0 for path in MODEL_REQUIRED_FILES):
            log(f"[모델 확인 완료] FireRedVAD 준비됨: {AED_DIR}")
            return

        missing = [str(path) for path in MODEL_REQUIRED_FILES if not path.exists()]
        log("[모델 다운로드] FireRedVAD 필수 파일이 없어 Hugging Face에서 받습니다.")
        if missing:
            for item in missing:
                log(f"[모델 캐시] 없음: {item}")

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        hf_snapshot_download(
            repo_id=MODEL_REPO_ID,
            local_dir=str(MODELS_DIR),
            log=log,
            label="FireRedVAD",
            allow_patterns=["AED/*"],
        )

        missing_after = [str(path) for path in MODEL_REQUIRED_FILES if not path.exists()]
        if missing_after:
            raise RuntimeError("FireRedVAD model download finished, but files are still missing: " + ", ".join(missing_after))

        log(f"[모델 다운로드 완료] FireRedVAD: {AED_DIR}")

    def _migrate_legacy_model(self, log: LogFn) -> None:
        if AED_DIR.exists() or not LEGACY_MODELS_DIR.exists():
            return
        legacy_aed = LEGACY_MODELS_DIR / "AED"
        if not legacy_aed.exists():
            return
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copytree(LEGACY_MODELS_DIR, MODELS_DIR, dirs_exist_ok=True)
        log(f"[model cache] FireRedVAD legacy cache migrated: {MODELS_DIR}")

    def detect(
        self,
        source_path: Path,
        work_dir: Path,
        settings: SlicerSettings,
        log: LogFn,
    ) -> list[tuple[float, float]]:
        self.ensure_model(log)
        prepared_audio = self._prepare_audio_file(source_path, work_dir)
        detector = self._get_detector(settings, log)
        with suppress_external_console():
            result, _ = detector.detect(str(prepared_audio))
        return self._extract_speech_segments(result)

    def _prepare_audio_file(self, source_path: Path, work_dir: Path) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        audio, sample_rate, _ = read_audio_frames(source_path)
        mono = to_mono(audio)
        mono = resample_linear(mono, sample_rate, TARGET_SR)
        mono = np.clip(mono.astype(np.float32, copy=False), -1.0, 1.0)
        prepared_path = work_dir / f"{source_path.stem}_prepared_16k_mono.wav"
        write_wav(prepared_path, mono, TARGET_SR)
        return prepared_path

    def _get_detector(self, settings: SlicerSettings, log: LogFn):
        import torch
        from fireredvad import FireRedAed, FireRedAedConfig

        if settings.device_preference == "cpu":
            use_gpu = False
        elif settings.device_preference == "cuda":
            use_gpu = torch.cuda.is_available()
            if not use_gpu:
                log("[모델 장치] CUDA 요청됨, 사용할 수 없어 CPU로 전환합니다.")
        else:
            use_gpu = torch.cuda.is_available()

        device_key = "cuda" if use_gpu else "cpu"
        if self._detector is not None and self._device_key == device_key:
            return self._detector

        config = FireRedAedConfig(
            use_gpu=use_gpu,
            smooth_window_size=settings.smooth_window_size,
            speech_threshold=settings.speech_threshold,
            singing_threshold=0.5,
            music_threshold=0.5,
            min_event_frame=settings.min_event_frame,
            max_event_frame=settings.max_event_frame,
            min_silence_frame=settings.min_silence_frame,
            merge_silence_frame=settings.merge_silence_frame,
            extend_speech_frame=settings.extend_speech_frame,
            chunk_max_frame=settings.chunk_max_frame,
        )
        log(f"[model loading] FireRedVAD runtime device={device_key}")
        with suppress_external_console():
            self._detector = FireRedAed.from_pretrained(str(AED_DIR), config)
        self._device_key = device_key
        log("[model loaded] FireRedVAD runtime ready")
        return self._detector

    @staticmethod
    def _extract_speech_segments(result: dict) -> list[tuple[float, float]]:
        raw_segments = result.get("event2timestamps", {}).get("speech", [])
        segments: list[tuple[float, float]] = []
        for item in raw_segments:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            try:
                start = float(item[0])
                end = float(item[1])
            except (TypeError, ValueError):
                continue
            if end > start:
                segments.append((max(0.0, start), max(0.0, end)))
        segments.sort(key=lambda pair: (pair[0], pair[1]))
        return segments
