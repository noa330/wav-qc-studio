from __future__ import annotations

from pathlib import Path


AUDIO_CONVERTING_STAGE = "audio-converting"


def _source_audio_mapping(source_path: Path, cached_path: Path, stage: str, status: str) -> dict[str, str]:
    return {
        "sourcePath": str(source_path),
        "originalPath": str(source_path),
        "cachedPath": str(cached_path),
        "stage": stage,
        "status": status,
        "error": "",
    }


def _write_audio_source_map(
    source_map_path: str | Path | None,
    input_root: Path,
    runtime_input_root: Path,
    mappings: list[dict[str, str]],
) -> None:
    if not source_map_path:
        return
    out_path = Path(source_map_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "inputPath": str(runtime_input_root),
        "originalInputPath": str(input_root),
        "mappings": [_source_map_payload_item(item) for item in mappings],
    }
    _atomic_write_json(out_path, payload)


def _source_map_payload_item(item: dict[str, str]) -> dict[str, str]:
    source_path = str(item.get("sourcePath") or item.get("originalPath") or "")
    return {
        **item,
        "sourcePath": source_path,
        "originalPath": source_path,
        "cachedPath": str(item.get("cachedPath") or source_path),
    }


def _write_audio_conversion_manifest(
    manifest_path: str | Path | None,
    input_root: Path,
    cache_root: Path,
    total_files: int,
    completed: int,
    failed: int,
    session_status: str,
    mappings: list[dict[str, str]],
    *,
    active_stage: str,
    active_source_path: str | None = None,
    source_total_files: int | None = None,
    wav_files: int | None = None,
    conversion_files: int | None = None,
) -> None:
    if not manifest_path:
        return
    queued = max(0, total_files - completed - failed)
    running = 1 if session_status == "running" and queued > 0 else 0
    finished = min(total_files, completed + failed)
    payload = {
        "sessionStatus": session_status,
        "inputFolder": str(input_root),
        "runtimeInputFolder": str(cache_root),
        "manifestPath": str(Path(manifest_path).resolve()),
        "summary": {
            "totalFiles": total_files,
            "sourceTotalFiles": total_files if source_total_files is None else source_total_files,
            "wavFiles": 0 if wav_files is None else wav_files,
            "conversionFiles": total_files if conversion_files is None else conversion_files,
            "queued": queued,
            "running": running,
            "completed": completed,
            "failed": failed,
            "progress": (finished / total_files) if total_files else 0.0,
        },
        "jobs": [
            {
                "fileName": Path(item["sourcePath"]).name,
                "originalPath": item["sourcePath"],
                "cachedPath": item["cachedPath"],
                "activeStage": str(item.get("stage") or AUDIO_CONVERTING_STAGE),
                "status": str(item.get("status") or "completed"),
                "error": str(item.get("error") or ""),
            }
            for item in mappings
        ],
        "activeStage": active_stage,
        "activeSourcePath": str(active_source_path or ""),
    }
    _atomic_write_json(Path(manifest_path), payload)


def _atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    try:
        from .manifest_io import atomic_write_json
    except Exception:  # noqa: BLE001
        try:
            from backend.manifest_io import atomic_write_json  # type: ignore
        except ModuleNotFoundError:
            from manifest_io import atomic_write_json  # type: ignore[no-redef]

    atomic_write_json(path, payload)
