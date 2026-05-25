from __future__ import annotations

import json
from pathlib import Path


WAV_AUDIO_EXTS = {".wav", ".wave"}
AUDIO_INPUT_EXTS = {
    ".wav",
    ".wave",
    ".flac",
    ".mp3",
    ".m4a",
    ".aac",
    ".ogg",
    ".oga",
    ".opus",
    ".aiff",
    ".aif",
    ".aifc",
    ".wma",
    ".webm",
    ".mp4",
    ".caf",
    ".amr",
}
AUDIO_EXTS = WAV_AUDIO_EXTS
GENERATED_AUDIO_FOLDERS = {
    "_slicer_results",
    "_tagging_results",
    "_spica_results",
    "_wav_qc_results",
    "_batch_qc_results",
    "_spica_cache",
    "_audio_input_cache",
}
AUDIO_SOURCE_MAP_FILE = "audio_source_map.json"


def discover_audio_files(folder: str | Path, recursive: bool = False) -> list[Path]:
    root = Path(folder)
    mapped_files = _discover_audio_files_from_source_map(root)
    if mapped_files is not None:
        return mapped_files

    files = _discover_files(root, AUDIO_EXTS, recursive=recursive)
    return sorted(files)


def discover_input_audio_files(folder: str | Path, recursive: bool = False) -> list[Path]:
    root = Path(folder)
    files = _discover_files(root, AUDIO_INPUT_EXTS, recursive=recursive)
    return sorted(files)


def _discover_audio_files_from_source_map(root: Path) -> list[Path] | None:
    if root.is_file():
        return None

    map_path = root / AUDIO_SOURCE_MAP_FILE
    if not map_path.exists():
        return None

    try:
        payload = json.loads(map_path.read_text(encoding="utf-8-sig"))
    except Exception:  # noqa: BLE001
        return None

    if not isinstance(payload, dict) or not isinstance(payload.get("mappings"), list):
        return None

    files: list[Path] = []
    seen: set[str] = set()
    for item in payload["mappings"]:
        if not isinstance(item, dict):
            continue
        cached_path = str(item.get("cachedPath", "") or "").strip()
        source_path = str(item.get("sourcePath", "") or item.get("originalPath", "") or "").strip()
        for candidate in (cached_path, source_path):
            path = Path(candidate)
            normalized = str(path).casefold()
            if normalized in seen:
                continue
            if path.exists() and path.is_file() and path.suffix.lower() in WAV_AUDIO_EXTS:
                files.append(path)
                seen.add(normalized)
                break
    return files


def _discover_files(root: Path, extensions: set[str], recursive: bool) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix.lower() in extensions else []
    if not root.exists():
        return []

    iterator = root.rglob("*") if recursive else root.iterdir()
    return [p for p in iterator if p.is_file() and p.suffix.lower() in extensions and not _is_generated_path(p, root)]


def _is_generated_path(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        relative = path
    return any(part.lower() in GENERATED_AUDIO_FOLDERS for part in relative.parts[:-1])
