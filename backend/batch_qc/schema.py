from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ExportFormat = Literal["gsv", "omni"]
SessionStatus = Literal["idle", "running", "completed", "completed_with_errors", "failed"]
JobStatus = Literal["queued", "running", "completed", "failed"]
BATCH_UNKNOWN_SPEAKER_LABEL = "speaker_unknown"


@dataclass(slots=True)
class BatchQcExportSettings:
    export_format: ExportFormat = "gsv"

    def normalize(self) -> "BatchQcExportSettings":
        value = str(self.export_format or "gsv").strip().lower()
        self.export_format = "omni" if value in {"omni", "omnivoice"} else "gsv"
        return self

    def to_manifest_dict(self) -> dict[str, object]:
        return {"exportFormat": self.export_format}

    def format_label(self) -> str:
        return "OmniVoice" if self.export_format == "omni" else "GPT-SoVITS"


@dataclass(slots=True)
class BatchQcExportJob:
    item_id: str
    file_name: str
    original_path: str
    transcript: str = ""
    language: str = ""
    speaker: str = BATCH_UNKNOWN_SPEAKER_LABEL
    status: JobStatus = "queued"
    active_stage: str = "queued"
    edited_transcript: str = ""
    alignment_words: list[dict[str, object]] = field(default_factory=list)
    alignment_warnings: list[str] = field(default_factory=list)
    alignment_summary: dict[str, object] = field(default_factory=dict)
    duration_sec: float = 0.0
    sample_rate: int = 0
    channels: int = 0
    output_audio_path: str = ""
    output_script_path: str = ""
    error: str = ""

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "id": self.item_id,
            "fileName": self.file_name,
            "originalPath": self.original_path,
            "transcript": self.transcript,
            "editedTranscript": self.edited_transcript or self.transcript,
            "language": self.language,
            "speaker": self.speaker,
            "alignmentWords": self.alignment_words,
            "alignmentWarnings": self.alignment_warnings,
            "alignmentSummary": self.alignment_summary,
            "durationSec": self.duration_sec,
            "duration_sec": self.duration_sec,
            "sampleRate": self.sample_rate,
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "status": self.status,
            "activeStage": self.active_stage,
            "outputAudioPath": self.output_audio_path,
            "outputScriptPath": self.output_script_path,
            "error": self.error,
        }


@dataclass(slots=True)
class BatchQcExportSummary:
    total_files: int = 0
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0
    progress: float = 0.0

    @classmethod
    def from_jobs(cls, jobs: list[BatchQcExportJob], total_files: int | None = None) -> "BatchQcExportSummary":
        total = max(0, int(total_files)) if total_files is not None else len(jobs)
        queued = sum(1 for job in jobs if job.status == "queued")
        running = sum(1 for job in jobs if job.status == "running")
        completed = sum(1 for job in jobs if job.status == "completed")
        failed = sum(1 for job in jobs if job.status == "failed")
        finished = completed + failed
        queued += max(0, total - len(jobs))
        return cls(
            total_files=total,
            queued=queued,
            running=running,
            completed=completed,
            failed=failed,
            progress=(finished / total) if total else 0.0,
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
class BatchQcExportSession:
    input_folder: str
    output_dir: str
    manifest_path: str
    dataset_dir: str
    settings: BatchQcExportSettings
    jobs: list[BatchQcExportJob] = field(default_factory=list)
    session_status: SessionStatus = "idle"
    total_files: int | None = None

    def build_manifest(self) -> dict[str, object]:
        summary = BatchQcExportSummary.from_jobs(self.jobs, self.total_files)
        return {
            "sessionStatus": self.session_status,
            "inputFolder": self.input_folder,
            "outputDir": self.output_dir,
            "datasetDir": self.dataset_dir,
            "manifestPath": self.manifest_path,
            "settings": self.settings.to_manifest_dict(),
            "summary": summary.to_manifest_dict(),
            "jobs": [job.to_manifest_dict() for job in self.jobs],
        }
