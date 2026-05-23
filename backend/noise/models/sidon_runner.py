from __future__ import annotations

import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf
import torch
import torchaudio

from ...console_ui import render_progress_bar
from ...runtime import hf_hub_download, hf_repo_dir, hf_snapshot_download, suppress_external_console, transformer_cache_kwargs
from ..runtime import resolve_device

LogFn = Callable[[str], None]
ProgressFn = Callable[[str], None]
MODEL_REPO_ID = "sarulab-speech/sidon-v0.1"
PREPROCESSOR_REPO_ID = "facebook/w2v-bert-2.0"
TARGET_SAMPLE_RATE = 48_000
FEATURE_SAMPLE_RATE = 16_000
HIGH_PASS_HZ = 50
CHUNK_SECONDS = 96
PRE_PADDING = 160
TRAILING_PAD = 24_000
DECODER_TRIM = 960

SIDON_MODELS_DIR = hf_repo_dir(MODEL_REPO_ID, namespace="noise")
SIDON_PREPROCESSOR_DIR = hf_repo_dir(PREPROCESSOR_REPO_ID, namespace="noise")
PREPROCESSOR_REQUIRED_FILES = ("preprocessor_config.json",)


@dataclass(frozen=True)
class ModelFiles:
    feature_extractor: str
    decoder: str


@dataclass(frozen=True)
class SidonProcessingSettings:
    input_peak: float = 0.9
    high_pass_hz: float = 50.0
    chunk_seconds: int = 96
    pre_padding: int = 160
    trailing_pad: int = 24_000
    decoder_trim: int = 960
    stereo_mix_mode: str = "average"
    output_bit_depth: str = "pcm16"
    audio_backend_preference: str = "auto"
    feature_cache_frames: int = 1

    @classmethod
    def from_noise_settings(cls, settings: object | None) -> "SidonProcessingSettings":
        if settings is None:
            return cls()
        return cls(
            input_peak=float(getattr(settings, "sidon_input_peak", 0.9)),
            high_pass_hz=float(getattr(settings, "sidon_high_pass_hz", 50.0)),
            chunk_seconds=int(getattr(settings, "sidon_chunk_seconds", 96)),
            pre_padding=int(getattr(settings, "sidon_pre_padding", 160)),
            trailing_pad=int(getattr(settings, "sidon_trailing_pad", 24_000)),
            decoder_trim=int(getattr(settings, "sidon_decoder_trim", 960)),
            stereo_mix_mode=str(getattr(settings, "sidon_stereo_mix_mode", "average")),
            output_bit_depth=str(getattr(settings, "sidon_output_bit_depth", "pcm16")),
            audio_backend_preference=str(getattr(settings, "sidon_audio_backend_preference", "auto")),
            feature_cache_frames=int(getattr(settings, "sidon_feature_cache_frames", 1)),
        ).normalize()

    def normalize(self) -> "SidonProcessingSettings":
        stereo = self.stereo_mix_mode if self.stereo_mix_mode in {"average", "left", "right"} else "average"
        bit_depth = "float32" if self.output_bit_depth == "float32" else "pcm16"
        backend = self.audio_backend_preference.replace("-", "_")
        if backend not in {"auto", "soundfile", "ffmpeg", "sox", "soundfile_direct"}:
            backend = "auto"
        return SidonProcessingSettings(
            input_peak=max(0.0, min(1.0, float(self.input_peak))),
            high_pass_hz=max(0.0, min(1000.0, float(self.high_pass_hz))),
            chunk_seconds=max(1, min(600, int(self.chunk_seconds))),
            pre_padding=max(0, min(480_000, int(self.pre_padding))),
            trailing_pad=max(0, min(480_000, int(self.trailing_pad))),
            decoder_trim=max(0, min(480_000, int(self.decoder_trim))),
            stereo_mix_mode=stereo,
            output_bit_depth=bit_depth,
            audio_backend_preference=backend,
            feature_cache_frames=max(0, min(8, int(self.feature_cache_frames))),
        )


CPU_FILES = ModelFiles(
    feature_extractor="feature_extractor_cpu.pt",
    decoder="decoder_cpu.pt",
)
CUDA_FILES = ModelFiles(
    feature_extractor="feature_extractor_cuda.pt",
    decoder="decoder_cuda.pt",
)


def ensure_dirs() -> None:
    SIDON_MODELS_DIR.mkdir(parents=True, exist_ok=True)


def load_audio_file(input_path: Path, backend_preference: str = "auto") -> tuple[torch.Tensor, int, str]:
    path_str = str(input_path)

    available_backends: list[str] = []
    try:
        available_backends = list(torchaudio.list_audio_backends())
    except Exception:
        available_backends = []

    preferred_backends = resolve_audio_backend_order(backend_preference, available_backends)
    errors: list[str] = []

    for backend in preferred_backends:
        if backend == "soundfile_direct":
            try:
                audio, sample_rate = sf.read(path_str, always_2d=True, dtype="float32")
                waveform = torch.from_numpy(audio.T.copy())
                return waveform, int(sample_rate), "soundfile"
            except Exception as exc:  # noqa: BLE001
                errors.append(f"soundfile-direct: {exc}")
                continue

        try:
            waveform, sample_rate = torchaudio.load(path_str, backend=backend)
            return waveform, sample_rate, f"torchaudio:{backend}"
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{backend}: {exc}")

    try:
        audio, sample_rate = sf.read(path_str, always_2d=True, dtype="float32")
        waveform = torch.from_numpy(audio.T.copy())
        return waveform, int(sample_rate), "soundfile"
    except Exception as exc:  # noqa: BLE001
        errors.append(f"soundfile-direct: {exc}")

    raise RuntimeError("오디오 파일을 읽지 못했습니다. 사용 가능한 백엔드 오류: " + " | ".join(errors))


def resolve_audio_backend_order(backend_preference: str, available_backends: list[str]) -> list[str]:
    default_order = ["soundfile", "ffmpeg", "sox", "soundfile_direct"]
    preference = (backend_preference or "auto").replace("-", "_")
    requested_order = default_order if preference == "auto" else [preference] + [backend for backend in default_order if backend != preference]

    order: list[str] = []
    for backend in requested_order:
        if backend == "soundfile_direct" or backend in available_backends:
            order.append(backend)
    return order


class SidonRestorer:
    def __init__(self, device: str, log: LogFn) -> None:
        ensure_dirs()
        self.log = log
        self.device = torch.device(device)
        self.model_files = CUDA_FILES if self.device.type == "cuda" else CPU_FILES
        self.preprocessor = None
        self.feature_extractor = None
        self.decoder = None
        self._load_lock = threading.Lock()

    def warmup(self) -> None:
        with self._load_lock:
            if self.preprocessor is not None and self.feature_extractor is not None and self.decoder is not None:
                return

            from transformers import SeamlessM4TFeatureExtractor  # type: ignore

            self.log(f"[모델 준비] Sidon 장치 선택: {self.device}")
            if self.device.type == "cpu":
                self.log("[모델 준비 안내] Sidon CPU 모드입니다. 첫 로딩과 추론이 느릴 수 있습니다.")

            try:
                backends = torchaudio.list_audio_backends()
                self.log(f"[런타임] Sidon 오디오 백엔드: {backends}")
            except Exception:
                self.log("[런타임 안내] Sidon 오디오 백엔드 목록을 확인하지 못했습니다.")

            self.log("[모델 로딩] Sidon 전처리기 준비 중...")
            preprocessor_dir = self._resolve_preprocessor_dir()
            with suppress_external_console():
                self.preprocessor = SeamlessM4TFeatureExtractor.from_pretrained(
                    preprocessor_dir,
                    **transformer_cache_kwargs(),
                )

            self.log(f"[모델 확인] Sidon 파일 점검: {self.model_files.feature_extractor}")
            feature_path = self._resolve_model_file(self.model_files.feature_extractor)
            self.log(f"[모델 확인] Sidon 파일 점검: {self.model_files.decoder}")
            decoder_path = self._resolve_model_file(self.model_files.decoder)

            self.log("[모델 로딩] Sidon TorchScript 엔진 로딩 중...")
            with suppress_external_console():
                self.feature_extractor = torch.jit.load(feature_path, map_location=self.device).to(self.device)
                self.decoder = torch.jit.load(decoder_path, map_location=self.device).to(self.device)
            self.feature_extractor.eval()
            self.decoder.eval()
            self.log("[모델 로딩 완료] Sidon 준비 완료")

    def _resolve_preprocessor_dir(self) -> str:
        missing = [name for name in PREPROCESSOR_REQUIRED_FILES if not (SIDON_PREPROCESSOR_DIR / name).exists()]
        if missing:
            self.log(f"[model download] Sidon preprocessor: {', '.join(missing)}")
            return hf_snapshot_download(
                PREPROCESSOR_REPO_ID,
                local_dir=SIDON_PREPROCESSOR_DIR,
                log=self.log,
                label="Sidon preprocessor",
                allow_patterns=list(PREPROCESSOR_REQUIRED_FILES),
            )

        self.log(f"[model cache ready] Sidon preprocessor: {SIDON_PREPROCESSOR_DIR}")
        return str(SIDON_PREPROCESSOR_DIR)

    def _resolve_model_file(self, filename: str) -> str:
        cached_path = SIDON_MODELS_DIR / filename
        if cached_path.exists() and cached_path.stat().st_size > 0:
            self.log(f"[model cache ready] Sidon: {filename}")
            return str(cached_path)
        return hf_hub_download(
            repo_id=MODEL_REPO_ID,
            filename=filename,
            local_dir=str(SIDON_MODELS_DIR),
            log=self.log,
            label="Sidon",
        )

    @torch.inference_mode()
    def restore_file(
        self,
        input_path: Path,
        output_path: Path,
        settings: SidonProcessingSettings,
        on_detail_changed: ProgressFn | None = None,
    ) -> None:
        self.warmup()
        assert self.preprocessor is not None
        assert self.feature_extractor is not None
        assert self.decoder is not None

        if on_detail_changed is not None:
            on_detail_changed("Sidon 입력 로딩")
        settings = settings.normalize()
        waveform, sample_rate, backend_name = load_audio_file(input_path, settings.audio_backend_preference)
        if waveform.numel() == 0:
            raise ValueError("오디오 데이터가 비어 있습니다.")

        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)
        if waveform.shape[0] > 1:
            if settings.stereo_mix_mode == "left":
                waveform = waveform[:1]
            elif settings.stereo_mix_mode == "right":
                waveform = waveform[-1:].clone()
            else:
                waveform = waveform.mean(dim=0, keepdim=True)

        waveform = waveform.to(torch.float32)
        peak = waveform.abs().max().item()
        if settings.input_peak > 0 and peak > 0:
            waveform = settings.input_peak * (waveform / peak)

        target_n_samples = int(TARGET_SAMPLE_RATE / sample_rate * waveform.shape[-1])

        if on_detail_changed is not None:
            on_detail_changed(f"Sidon 전처리 · backend={backend_name}")
        wav = waveform
        if settings.high_pass_hz > 0:
            wav = torchaudio.functional.highpass_biquad(waveform, sample_rate, settings.high_pass_hz)
        wav_16k = torchaudio.functional.resample(wav, sample_rate, FEATURE_SAMPLE_RATE)

        wav_16k = torch.nn.functional.pad(wav_16k, (0, settings.trailing_pad))
        chunk_size = FEATURE_SAMPLE_RATE * settings.chunk_seconds
        chunks = list(wav_16k.view(-1).split(chunk_size))
        if not chunks:
            raise ValueError("처리할 청크가 없습니다.")

        restored_segments: list[torch.Tensor] = []
        feature_cache = None

        for index, chunk in enumerate(chunks, start=1):
            if on_detail_changed is not None:
                bar = render_progress_bar(index, len(chunks))
                on_detail_changed(f"Sidon 청크 {index}/{len(chunks)} {bar}")
            padded_chunk = torch.nn.functional.pad(chunk, (settings.pre_padding, settings.pre_padding))
            inputs = self.preprocessor(
                padded_chunk,
                sampling_rate=FEATURE_SAMPLE_RATE,
                return_tensors="pt",
            )
            input_features = inputs["input_features"].to(self.device)
            feature = self.feature_extractor(input_features)["last_hidden_state"]
            if feature_cache is not None:
                feature = torch.cat([feature_cache, feature], dim=1)
            restored = self.decoder(feature.transpose(1, 2)).view(-1)
            if settings.decoder_trim > 0:
                restored = restored[:-settings.decoder_trim]
            restored_segments.append(restored)
            feature_cache = feature[:, -settings.feature_cache_frames:] if settings.feature_cache_frames > 0 else None

        restored_wav = torch.cat(restored_segments, dim=0)
        restored_wav = restored_wav[:target_n_samples]
        restored_np = restored_wav.clamp(-1.0, 1.0).cpu().numpy()

        output_path.parent.mkdir(parents=True, exist_ok=True)
        if settings.output_bit_depth == "float32":
            sf.write(str(output_path), restored_np.astype(np.float32), TARGET_SAMPLE_RATE, subtype="FLOAT")
        else:
            pcm16 = (restored_np * 32767.0).astype(np.int16)
            with wave.open(str(output_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(TARGET_SAMPLE_RATE)
                wav_file.writeframes(pcm16.tobytes())

        if on_detail_changed is not None:
            on_detail_changed(f"Sidon 결과 저장 완료 · {output_path.name}")
        if self.device.type == "cuda":
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass


_RUNTIMES: dict[str, SidonRestorer] = {}
_RUNTIME_LOCK = threading.Lock()


def get_sidon_runtime(device_preference: str, log: LogFn) -> SidonRestorer:
    device, _ = resolve_device(device_preference, log)
    with _RUNTIME_LOCK:
        runtime = _RUNTIMES.get(device)
        if runtime is None:
            runtime = SidonRestorer(device=device, log=log)
            _RUNTIMES[device] = runtime
        return runtime


def run_sidon(
    input_path: Path,
    output_dir: Path,
    device_preference: str,
    settings: object | None,
    log: LogFn,
    on_detail_changed: ProgressFn | None = None,
) -> Path:
    runtime = get_sidon_runtime(device_preference, log)
    sidon_settings = SidonProcessingSettings.from_noise_settings(settings)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}_sidon_restored.wav"
    runtime.restore_file(input_path=input_path, output_path=output_path, settings=sidon_settings, on_detail_changed=on_detail_changed)
    return output_path


def prepare_sidon(device_preference: str, log: LogFn) -> None:
    runtime = get_sidon_runtime(device_preference, log)
    runtime.warmup()
