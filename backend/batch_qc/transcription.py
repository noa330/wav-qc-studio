from __future__ import annotations

from pathlib import Path
from typing import Any

from ..audio_utils import audio_info, discover_audio_files
from ..runtime import ensure_runtime_ready, load_config, merge_config_overrides
from .asr import BatchAsrTranscriber
from .manifest import write_manifest
from .schema import BatchQcExportJob, BatchQcExportSession, BatchQcExportSettings
from .word_alignment import BatchWordAligner


def run_batch_transcription(
    input_dir: Path,
    manifest_path: Path,
    language: str = "auto",
    cancel_file: Path | None = None,
    config_overrides: dict[str, dict[str, Any]] | None = None,
    recursive: bool = False,
) -> int:
    files = discover_audio_files(input_dir, recursive=recursive)
    if not files:
        raise FileNotFoundError(f"No WAV files found in input folder: {input_dir}")

    pending_jobs = [
        BatchQcExportJob(
            item_id=f"{index:06d}",
            file_name=wav_path.name,
            original_path=str(wav_path.resolve()),
        )
        for index, wav_path in enumerate(files, start=1)
    ]
    session = BatchQcExportSession(
        input_folder=str(input_dir.resolve()),
        output_dir=str(manifest_path.resolve().parent),
        manifest_path=str(manifest_path.resolve()),
        dataset_dir="",
        settings=BatchQcExportSettings(),
        jobs=[],
        session_status="running",
        total_files=len(pending_jobs),
    )
    write_manifest(session)

    cfg = load_config()
    if config_overrides:
        merge_config_overrides(cfg, config_overrides)
    ensure_runtime_ready()
    try:
        transcriber = BatchAsrTranscriber(cfg, language=language)
        aligner = BatchWordAligner(cfg, progress=print)
    except Exception as exc:  # noqa: BLE001
        session.session_status = "failed"
        for job in pending_jobs:
            job.status = "failed"
            job.active_stage = "model_init_failed"
            job.error = f"{type(exc).__name__}: {exc}"
        session.jobs = pending_jobs
        write_manifest(session)
        raise

    any_failed = False
    cancelled = False

    for job in pending_jobs:
        if _cancel_requested(cancel_file):
            cancelled = True
            break

        if job not in session.jobs:
            session.jobs.append(job)
        job.status = "running"
        job.active_stage = "audio_info"
        write_manifest(session)

        try:
            duration_sec, sample_rate, channels = audio_info(job.original_path)
            job.duration_sec = round(duration_sec, 3)
            job.sample_rate = sample_rate
            job.channels = channels

            if _cancel_requested(cancel_file):
                cancelled = True
                job.status = "failed"
                job.active_stage = "cancelled"
                job.error = "Cancelled by user."
                write_manifest(session)
                break

            job.active_stage = "transcribing"
            write_manifest(session)
            result: dict[str, Any] = transcriber.transcribe(job.original_path)
            job.transcript = str(result.get("transcript", "") or "")
            job.edited_transcript = job.transcript
            job.language = str(result.get("language", "") or "")

            job.active_stage = "word_aligning"
            write_manifest(session)
            report = aligner.align(job.original_path, job.transcript)
            alignment_payload = report.to_manifest_payload()
            job.alignment_words = list(alignment_payload["alignmentWords"])  # type: ignore[arg-type]
            job.alignment_warnings = list(alignment_payload["alignmentWarnings"])  # type: ignore[arg-type]
            job.alignment_summary = dict(alignment_payload["alignmentSummary"])  # type: ignore[arg-type]
            job.status = "completed"
            job.active_stage = "completed"
            job.error = ""
        except Exception as exc:  # noqa: BLE001
            any_failed = True
            job.status = "failed"
            job.active_stage = "failed"
            job.error = f"{type(exc).__name__}: {exc}"
        finally:
            if job not in session.jobs:
                session.jobs.append(job)
            write_manifest(session)

    if cancelled:
        _mark_cancelled(session.jobs)
        session.session_status = "failed"
        write_manifest(session)
        return 130

    session.session_status = "completed_with_errors" if any_failed else "completed"
    write_manifest(session)
    return 1 if any_failed else 0


def _cancel_requested(cancel_file: Path | None) -> bool:
    return bool(cancel_file and cancel_file.exists())


def _mark_cancelled(jobs: list[BatchQcExportJob]) -> None:
    for job in jobs:
        if job.status in {"queued", "running"}:
            job.status = "failed"
            job.active_stage = "cancelled"
            job.error = "Cancelled by user."
