from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

SlicerDevicePreference = Literal["auto", "cuda", "cpu"]
SessionStatus = Literal["idle", "running", "completed", "completed_with_errors", "failed"]
JobStatus = Literal["queued", "running", "completed", "completed_with_errors", "failed"]
SliceStatus = Literal["queued", "running", "completed", "failed"]

PretrainedSedModelKey = Literal["beats", "atst_f", "fpasst"]


@dataclass(slots=True)
class SlicerSettings:
    split_gap_sec: float = 1.0
    device_preference: SlicerDevicePreference = "auto"
    speech_threshold: float = 0.40
    smooth_window_size: int = 5
    min_event_frame: int = 20
    max_event_frame: int = 2000
    min_silence_frame: int = 20
    merge_silence_frame: int = 0
    extend_speech_frame: int = 0
    chunk_max_frame: int = 30000
    speech_pad_ms: float = 10.0
    zero_cross_search_ms: float = 6.0
    quiet_boundary_search_ms: float = 500.0
    monitor_merge_gap_ms: float = 24.0
    monitor_merge_max_ms: float = 15000.0
    splice_ms: float = 35.0
    floor_gain_db: float = -120.0
    normalize_max: float = 0.9
    normalize_alpha: float = 0.25
    pretrained_sed_model_key: PretrainedSedModelKey = "beats"
    pretrained_sed_thresholds: tuple[float, ...] = (0.1, 0.2, 0.5)
    pretrained_sed_median_window: int = 9
    pretrained_sed_frame_interval: float = 0.04
    pretrained_sed_top_k: int = 10
    pretrained_sed_min_score: float = 0.0

    def normalize(self) -> "SlicerSettings":
        self.split_gap_sec = max(0.05, min(60.0, float(self.split_gap_sec)))
        self.device_preference = normalize_device(self.device_preference)
        self.speech_threshold = max(0.0, min(1.0, float(self.speech_threshold)))
        self.smooth_window_size = max(1, min(99, int(self.smooth_window_size)))
        self.min_event_frame = max(1, min(5000, int(self.min_event_frame)))
        self.max_event_frame = max(self.min_event_frame, min(30000, int(self.max_event_frame)))
        self.min_silence_frame = max(0, min(5000, int(self.min_silence_frame)))
        self.merge_silence_frame = max(0, min(5000, int(self.merge_silence_frame)))
        self.extend_speech_frame = max(0, min(5000, int(self.extend_speech_frame)))
        self.chunk_max_frame = max(1, min(120000, int(self.chunk_max_frame)))
        self.speech_pad_ms = max(0.0, min(2000.0, float(self.speech_pad_ms)))
        self.zero_cross_search_ms = max(0.0, min(100.0, float(self.zero_cross_search_ms)))
        self.quiet_boundary_search_ms = max(0.0, min(2000.0, float(self.quiet_boundary_search_ms)))
        self.monitor_merge_gap_ms = max(0.0, min(2000.0, float(self.monitor_merge_gap_ms)))
        self.monitor_merge_max_ms = max(0.0, min(600000.0, float(self.monitor_merge_max_ms)))
        self.splice_ms = max(0.0, min(500.0, float(self.splice_ms)))
        self.floor_gain_db = max(-120.0, min(0.0, float(self.floor_gain_db)))
        self.normalize_max = max(0.0, min(1.0, round(float(self.normalize_max), 3)))
        self.normalize_alpha = max(0.0, min(1.0, round(float(self.normalize_alpha), 3)))
        self.pretrained_sed_model_key = normalize_pretrained_sed_model_key(self.pretrained_sed_model_key)
        self.pretrained_sed_thresholds = normalize_thresholds(self.pretrained_sed_thresholds, (0.1, 0.2, 0.5))
        self.pretrained_sed_median_window = max(0, min(99, int(self.pretrained_sed_median_window)))
        self.pretrained_sed_frame_interval = max(0.04, min(30.0, float(self.pretrained_sed_frame_interval)))
        self.pretrained_sed_top_k = max(1, min(50, int(self.pretrained_sed_top_k)))
        self.pretrained_sed_min_score = max(0.0, min(1.0, float(self.pretrained_sed_min_score)))
        return self

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "splitGapSec": self.split_gap_sec,
            "devicePreference": self.device_preference,
            "speechThreshold": self.speech_threshold,
            "smoothWindowSize": self.smooth_window_size,
            "minEventFrame": self.min_event_frame,
            "maxEventFrame": self.max_event_frame,
            "minSilenceFrame": self.min_silence_frame,
            "mergeSilenceFrame": self.merge_silence_frame,
            "extendSpeechFrame": self.extend_speech_frame,
            "chunkMaxFrame": self.chunk_max_frame,
            "speechPadMs": self.speech_pad_ms,
            "zeroCrossSearchMs": self.zero_cross_search_ms,
            "quietBoundarySearchMs": self.quiet_boundary_search_ms,
            "monitorMergeGapMs": self.monitor_merge_gap_ms,
            "monitorMergeMaxMs": self.monitor_merge_max_ms,
            "spliceMs": self.splice_ms,
            "floorGainDb": self.floor_gain_db,
            "normalizeMax": self.normalize_max,
            "normalizeAlpha": self.normalize_alpha,
            "pretrainedSedModelKey": self.pretrained_sed_model_key,
            "pretrainedSedThresholds": list(self.pretrained_sed_thresholds),
            "pretrainedSedMedianWindow": self.pretrained_sed_median_window,
            "pretrainedSedFrameInterval": self.pretrained_sed_frame_interval,
            "pretrainedSedTopK": self.pretrained_sed_top_k,
            "pretrainedSedMinScore": self.pretrained_sed_min_score,
        }


def normalize_device(value: str | None) -> SlicerDevicePreference:
    lowered = (value or "").strip().lower()
    if lowered == "cuda":
        return "cuda"
    if lowered == "cpu":
        return "cpu"
    return "auto"


def normalize_pretrained_sed_model_key(value: str | None) -> PretrainedSedModelKey:
    lowered = (value or "").strip().lower()
    if lowered in {"beats", "atst_f", "fpasst"}:
        return lowered  # type: ignore[return-value]
    return "beats"


def normalize_thresholds(value: object, fallback: tuple[float, ...]) -> tuple[float, ...]:
    if isinstance(value, str):
        candidates = value.replace(";", ",").replace("\n", ",").split(",")
    elif isinstance(value, (list, tuple, set)):
        candidates = list(value)
    else:
        candidates = []

    thresholds: list[float] = []
    for candidate in candidates:
        try:
            threshold = float(str(candidate).strip())
        except (TypeError, ValueError):
            continue
        if 0.0 <= threshold <= 1.0:
            thresholds.append(threshold)

    return tuple(thresholds) if thresholds else fallback


@dataclass(slots=True)
class SlicerFrameTag:
    rank: int
    label: str
    score: float
    logit: float = 0.0

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "rank": self.rank,
            "label": self.label,
            "score": self.score,
            "logit": self.logit,
        }


@dataclass(slots=True)
class SlicerFrameTagRow:
    start_sec: float
    end_sec: float
    tags: list[SlicerFrameTag] = field(default_factory=list)

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "startSec": self.start_sec,
            "endSec": self.end_sec,
            "tags": [tag.to_manifest_dict() for tag in self.tags],
        }


@dataclass(slots=True)
class SlicerDetectedEvent:
    threshold: float
    label: str
    onset: float
    offset: float
    duration: float
    filename: str = ""

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "threshold": self.threshold,
            "label": self.label,
            "onset": self.onset,
            "offset": self.offset,
            "duration": self.duration,
            "filename": self.filename,
        }


@dataclass(slots=True)
class SlicerSlice:
    index: int
    file_name: str
    original_path: str
    chunk_index: int
    start_sec: float
    end_sec: float
    duration_sec: float
    channels: int
    marker_count: int
    output_path: str
    marker_components: list[dict[str, float]] = field(default_factory=list)
    status: SliceStatus = "completed"
    top_tag: str = "-"
    ng_tags: str = "-"
    tags: list[SlicerFrameTag] = field(default_factory=list)
    frame_tags: list[SlicerFrameTagRow] = field(default_factory=list)
    events: list[SlicerDetectedEvent] = field(default_factory=list)
    error: str = ""

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "index": self.index,
            "fileName": self.file_name,
            "originalPath": self.original_path,
            "chunkIndex": self.chunk_index,
            "startSec": self.start_sec,
            "endSec": self.end_sec,
            "durationSec": self.duration_sec,
            "channels": self.channels,
            "markerCount": self.marker_count,
            "markerComponents": self.marker_components,
            "outputPath": self.output_path,
            "status": self.status,
            "topTag": self.top_tag,
            "ngTags": self.ng_tags,
            "tags": [tag.to_manifest_dict() for tag in self.tags],
            "frameTags": [frame.to_manifest_dict() for frame in self.frame_tags],
            "events": [event.to_manifest_dict() for event in self.events],
            "error": self.error,
        }


@dataclass(slots=True)
class SlicerJob:
    file_name: str
    original_path: str
    status: JobStatus = "queued"
    active_stage: str = "queued"
    detected_speech_count: int = 0
    slice_count: int = 0
    muted_output_path: str = ""
    error: str = ""

    @classmethod
    def from_path(cls, wav_path: Path) -> "SlicerJob":
        return cls(
            file_name=wav_path.name,
            original_path=str(wav_path.resolve()),
            status="queued",
            active_stage="queued",
        )

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "fileName": self.file_name,
            "originalPath": self.original_path,
            "status": self.status,
            "activeStage": self.active_stage,
            "detectedSpeechCount": self.detected_speech_count,
            "sliceCount": self.slice_count,
            "mutedOutputPath": self.muted_output_path,
            "error": self.error,
        }


@dataclass(slots=True)
class SlicerSummary:
    total_files: int = 0
    total_slices: int = 0
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0
    progress: float = 0.0

    @classmethod
    def from_jobs(cls, jobs: list[SlicerJob], slices: list[SlicerSlice]) -> "SlicerSummary":
        total = len(jobs)
        queued = sum(1 for job in jobs if job.status == "queued")
        running = sum(1 for job in jobs if job.status == "running")
        completed = sum(1 for job in jobs if job.status in {"completed", "completed_with_errors"})
        failed = sum(1 for job in jobs if job.status == "failed")
        finished = completed + failed
        return cls(
            total_files=total,
            total_slices=len(slices),
            queued=queued,
            running=running,
            completed=completed,
            failed=failed,
            progress=(finished / total) if total else 0.0,
        )

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "totalFiles": self.total_files,
            "totalSlices": self.total_slices,
            "queued": self.queued,
            "running": self.running,
            "completed": self.completed,
            "failed": self.failed,
            "progress": self.progress,
        }


@dataclass(slots=True)
class SlicerSession:
    input_folder: str
    output_dir: str
    manifest_path: str
    settings: SlicerSettings
    jobs: list[SlicerJob] = field(default_factory=list)
    slices: list[SlicerSlice] = field(default_factory=list)
    session_status: SessionStatus = "idle"

    def build_manifest(self) -> dict[str, object]:
        summary = SlicerSummary.from_jobs(self.jobs, self.slices)
        return {
            "sessionStatus": self.session_status,
            "inputFolder": self.input_folder,
            "outputDir": self.output_dir,
            "manifestPath": self.manifest_path,
            "settings": self.settings.to_manifest_dict(),
            "summary": summary.to_manifest_dict(),
            "jobs": [job.to_manifest_dict() for job in self.jobs],
            "slices": [row.to_manifest_dict() for row in self.slices],
        }
