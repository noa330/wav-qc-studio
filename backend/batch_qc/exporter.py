from __future__ import annotations

import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

from .schema import BATCH_UNKNOWN_SPEAKER_LABEL, BatchQcExportJob, BatchQcExportSettings


_SPEAKER_INDEX_RE = re.compile(r"(?:speaker|spk|화자)\s*[_-]?\s*0*(\d+)", re.IGNORECASE)
_UNSAFE_PATH_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


def normalize_language(language: str | None) -> str:
    value = (language or "").strip().lower()
    return value if value and value != "-" else "ko"


def resolve_speaker_key(speaker: str | None) -> tuple[str, str]:
    first = (speaker or "").split(",", 1)[0].strip()
    if not first or first == "-" or first == "노데이터":
        return BATCH_UNKNOWN_SPEAKER_LABEL, BATCH_UNKNOWN_SPEAKER_LABEL

    match = _SPEAKER_INDEX_RE.search(first)
    if match:
        index = str(int(match.group(1)))
        return f"speaker_{index}", f"speaker_{index}"

    normalized = _UNSAFE_PATH_CHARS_RE.sub("_", first).strip(" ._").lower()
    normalized = re.sub(r"\s+", "_", normalized)
    if not normalized:
        normalized = BATCH_UNKNOWN_SPEAKER_LABEL
    return normalized, normalized


def sanitize_text(text: str | None) -> str:
    return " ".join((text or "").replace("|", " ").split())


def unique_audio_name(job: BatchQcExportJob, index: int) -> str:
    suffix = Path(job.original_path).suffix.lower() or ".wav"
    return f"{index:06d}{suffix}"


def copy_audio(job: BatchQcExportJob, target_path: Path) -> None:
    source = Path(job.original_path)
    if not source.exists():
        raise FileNotFoundError(f"Audio file not found: {source}")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target_path)


def write_gsv_manifest(script_path: Path, jobs: list[BatchQcExportJob], speaker_name: str) -> None:
    lines: list[str] = []
    for job in jobs:
        language = normalize_language(job.language)
        transcript = sanitize_text(job.transcript)
        lines.append(f"{Path(job.output_audio_path).resolve()}|{speaker_name}|{language}|{transcript}")
        job.output_script_path = str(script_path)

    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def write_omni_manifest(script_path: Path, jobs: list[BatchQcExportJob]) -> None:
    lines: list[str] = []
    for job in jobs:
        payload = {
            "id": job.item_id,
            "audio_path": str(Path(job.output_audio_path).resolve()),
            "text": sanitize_text(job.transcript),
            "language_id": normalize_language(job.language),
        }
        lines.append(json.dumps(payload, ensure_ascii=False))
        job.output_script_path = str(script_path)

    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def export_dataset(
    jobs: list[BatchQcExportJob],
    output_dir: Path,
    settings: BatchQcExportSettings,
    log,
) -> int:
    grouped: dict[str, list[BatchQcExportJob]] = defaultdict(list)
    speaker_names: dict[str, str] = {}

    for index, job in enumerate(jobs, start=1):
        speaker_folder, speaker_name = resolve_speaker_key(job.speaker)
        speaker_names[speaker_folder] = speaker_name
        grouped[speaker_folder].append(job)

        job.status = "running"
        job.active_stage = "copy_audio"
        audio_path = output_dir / speaker_folder / "wavs" / unique_audio_name(job, index)
        copy_audio(job, audio_path)
        job.output_audio_path = str(audio_path)
        job.active_stage = "queued_manifest"
        log(f"[파일 복사] {job.file_name} -> {audio_path}")

    for speaker_folder, speaker_jobs in grouped.items():
        transcript_dir = output_dir / speaker_folder / "transcripts"
        if settings.export_format == "omni":
            script_path = transcript_dir / "train.jsonl"
            write_omni_manifest(script_path, speaker_jobs)
        else:
            script_path = transcript_dir / "train.list"
            write_gsv_manifest(script_path, speaker_jobs, speaker_names[speaker_folder])

        for job in speaker_jobs:
            job.status = "completed"
            job.active_stage = "done"
        log(f"[대본 작성] {speaker_folder} -> {script_path}")

    return len(jobs)
