from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from .conversion_decode import _convert_audio_to_wav, _read_any_audio
from .conversion_manifest import _source_audio_mapping, _write_audio_conversion_manifest, _write_audio_source_map
from .discovery import AUDIO_INPUT_EXTS, WAV_AUDIO_EXTS, discover_input_audio_files


AUDIO_CONVERTING_STAGE = "audio-converting"
AUDIO_COPY_WAV_STAGE = "audio-converting/copy-wav"
AUDIO_CONVERT_STAGE = "audio-converting/convert-to-wav"
AUDIO_CONVERTING_PROGRESS_LABEL = "audio-converting"


@dataclass(frozen=True)
class PreparedAudioInput:
    input_folder: Path
    original_input_folder: Path
    mappings: list[dict[str, str]]


class AudioInputPreparationCancelled(Exception):
    pass


AudioCacheProgressCallback = Callable[[int, int, Path, Path, str], None]


def _log_audio_converting(log: Callable[[str], None] | None, message: str) -> None:
    if log:
        log(f"[audio-converting] {message}")


def _log_audio_converting_kv(log: Callable[[str], None] | None, label: str, value: object) -> None:
    if log:
        log(f"[audio-converting] {label}: {value}")


def prepare_runtime_audio_input(
    input_folder: str | Path,
    *,
    cache_folder: str | Path | None = None,
    source_map_path: str | Path | None = None,
    recursive: bool = False,
    manifest_path: str | Path | None = None,
    cancel_file: str | Path | None = None,
    progress_title: str = "오디오 입력 WAV 캐시 변환",
    log: Callable[[str], None] | None = print,
) -> PreparedAudioInput:
    """Compatibility wrapper for older callers.

    New UI flows prepare the WAV cache when the input folder is selected. This
    wrapper stays in the backend audio utility layer for CLI compatibility and
    delegates to the same incremental cache preparation logic without deleting
    existing cache folders.
    """

    return prepare_selected_audio_input_cache(
        input_folder,
        cache_folder=cache_folder,
        source_map_path=source_map_path,
        recursive=recursive,
        manifest_path=manifest_path,
        cancel_file=cancel_file,
        progress_title=progress_title,
        log=log,
    )


def prepare_selected_audio_input_cache(
    input_folder: str | Path,
    *,
    cache_folder: str | Path | None = None,
    source_map_path: str | Path | None = None,
    recursive: bool = False,
    manifest_path: str | Path | None = None,
    cancel_file: str | Path | None = None,
    progress_title: str = "오디오 컨버팅",
    log: Callable[[str], None] | None = print,
) -> PreparedAudioInput:
    """Prepare a stable WAV view of an input folder.

    Folder selection is the canonical conversion point. Every supported input
    is prepared under the stable converted-audio folder, and the map keeps the
    pre-conversion source path for UI/result restoration.
    """

    input_root = Path(input_folder).resolve()
    source_paths = discover_input_audio_files(input_root, recursive=recursive)
    if not source_paths:
        _log_audio_converting(log, "no supported audio files were found; input is unchanged")
        _write_audio_source_map(source_map_path, input_root, input_root, [])
        return PreparedAudioInput(input_folder=input_root, original_input_folder=input_root, mappings=[])

    wav_count = sum(1 for path in source_paths if path.suffix.lower() in WAV_AUDIO_EXTS)
    convert_count = len(source_paths) - wav_count
    _log_audio_converting_kv(log, "source folder", input_root)
    _log_audio_converting_kv(log, "detected audio files", f"{len(source_paths)} total / {wav_count} wav / {convert_count} convert")

    if not cache_folder:
        if convert_count <= 0:
            _log_audio_converting(log, "WAV/WAVE input only; no cache folder was provided")
            source_mappings = [_source_audio_mapping(path, path, AUDIO_COPY_WAV_STAGE, "completed") for path in source_paths]
            _write_audio_source_map(source_map_path, input_root, input_root, source_mappings)
            _write_audio_conversion_manifest(
                manifest_path,
                input_root,
                input_root,
                len(source_paths),
                len(source_paths),
                0,
                "completed",
                source_mappings,
                active_stage=AUDIO_CONVERTING_STAGE,
                source_total_files=len(source_paths),
                wav_files=wav_count,
                conversion_files=0,
            )
            return PreparedAudioInput(input_folder=input_root, original_input_folder=input_root, mappings=source_mappings)
        raise ValueError("audio cache folder is required when non-WAV input files are present")

    cache_root = Path(cache_folder).resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    _log_audio_converting_kv(log, "Converted WAV folder", cache_root)
    _log_audio_converting(log, "Preparing all supported input files in the converted WAV folder")

    progress_line = None
    format_progress_line = None
    format_finished_line = None
    try:
        from ..console_ui import LiveConsoleLine, format_finished_line as _format_finished_line, format_progress_line as _format_progress_line
    except Exception:  # noqa: BLE001
        try:
            from backend.console_ui import LiveConsoleLine, format_finished_line as _format_finished_line, format_progress_line as _format_progress_line  # type: ignore
        except Exception:  # noqa: BLE001
            LiveConsoleLine = None  # type: ignore[assignment]
            _format_progress_line = None
            _format_finished_line = None
    if LiveConsoleLine is not None:
        progress_line = LiveConsoleLine()
        format_progress_line = _format_progress_line
        format_finished_line = _format_finished_line

    total = len(source_paths)
    conversion_total = total
    conversion_completed = 0
    failed = 0
    converted = 0
    reused = 0
    used_targets: set[Path] = set()
    jobs: list[dict[str, str]] = []
    for index, source_path in enumerate(source_paths, start=1):
        is_wav = source_path.suffix.lower() in WAV_AUDIO_EXTS
        relative = _safe_relative_audio_path(source_path, input_root, index)
        target_path = _cache_target_for_relative(cache_root, relative, used_targets)
        is_current = _cached_wav_is_current(source_path, target_path)
        if is_wav:
            action = AUDIO_COPY_WAV_STAGE
            action_label = "cached-wav" if is_current else "copy-wav"
        else:
            action = AUDIO_CONVERT_STAGE
            action_label = "cached-wav" if is_current else "convert-to-wav"
        status = "queued"

        jobs.append({
            "sourcePath": str(source_path),
            "cachedPath": str(target_path),
            "stage": action,
            "status": status,
            "actionLabel": action_label,
            "isCurrent": "true" if is_current else "false",
            "isWav": "true" if is_wav else "false",
            "error": "",
        })

    _write_audio_conversion_manifest(
        manifest_path,
        input_root,
        cache_root,
        conversion_total,
        0,
        failed,
        "running",
        jobs,
        active_stage=AUDIO_CONVERTING_STAGE,
        source_total_files=total,
        wav_files=wav_count,
        conversion_files=convert_count,
    )

    mappings = jobs
    try:
        for index, job in enumerate(jobs, start=1):
            _raise_if_cancelled(cancel_file)
            source_path = Path(job["sourcePath"])
            target_path = Path(job["cachedPath"])
            action = job["stage"]
            action_label = job["actionLabel"]
            is_current = job["isCurrent"] == "true"
            is_wav = job["isWav"] == "true"

            target_path.parent.mkdir(parents=True, exist_ok=True)
            job["status"] = "running"
            conversion_index = conversion_completed + 1

            if format_progress_line is not None:
                progress_message = format_progress_line(
                    "running",
                    conversion_index,
                    conversion_total,
                    source_path.name,
                    stage=AUDIO_CONVERTING_PROGRESS_LABEL,
                    detail=action_label,
                    completed=conversion_completed,
                )
            else:
                progress_message = f"[running] {conversion_index}/{conversion_total} {source_path.name} ({action_label})"

            if progress_line is not None:
                progress_line.update(progress_message)
            if log:
                log(progress_message)

            _write_audio_conversion_manifest(
                manifest_path,
                input_root,
                cache_root,
                conversion_total,
                conversion_completed,
                failed,
                "running",
                jobs,
                active_stage=action,
                active_source_path=str(source_path),
                source_total_files=total,
                wav_files=wav_count,
                conversion_files=convert_count,
            )

            try:
                if not is_current:
                    if target_path.exists():
                        target_path.unlink()
                    if is_wav:
                        _copy_audio_to_cache(source_path, target_path)
                    else:
                        _convert_audio_to_wav(source_path, target_path)
                        converted += 1
                    _copy_source_mtime(source_path, target_path)
                else:
                    reused += 1
            except Exception as exc:  # noqa: BLE001
                failed += 1
                job["status"] = "failed"
                job["error"] = str(exc)
                _write_audio_conversion_manifest(
                    manifest_path,
                    input_root,
                    cache_root,
                    conversion_total,
                    conversion_completed,
                    failed,
                    "failed",
                    jobs,
                    active_stage=action,
                    active_source_path=str(source_path),
                    source_total_files=total,
                    wav_files=wav_count,
                    conversion_files=convert_count,
                )
                raise

            job["status"] = "cached" if is_current else "completed"
            conversion_completed += 1
            _write_audio_conversion_manifest(
                manifest_path,
                input_root,
                cache_root,
                conversion_total,
                conversion_completed,
                failed,
                "running",
                jobs,
                active_stage=action,
                source_total_files=total,
                wav_files=wav_count,
                conversion_files=convert_count,
            )

        if progress_line is not None and format_finished_line is not None:
            progress_line.finish(format_finished_line(conversion_total, failed=failed))
        _write_audio_conversion_manifest(
            manifest_path,
            input_root,
            cache_root,
            conversion_total,
            conversion_total,
            failed,
            "completed",
            jobs,
            active_stage=AUDIO_CONVERTING_STAGE,
            source_total_files=total,
            wav_files=wav_count,
            conversion_files=convert_count,
        )
        _write_audio_source_map(source_map_path, input_root, cache_root, mappings)
        _log_audio_converting(log, f"completed - runtime input: {cache_root}")
        _log_audio_converting(log, f"summary: converted={converted}, copied_wav={wav_count}, cached={reused}")
        return PreparedAudioInput(input_folder=cache_root, original_input_folder=input_root, mappings=mappings)
    except AudioInputPreparationCancelled:
        failed = max(0, conversion_total - conversion_completed)
        if progress_line is not None and format_finished_line is not None:
            progress_line.finish(format_finished_line(conversion_total, failed=failed))
        _write_audio_conversion_manifest(
            manifest_path,
            input_root,
            cache_root,
            conversion_total,
            conversion_completed,
            failed,
            "failed",
            mappings,
            active_stage="audio-converting/cancelled",
            source_total_files=total,
            wav_files=wav_count,
            conversion_files=convert_count,
        )
        raise
    except Exception:
        failed = max(1, conversion_total - conversion_completed)
        if progress_line is not None and format_finished_line is not None:
            progress_line.finish(format_finished_line(conversion_total, failed=failed))
        _write_audio_conversion_manifest(
            manifest_path,
            input_root,
            cache_root,
            conversion_total,
            conversion_completed,
            failed,
            "failed",
            mappings,
            active_stage="audio-converting/failed",
            source_total_files=total,
            wav_files=wav_count,
            conversion_files=convert_count,
        )
        raise


def _raise_if_cancelled(cancel_file: str | Path | None) -> None:
    if cancel_file and Path(cancel_file).exists():
        raise AudioInputPreparationCancelled("Cancelled by user")

def prepare_audio_wav_cache(
    input_folder: str | Path,
    cache_folder: str | Path,
    source_paths: Sequence[str | Path] | None = None,
    recursive: bool = False,
) -> dict[str, object]:
    """Stage supported audio inputs as WAV files under a stable cache folder."""

    input_root = Path(input_folder).resolve()
    if source_paths:
        selected_sources = [Path(path).resolve() for path in source_paths if str(path)]
        selected_sources = [path for path in selected_sources if path.exists() and path.is_file() and path.suffix.lower() in AUDIO_INPUT_EXTS]
        return _prepare_selected_sources(input_root, Path(cache_folder).resolve(), selected_sources)

    prepared = prepare_selected_audio_input_cache(input_root, cache_folder=cache_folder, recursive=recursive, log=None)
    converted = sum(1 for item in prepared.mappings if str(item.get("stage", "")).endswith("convert-to-wav") and str(item.get("status", "")) != "cached")
    return {
        "inputPath": str(prepared.input_folder),
        "total": len(prepared.mappings),
        "converted": converted,
        "linked": 0,
        "mappings": prepared.mappings,
    }


def _prepare_selected_sources(input_root: Path, cache_root: Path, audio_paths: Sequence[Path]) -> dict[str, object]:
    if not audio_paths:
        raise FileNotFoundError(f"No supported audio files found in: {input_root}")
    cache_root.mkdir(parents=True, exist_ok=True)
    used_targets: set[Path] = set()
    mappings: list[dict[str, str]] = []
    converted = 0
    reused = 0
    for index, source_path in enumerate(audio_paths, start=1):
        relative = _safe_relative_audio_path(source_path, input_root, index)
        target_path = _cache_target_for_relative(cache_root, relative, used_targets)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if _cached_wav_is_current(source_path, target_path):
            reused += 1
            status = "cached"
        else:
            if target_path.exists():
                target_path.unlink()
            if source_path.suffix.lower() in WAV_AUDIO_EXTS:
                _copy_audio_to_cache(source_path, target_path)
            else:
                _convert_audio_to_wav(source_path, target_path)
                converted += 1
            _copy_source_mtime(source_path, target_path)
            status = "completed"
        stage = AUDIO_COPY_WAV_STAGE if source_path.suffix.lower() in WAV_AUDIO_EXTS else AUDIO_CONVERT_STAGE
        mappings.append(_source_audio_mapping(source_path, target_path, stage, status))
    return {
        "inputPath": str(cache_root),
        "total": len(mappings),
        "converted": converted,
        "linked": 0,
        "cached": reused,
        "mappings": mappings,
    }


def _copy_audio_to_cache(source_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if source_path.samefile(target_path):
            return
    except OSError:
        pass
    shutil.copy2(source_path, target_path)


def _safe_relative_audio_path(source_path: Path, input_root: Path, index: int) -> Path:
    try:
        relative = source_path.relative_to(input_root)
    except ValueError:
        relative = Path(f"{index:06d}_{source_path.name}")

    parts = [part for part in relative.parts if part not in {"", ".", ".."}]
    if not parts:
        parts = [f"{index:06d}_{source_path.name}"]
    relative = Path(*parts)
    suffix = source_path.suffix.lower().lstrip(".") or "audio"
    if source_path.suffix.lower() in WAV_AUDIO_EXTS:
        file_name = source_path.name
    else:
        file_name = f"({suffix}){source_path.stem}.wav"
    return relative.parent / file_name


def _cache_target_for_relative(cache_root: Path, relative_path: Path, used_targets: set[Path]) -> Path:
    candidate = cache_root / relative_path
    normalized = Path(str(candidate).lower())
    if normalized not in used_targets:
        used_targets.add(normalized)
        return candidate

    stem = relative_path.stem
    suffix = relative_path.suffix or ".wav"
    parent = relative_path.parent
    counter = 2
    while True:
        candidate = cache_root / parent / f"{stem}_{counter}{suffix}"
        normalized = Path(str(candidate).lower())
        if normalized not in used_targets:
            used_targets.add(normalized)
            return candidate
        counter += 1


def _unique_cache_target(cache_root: Path, relative_path: Path, used_targets: set[Path]) -> Path:
    return _cache_target_for_relative(cache_root, relative_path, used_targets)


def _cached_wav_is_current(source_path: Path, target_path: Path) -> bool:
    if not target_path.exists() or not target_path.is_file():
        return False
    try:
        return target_path.stat().st_size > 0 and target_path.stat().st_mtime + 0.001 >= source_path.stat().st_mtime
    except OSError:
        return False


def _copy_source_mtime(source_path: Path, target_path: Path) -> None:
    try:
        source_stat = source_path.stat()
        os.utime(target_path, (source_stat.st_atime, source_stat.st_mtime))
    except OSError:
        pass
