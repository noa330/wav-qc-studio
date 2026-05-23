from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

NoiseDevicePreference = Literal["auto", "cuda", "cpu"]
ResembleTask = Literal["enhance", "denoise_only"]
SidonStereoMixMode = Literal["average", "left", "right"]
SidonOutputBitDepth = Literal["pcm16", "float32"]
SidonAudioBackendPreference = Literal["auto", "soundfile", "ffmpeg", "sox", "soundfile_direct"]
SessionStatus = Literal["idle", "running", "completed", "completed_with_errors", "failed"]
JobStatus = Literal["queued", "running", "completed", "completed_with_errors", "failed"]


@dataclass(slots=True)
class NoiseInferenceSettings:
    use_voicefixer: bool = True
    voicefixer_mode: int = 0
    voicefixer_device_preference: NoiseDevicePreference = "auto"
    use_resemble: bool = True
    resemble_task: ResembleTask = "enhance"
    resemble_solver: str = "midpoint"
    resemble_nfe: int = 64
    resemble_tau: float = 0.5
    resemble_lambda: float = 0.9
    resemble_device_preference: NoiseDevicePreference = "auto"
    use_sidon: bool = False
    sidon_device_preference: NoiseDevicePreference = "auto"
    sidon_input_peak: float = 0.9
    sidon_high_pass_hz: float = 50.0
    sidon_chunk_seconds: int = 96
    sidon_pre_padding: int = 160
    sidon_trailing_pad: int = 24000
    sidon_decoder_trim: int = 960
    sidon_stereo_mix_mode: SidonStereoMixMode = "average"
    sidon_output_bit_depth: SidonOutputBitDepth = "pcm16"
    sidon_audio_backend_preference: SidonAudioBackendPreference = "auto"
    sidon_feature_cache_frames: int = 1

    def normalize(self) -> "NoiseInferenceSettings":
        self.voicefixer_mode = max(0, min(2, int(self.voicefixer_mode)))
        self.voicefixer_device_preference = normalize_device(self.voicefixer_device_preference)
        self.resemble_solver = normalize_solver(self.resemble_solver)
        self.resemble_nfe = max(1, min(128, int(self.resemble_nfe)))
        self.resemble_tau = clamp_unit_value(self.resemble_tau)
        self.resemble_lambda = clamp_unit_value(self.resemble_lambda)
        self.resemble_device_preference = normalize_device(self.resemble_device_preference)
        self.sidon_device_preference = normalize_device(self.sidon_device_preference)
        self.sidon_input_peak = clamp_float(self.sidon_input_peak, 0.0, 1.0, 3)
        self.sidon_high_pass_hz = clamp_float(self.sidon_high_pass_hz, 0.0, 1000.0, 1)
        self.sidon_chunk_seconds = max(1, min(600, int(self.sidon_chunk_seconds)))
        self.sidon_pre_padding = max(0, min(480000, int(self.sidon_pre_padding)))
        self.sidon_trailing_pad = max(0, min(480000, int(self.sidon_trailing_pad)))
        self.sidon_decoder_trim = max(0, min(480000, int(self.sidon_decoder_trim)))
        self.sidon_stereo_mix_mode = normalize_stereo_mix_mode(self.sidon_stereo_mix_mode)
        self.sidon_output_bit_depth = normalize_output_bit_depth(self.sidon_output_bit_depth)
        self.sidon_audio_backend_preference = normalize_audio_backend_preference(self.sidon_audio_backend_preference)
        self.sidon_feature_cache_frames = max(0, min(8, int(self.sidon_feature_cache_frames)))
        if self.resemble_task not in {"enhance", "denoise_only"}:
            self.resemble_task = "enhance"
        return self

    def model_labels(self) -> list[str]:
        labels: list[str] = []
        if self.use_voicefixer:
            labels.append("VoiceFixer")
        if self.use_resemble:
            labels.append("Resemble Enhance")
        if self.use_sidon:
            labels.append("Sidon")
        return labels

    def target_label(self) -> str:
        labels = self.model_labels()
        if not labels:
            return "-"
        if len(labels) == 1:
            return labels[0]
        return " + ".join(labels)

    def to_manifest_dict(self) -> dict[str, object]:
        same_device = (
            self.voicefixer_device_preference == self.resemble_device_preference
            and self.resemble_device_preference == self.sidon_device_preference
        )
        return {
            "useVoiceFixer": self.use_voicefixer,
            "voiceFixerMode": self.voicefixer_mode,
            "voiceFixerDevicePreference": self.voicefixer_device_preference,
            "useResemble": self.use_resemble,
            "resembleTask": self.resemble_task,
            "resembleSolver": self.resemble_solver,
            "resembleNfe": self.resemble_nfe,
            "resembleTau": self.resemble_tau,
            "resembleLambda": self.resemble_lambda,
            "resembleDevicePreference": self.resemble_device_preference,
            "useSidon": self.use_sidon,
            "sidonDevicePreference": self.sidon_device_preference,
            "sidonInputPeak": self.sidon_input_peak,
            "sidonHighPassHz": self.sidon_high_pass_hz,
            "sidonChunkSeconds": self.sidon_chunk_seconds,
            "sidonPrePadding": self.sidon_pre_padding,
            "sidonTrailingPad": self.sidon_trailing_pad,
            "sidonDecoderTrim": self.sidon_decoder_trim,
            "sidonStereoMixMode": self.sidon_stereo_mix_mode,
            "sidonOutputBitDepth": self.sidon_output_bit_depth,
            "sidonAudioBackendPreference": self.sidon_audio_backend_preference,
            "sidonFeatureCacheFrames": self.sidon_feature_cache_frames,
            "devicePreference": self.voicefixer_device_preference if same_device else "auto",
        }


def normalize_device(value: str | None) -> NoiseDevicePreference:
    lowered = (value or "").strip().lower()
    if lowered == "cuda":
        return "cuda"
    if lowered == "cpu":
        return "cpu"
    return "auto"


def normalize_solver(value: str | None) -> str:
    lowered = (value or "").strip().lower()
    if lowered in {"midpoint", "rk4", "euler"}:
        return lowered
    return "midpoint"


def normalize_stereo_mix_mode(value: str | None) -> SidonStereoMixMode:
    lowered = (value or "").strip().lower()
    if lowered == "left":
        return "left"
    if lowered == "right":
        return "right"
    return "average"


def normalize_output_bit_depth(value: str | None) -> SidonOutputBitDepth:
    lowered = (value or "").strip().lower()
    if lowered == "float32":
        return "float32"
    return "pcm16"


def normalize_audio_backend_preference(value: str | None) -> SidonAudioBackendPreference:
    lowered = (value or "").strip().lower().replace("-", "_")
    if lowered in {"soundfile", "ffmpeg", "sox", "soundfile_direct"}:
        return lowered  # type: ignore[return-value]
    return "auto"


def clamp_unit_value(value: float) -> float:
    return max(0.0, min(1.0, round(float(value), 2)))


def clamp_float(value: float, minimum: float, maximum: float, decimals: int) -> float:
    return max(minimum, min(maximum, round(float(value), decimals)))


@dataclass(slots=True)
class NoiseJob:
    file_name: str
    original_path: str
    status: JobStatus = "queued"
    active_stage: str = "queued"
    model_label: str = "-"
    target_label: str = "-"
    voicefixer_output_path: str = ""
    resemble_output_path: str = ""
    sidon_output_path: str = ""
    final_output_path: str = ""
    error: str = ""
    failed_stages: str = ""

    @classmethod
    def from_path(cls, wav_path: Path, settings: NoiseInferenceSettings) -> "NoiseJob":
        return cls(
            file_name=wav_path.name,
            original_path=str(wav_path.resolve()),
            status="queued",
            active_stage="queued",
            model_label=settings.target_label(),
            target_label=settings.target_label(),
        )

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "fileName": self.file_name,
            "originalPath": self.original_path,
            "status": self.status,
            "activeStage": self.active_stage,
            "modelLabel": self.model_label,
            "targetLabel": self.target_label,
            "voiceFixerOutputPath": self.voicefixer_output_path,
            "resembleOutputPath": self.resemble_output_path,
            "sidonOutputPath": self.sidon_output_path,
            "finalOutputPath": self.final_output_path,
            "error": self.error,
            "failedStages": self.failed_stages,
        }


@dataclass(slots=True)
class NoiseSummary:
    total_files: int = 0
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0
    progress: float = 0.0

    @classmethod
    def from_jobs(cls, jobs: list[NoiseJob], total_files: int | None = None) -> "NoiseSummary":
        total = max(0, int(total_files)) if total_files is not None else len(jobs)
        running = sum(1 for job in jobs if job.status == "running")
        completed = sum(1 for job in jobs if job.status in {"completed", "completed_with_errors"})
        failed = sum(1 for job in jobs if job.status == "failed")
        finished = completed + failed
        queued = max(0, total - finished - running)
        progress = (finished / total) if total else 0.0
        return cls(
            total_files=total,
            queued=queued,
            running=running,
            completed=completed,
            failed=failed,
            progress=progress,
        )

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "totalFiles": self.total_files,
            "queued": self.queued,
            "running": self.running,
            "completed": self.completed,
            "failed": self.failed,
            "progress": self.progress,
        }


@dataclass(slots=True)
class NoiseSession:
    input_folder: str
    output_dir: str
    manifest_path: str
    settings: NoiseInferenceSettings
    jobs: list[NoiseJob] = field(default_factory=list)
    session_status: SessionStatus = "idle"
    total_files: int | None = None

    def build_manifest(self) -> dict[str, object]:
        summary = NoiseSummary.from_jobs(self.jobs, self.total_files)
        return {
            "sessionStatus": self.session_status,
            "inputFolder": self.input_folder,
            "outputDir": self.output_dir,
            "manifestPath": self.manifest_path,
            "settings": self.settings.to_manifest_dict(),
            "summary": summary.to_manifest_dict(),
            "jobs": [job.to_manifest_dict() for job in self.jobs],
        }
