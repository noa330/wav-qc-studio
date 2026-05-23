from __future__ import annotations

import argparse
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable, Sequence

import numpy as np
import soundfile as sf


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

AUDIO_CONVERTING_STAGE = "audio-converting"
AUDIO_LINK_STAGE = "audio-converting/link-wav"
AUDIO_CONVERT_STAGE = "audio-converting/convert-to-wav"
AUDIO_CONVERTING_PROGRESS_LABEL = "audio-converting"


def discover_audio_files(folder: str | Path, recursive: bool = False) -> list[Path]:
    root = Path(folder)
    files = _discover_files(root, AUDIO_EXTS, recursive=recursive)
    return sorted(files)


def discover_input_audio_files(folder: str | Path, recursive: bool = False) -> list[Path]:
    root = Path(folder)
    files = _discover_files(root, AUDIO_INPUT_EXTS, recursive=recursive)
    return sorted(files)


def _discover_files(root: Path, extensions: set[str], recursive: bool) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix.lower() in extensions else []
    if not root.exists():
        return []

    iterator = root.rglob("*") if recursive else root.iterdir()
    return [p for p in iterator if p.is_file() and p.suffix.lower() in extensions and not _is_generated_path(p, root)]




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

    Folder selection is the canonical conversion point. If the selected folder
    contains only WAV/WAVE files, the original folder is returned. If any other
    supported audio extension exists, a stable cache folder is used as the
    runtime input. Existing up-to-date cache WAVs are reused, so repeated model
    runs do not rebuild identical audio.
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

    if convert_count <= 0:
        _log_audio_converting(log, "WAV/WAVE input only; conversion cache skipped")
        _write_audio_source_map(source_map_path, input_root, input_root, [])
        _write_audio_conversion_manifest(manifest_path, input_root, input_root, len(source_paths), len(source_paths), 0, "completed", [], active_stage=AUDIO_CONVERTING_STAGE)
        return PreparedAudioInput(input_folder=input_root, original_input_folder=input_root, mappings=[])

    if not cache_folder:
        raise ValueError("audio cache folder is required when non-WAV input files are present")

    cache_root = Path(cache_folder).resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    _log_audio_converting_kv(log, "WAV cache", cache_root)
    _log_audio_converting(log, "using cached WAVs when current; converting missing or stale files only")

    progress_line = None
    format_progress_line = None
    format_finished_line = None
    try:
        from .console_ui import LiveConsoleLine, format_finished_line as _format_finished_line, format_progress_line as _format_progress_line
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
    mappings: list[dict[str, str]] = []
    failed = 0
    converted = 0
    linked = 0
    reused = 0
    _write_audio_conversion_manifest(manifest_path, input_root, cache_root, total, 0, failed, "running", mappings, active_stage=AUDIO_CONVERTING_STAGE)

    used_targets: set[Path] = set()
    try:
        for index, source_path in enumerate(source_paths, start=1):
            _raise_if_cancelled(cancel_file)
            relative = _safe_relative_audio_path(source_path, input_root, index)
            target_path = _cache_target_for_relative(cache_root, relative, used_targets)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            is_wav = source_path.suffix.lower() in WAV_AUDIO_EXTS
            is_current = _cached_wav_is_current(source_path, target_path)
            if is_current:
                action = AUDIO_LINK_STAGE if is_wav else AUDIO_CONVERT_STAGE
                action_label = "cached-wav"
                reused += 1
            elif is_wav:
                action = AUDIO_LINK_STAGE
                action_label = "link-wav"
            else:
                action = AUDIO_CONVERT_STAGE
                action_label = "convert-to-wav"

            if progress_line is not None and format_progress_line is not None:
                progress_line.update(format_progress_line("running", index, total, source_path.name, stage=AUDIO_CONVERTING_PROGRESS_LABEL, detail=action_label, completed=index - 1))
            elif log:
                log(f"[{progress_title}] {index}/{total} {source_path.name} ({action_label})")

            if not is_current:
                if target_path.exists():
                    target_path.unlink()
                if is_wav:
                    _stage_existing_wav(source_path, target_path)
                    linked += 1
                else:
                    _convert_audio_to_wav(source_path, target_path)
                    _copy_source_mtime(source_path, target_path)
                    converted += 1

            mappings.append({"sourcePath": str(source_path), "cachedPath": str(target_path), "stage": action, "status": "cached" if is_current else "completed"})
            _write_audio_conversion_manifest(manifest_path, input_root, cache_root, total, index, failed, "running", mappings, active_stage=action)

        if progress_line is not None and format_finished_line is not None:
            progress_line.finish(format_finished_line(total, failed=failed))
        _write_audio_conversion_manifest(manifest_path, input_root, cache_root, total, total, failed, "completed", mappings, active_stage=AUDIO_CONVERTING_STAGE)
        _write_audio_source_map(source_map_path, input_root, cache_root, mappings)
        _log_audio_converting(log, f"completed - runtime input: {cache_root}")
        _log_audio_converting(log, f"summary: converted={converted}, linked={linked}, cached={reused}")
        return PreparedAudioInput(input_folder=cache_root, original_input_folder=input_root, mappings=mappings)
    except AudioInputPreparationCancelled:
        failed = max(0, total - len(mappings))
        if progress_line is not None and format_finished_line is not None:
            progress_line.finish(format_finished_line(total, failed=failed))
        _write_audio_conversion_manifest(manifest_path, input_root, cache_root, total, len(mappings), failed, "failed", mappings, active_stage="audio-converting/cancelled")
        raise
    except Exception:
        failed = max(1, total - len(mappings))
        if progress_line is not None and format_finished_line is not None:
            progress_line.finish(format_finished_line(total, failed=failed))
        _write_audio_conversion_manifest(manifest_path, input_root, cache_root, total, len(mappings), failed, "failed", mappings, active_stage="audio-converting/failed")
        raise


def _write_audio_source_map(source_map_path: str | Path | None, input_root: Path, runtime_input_root: Path, mappings: list[dict[str, str]]) -> None:
    if not source_map_path:
        return
    out_path = Path(source_map_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "inputPath": str(runtime_input_root),
        "originalInputPath": str(input_root),
        "mappings": mappings,
    }
    try:
        from .manifest_io import atomic_write_json
    except Exception:  # noqa: BLE001
        from backend.manifest_io import atomic_write_json  # type: ignore
    atomic_write_json(out_path, payload)


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
                "status": "completed",
                "error": "",
            }
            for item in mappings
        ],
        "activeStage": active_stage,
    }
    try:
        from .manifest_io import atomic_write_json
    except Exception:  # noqa: BLE001
        from backend.manifest_io import atomic_write_json  # type: ignore
    atomic_write_json(Path(manifest_path), payload)


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
    linked = sum(1 for item in prepared.mappings if str(item.get("stage", "")).endswith("link-wav") and str(item.get("status", "")) != "cached")
    return {
        "inputPath": str(prepared.input_folder),
        "total": len(prepared.mappings),
        "converted": converted,
        "linked": linked,
        "mappings": prepared.mappings,
    }


def _prepare_selected_sources(input_root: Path, cache_root: Path, audio_paths: Sequence[Path]) -> dict[str, object]:
    if not audio_paths:
        raise FileNotFoundError(f"No supported audio files found in: {input_root}")
    cache_root.mkdir(parents=True, exist_ok=True)
    used_targets: set[Path] = set()
    mappings: list[dict[str, str]] = []
    converted = 0
    linked = 0
    reused = 0
    for index, source_path in enumerate(audio_paths, start=1):
        relative = _safe_relative_audio_path(source_path, input_root, index)
        target_path = _cache_target_for_relative(cache_root, relative, used_targets)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if _cached_wav_is_current(source_path, target_path):
            reused += 1
        else:
            if target_path.exists():
                target_path.unlink()
            if source_path.suffix.lower() in WAV_AUDIO_EXTS:
                _stage_existing_wav(source_path, target_path)
                linked += 1
            else:
                _convert_audio_to_wav(source_path, target_path)
                _copy_source_mtime(source_path, target_path)
                converted += 1
        mappings.append({"sourcePath": str(source_path), "cachedPath": str(target_path)})
    return {
        "inputPath": str(cache_root),
        "total": len(mappings),
        "converted": converted,
        "linked": linked,
        "cached": reused,
        "mappings": mappings,
    }


def _stage_existing_wav(source_path: Path, target_path: Path) -> None:
    if source_path.resolve() == target_path.resolve():
        return
    try:
        os.link(source_path, target_path)
    except OSError:
        shutil.copy2(source_path, target_path)


def _convert_audio_to_wav(source_path: Path, target_path: Path) -> None:
    audio, sample_rate = _read_any_audio(source_path)
    if audio.size == 0:
        raise RuntimeError(f"Audio file is empty: {source_path}")
    if audio.ndim == 1:
        frames = audio[:, None]
    else:
        frames = audio
    frames = np.nan_to_num(frames.astype(np.float32, copy=False))
    sf.write(str(target_path), np.clip(frames, -1.0, 1.0), int(sample_rate), subtype="PCM_24", format="WAV")


def _read_any_audio(source_path: Path) -> tuple[np.ndarray, int]:
    errors: list[str] = []

    try:
        audio, sample_rate = sf.read(str(source_path), always_2d=True, dtype="float32")
        return audio.astype(np.float32, copy=False), int(sample_rate)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"soundfile: {exc}")

    try:
        import torchaudio

        waveform, sample_rate = torchaudio.load(str(source_path))
        audio = waveform.detach().cpu().numpy().T
        return audio.astype(np.float32, copy=False), int(sample_rate)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"torchaudio: {exc}")

    try:
        import librosa

        loaded, sample_rate = librosa.load(str(source_path), sr=None, mono=False)
        if loaded.ndim == 1:
            audio = loaded[:, None]
        else:
            audio = loaded.T
        return audio.astype(np.float32, copy=False), int(sample_rate)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"librosa: {exc}")

    detail = "; ".join(errors)
    raise RuntimeError(f"Could not decode audio file: {source_path} ({detail})")


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
    if source_path.suffix.lower() == ".wav":
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


def _is_generated_path(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        relative = path
    return any(part.lower() in GENERATED_AUDIO_FOLDERS for part in relative.parts[:-1])


def run_audio_converting_cli(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare a stable WAV cache for an input audio folder")
    parser.add_argument("--input", required=True, help="Original input folder")
    parser.add_argument("--cache-dir", required=True, help="Stable WAV cache directory")
    parser.add_argument("--source-map", required=False, default="", help="JSON map from source audio to cached WAV")
    parser.add_argument("--manifest", required=False, default="", help="Progress manifest JSON path")
    parser.add_argument("--log", required=False, default="", help="Log file path")
    parser.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    parser.add_argument("--recursive", action="store_true", help="Search recursively")
    args = parser.parse_args(list(argv) if argv is not None else None)

    log_path = args.log or str(Path(args.cache_dir).resolve() / f"audio_converting_{datetime.now():%Y%m%d_%H%M%S}.log")
    try:
        from .cli_logging import close_log_tee, install_log_tee
        from .console_ui import prepare_for_regular_output, print_banner, print_kv, print_section
    except Exception:  # noqa: BLE001
        from backend.cli_logging import close_log_tee, install_log_tee  # type: ignore
        from backend.console_ui import prepare_for_regular_output, print_banner, print_kv, print_section  # type: ignore

    install_log_tee(log_path, prepare_output=prepare_for_regular_output, include_run_markers=True)
    try:
        print_banner("오디오 컨버팅")
        print_kv("Python", sys.executable)
        print_kv("Working directory", Path.cwd())
        print_kv("Input folder", Path(args.input).resolve())
        print_kv("WAV cache", Path(args.cache_dir).resolve())
        print_kv("Manifest", args.manifest or "-")
        print_kv("Source map", args.source_map or "-")
        print_section("오디오 컨버팅")
        prepared = prepare_selected_audio_input_cache(
            args.input,
            cache_folder=args.cache_dir,
            source_map_path=args.source_map or None,
            recursive=bool(args.recursive),
            manifest_path=args.manifest or None,
            cancel_file=args.cancel_file or None,
            progress_title="오디오 컨버팅",
            log=print,
        )
        print_section("오디오 컨버팅 완료")
        print_kv("Runtime input folder", prepared.input_folder)
        print_kv("Original input folder", prepared.original_input_folder)
        print_kv("Mapped files", len(prepared.mappings))
        return 0
    except AudioInputPreparationCancelled:
        print("[cancelled] Audio converting was cancelled.")
        return 130
    finally:
        close_log_tee()


def read_audio(path: str | Path, target_sr: int | None = None, mono: bool = True) -> tuple[np.ndarray, int]:
    try:
        import librosa
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "librosa is required to load audio. Re-run setup_and_run.bat so .venv_noise installs the shared speaker dependencies before the no-deps packages."
        ) from exc

    wav, sr = librosa.load(str(path), sr=target_sr, mono=mono)
    return wav.astype(np.float32), sr


def read_audio_native(path: str | Path) -> tuple[np.ndarray, int, int]:
    wav, sr = sf.read(str(path), always_2d=True)
    channels = int(wav.shape[1])
    wav = wav.T
    return wav.astype(np.float32), sr, channels


def audio_info(path: str | Path) -> tuple[float, int, int]:
    info = sf.info(str(path))
    return float(info.duration), int(info.samplerate), int(info.channels)


def iter_fixed_windows(
    wav: np.ndarray,
    sr: int,
    window_sec: float,
    hop_sec: float,
) -> Iterable[np.ndarray]:
    win = max(1, int(window_sec * sr))
    hop = max(1, int(hop_sec * sr))

    if len(wav) <= win:
        padded = np.zeros(win, dtype=np.float32)
        padded[: len(wav)] = wav[:win]
        yield padded
        return

    last_start = max(0, len(wav) - win)
    starts = list(range(0, last_start + 1, hop))
    if starts[-1] != last_start:
        starts.append(last_start)

    for start in starts:
        chunk = wav[start : start + win]
        if len(chunk) < win:
            padded = np.zeros(win, dtype=np.float32)
            padded[: len(chunk)] = chunk
            chunk = padded
        yield chunk.astype(np.float32)


def concat_segments(
    wav: np.ndarray,
    sr: int,
    segments: list[tuple[float, float]],
    max_total_sec: float,
) -> np.ndarray:
    if wav.ndim > 1:
        wav = np.mean(wav, axis=0)
    pieces: list[np.ndarray] = []
    collected = 0
    max_samples = int(max_total_sec * sr)
    for start_sec, end_sec in segments:
        s = max(0, int(start_sec * sr))
        e = min(len(wav), int(end_sec * sr))
        if e <= s:
            continue
        seg = wav[s:e]
        remain = max_samples - collected
        if remain <= 0:
            break
        if len(seg) > remain:
            seg = seg[:remain]
        pieces.append(seg)
        collected += len(seg)
    if not pieces:
        return np.zeros(sr, dtype=np.float32)
    return np.concatenate(pieces).astype(np.float32)
