from __future__ import annotations

import re
import json
import shutil
import tempfile
from pathlib import Path
from typing import Callable

from .audio_ops import (
    build_keep_ranges,
    build_mute_ranges,
    daw_style_mute_ranges,
    group_keep_ranges,
    normalize_clip_audio,
    read_audio_frames,
    seconds_from_samples,
    write_wav,
)
from .schema import SlicerSettings, SlicerSlice
from .speech_detector import FireRedSpeechDetector
from .tagger import PretrainedSedFrameTagger

LogFn = Callable[[str], None]
StageCallback = Callable[[str], None]
DetailCallback = Callable[[str], None]
SliceCallback = Callable[[SlicerSlice], None]


def prepare_pipeline(
    settings: SlicerSettings,
    log: LogFn,
    include_detector: bool = True,
    include_tagger: bool = True,
) -> tuple[FireRedSpeechDetector | None, PretrainedSedFrameTagger | None]:
    settings = settings.normalize()
    detector = FireRedSpeechDetector() if include_detector else None
    tagger = PretrainedSedFrameTagger() if include_tagger else None
    if detector is not None:
        detector.ensure_model(log)
    if tagger is not None:
        tagger.ensure_model(settings, log)
    return detector, tagger


def run_pipeline(
    input_path: Path,
    output_dir: Path,
    job_index: int,
    settings: SlicerSettings,
    detector: FireRedSpeechDetector | None,
    log: LogFn,
    on_stage_changed: StageCallback | None = None,
    on_detail_changed: DetailCallback | None = None,
    on_slice_ready: SliceCallback | None = None,
) -> dict[str, object]:
    settings = settings.normalize()
    if detector is None:
        raise RuntimeError("Speech detector is required for slice workflow.")

    if on_stage_changed is not None:
        on_stage_changed("speech-detect")
    with tempfile.TemporaryDirectory(prefix=f"wqcs_slicer_{job_index:03d}_") as work_dir_name:
        speech_segments = detector.detect(input_path, Path(work_dir_name), settings, log)
    if on_detail_changed is not None:
        on_detail_changed(f"{len(speech_segments)} speech marker(s)")

    if on_stage_changed is not None:
        on_stage_changed("mute")
    original_audio, sample_rate, channels = read_audio_frames(input_path)
    keep_ranges = build_keep_ranges(original_audio, sample_rate, speech_segments, settings)
    mute_ranges = build_mute_ranges(int(original_audio.shape[0]), keep_ranges)
    muted_audio = daw_style_mute_ranges(
        original_audio,
        sample_rate,
        mute_ranges,
        splice_ms=settings.splice_ms,
        floor_db=settings.floor_gain_db,
    )

    if on_stage_changed is not None:
        on_stage_changed("slice")
    groups = group_keep_ranges(keep_ranges, sample_rate, settings.split_gap_sec, settings.monitor_merge_max_ms)
    if on_detail_changed is not None:
        on_detail_changed(f"{len(groups)} slice chunk(s)")

    slice_rows: list[SlicerSlice] = []
    for chunk_index, (start_idx, end_idx, marker_count, marker_components) in enumerate(groups, start=1):
        start_sec = seconds_from_samples(start_idx, sample_rate)
        end_sec = seconds_from_samples(end_idx, sample_rate)
        duration_sec = max(0.0, round(end_sec - start_sec, 6))
        ranked = []
        ng_text = "-"
        top_tag = "-"
        row = SlicerSlice(
            index=0,
            file_name=input_path.name,
            original_path=str(input_path.resolve()),
            chunk_index=chunk_index,
            start_sec=start_sec,
            end_sec=end_sec,
            duration_sec=duration_sec,
            channels=channels,
            marker_count=marker_count,
            output_path="",
            marker_components=[
                {
                    "startSec": seconds_from_samples(component_start, sample_rate),
                    "endSec": seconds_from_samples(component_end, sample_rate),
                }
                for component_start, component_end in marker_components
            ],
            status="completed",
            top_tag=top_tag,
            ng_tags=ng_text,
            tags=ranked,
        )
        slice_rows.append(row)
        if on_detail_changed is not None:
            on_detail_changed(f"slice {chunk_index}/{len(groups)} tagged")
        if on_slice_ready is not None:
            on_slice_ready(row)

    return {
        "detected_speech_count": len(speech_segments),
        "slice_count": len(slice_rows),
        "muted_output_path": "",
    }


def run_export_pipeline(
    input_path: Path,
    output_dir: Path,
    job_index: int,
    settings: SlicerSettings,
    markers_json: Path,
    log: LogFn,
    on_stage_changed: StageCallback | None = None,
    on_detail_changed: DetailCallback | None = None,
    on_slice_ready: SliceCallback | None = None,
) -> dict[str, object]:
    settings = settings.normalize()
    markers = _load_export_markers(markers_json, input_path)
    if not markers:
        return {
            "detected_speech_count": 0,
            "slice_count": 0,
            "muted_output_path": "",
        }

    slice_dir = output_dir / "slices"
    if job_index == 1 and slice_dir.exists():
        shutil.rmtree(slice_dir)
    slice_dir.mkdir(parents=True, exist_ok=True)

    if on_stage_changed is not None:
        on_stage_changed("read")
    original_audio, sample_rate, channels = read_audio_frames(input_path)
    total_frames = int(original_audio.shape[0])
    total_duration = seconds_from_samples(total_frames, sample_rate)

    slice_rows: list[SlicerSlice] = []
    for local_index, marker in enumerate(markers, start=1):
        if on_stage_changed is not None:
            on_stage_changed("export")

        start_sec = max(0.0, min(float(marker["startSec"]), total_duration))
        end_sec = max(start_sec, min(float(marker["endSec"]), total_duration))
        start_idx = max(0, min(total_frames, int(round(start_sec * sample_rate))))
        end_idx = max(start_idx + 1, min(total_frames, int(round(end_sec * sample_rate))))
        start_sec = seconds_from_samples(start_idx, sample_rate)
        end_sec = seconds_from_samples(end_idx, sample_rate)
        duration_sec = max(0.0, round(end_sec - start_sec, 6))
        chunk_index = int(marker.get("chunkIndex", local_index))
        chunk_name = (
            f"{job_index:03d}_{safe_name(input_path.stem)}"
            f"_slice_{chunk_index:03d}_{int(start_sec * 1000):08d}_{int(end_sec * 1000):08d}.wav"
        )

        chunk_audio = original_audio[start_idx:end_idx]
        normalized_audio = normalize_clip_audio(
            chunk_audio,
            target_peak=settings.normalize_max,
            alpha=settings.normalize_alpha,
        )
        chunk_path = write_wav(slice_dir / chunk_name, normalized_audio, sample_rate)

        row = SlicerSlice(
            index=0,
            file_name=input_path.name,
            original_path=str(input_path.resolve()),
            chunk_index=chunk_index,
            start_sec=start_sec,
            end_sec=end_sec,
            duration_sec=duration_sec,
            channels=channels,
            marker_count=max(0, int(marker.get("markerCount", 0))),
            output_path=str(chunk_path.resolve()),
            marker_components=_normalize_marker_components(marker.get("markerComponents"), start_sec, end_sec),
            status="completed",
            top_tag="-",
            ng_tags="-",
            tags=[],
        )
        slice_rows.append(row)
        if on_detail_changed is not None:
            on_detail_changed(f"export {local_index}/{len(markers)}")
        if on_slice_ready is not None:
            on_slice_ready(row)

    log(f"[export] {input_path.name}: {len(slice_rows)} slice file(s)")
    return {
        "detected_speech_count": 0,
        "slice_count": len(slice_rows),
        "muted_output_path": "",
    }


def _load_export_markers(markers_json: Path, input_path: Path) -> list[dict[str, object]]:
    if not markers_json.exists():
        raise FileNotFoundError(f"Marker JSON not found: {markers_json}")

    payload = json.loads(markers_json.read_text(encoding="utf-8-sig"))
    rows = payload.get("rows", payload if isinstance(payload, list) else [])
    if not isinstance(rows, list):
        return []

    resolved_input = str(input_path.resolve()).casefold()
    result: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        original_path = str(row.get("originalPath", "")).strip()
        if not original_path:
            continue
        if str(Path(original_path).resolve()).casefold() != resolved_input:
            continue
        try:
            start_sec = float(row.get("startSec", 0.0))
            end_sec = float(row.get("endSec", 0.0))
        except (TypeError, ValueError):
            continue
        if end_sec <= start_sec:
            continue
        row["startSec"] = start_sec
        row["endSec"] = end_sec
        result.append(row)

    return sorted(result, key=lambda item: (float(item["startSec"]), float(item["endSec"])))


def _normalize_marker_components(value: object, fallback_start: float, fallback_end: float) -> list[dict[str, float]]:
    if not isinstance(value, list):
        return [{"startSec": float(fallback_start), "endSec": float(fallback_end)}]

    result: list[dict[str, float]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            start_sec = float(item.get("startSec", fallback_start))
            end_sec = float(item.get("endSec", fallback_end))
        except (TypeError, ValueError):
            continue
        if end_sec > start_sec:
            result.append({"startSec": start_sec, "endSec": end_sec})

    return result or [{"startSec": float(fallback_start), "endSec": float(fallback_end)}]


def run_tagging_pipeline(
    input_path: Path,
    job_index: int,
    settings: SlicerSettings,
    tagger: PretrainedSedFrameTagger | None,
    log: LogFn,
    on_stage_changed: StageCallback | None = None,
    on_detail_changed: DetailCallback | None = None,
    on_slice_ready: SliceCallback | None = None,
) -> dict[str, object]:
    settings = settings.normalize()
    if tagger is None:
        raise RuntimeError("PretrainedSED frame tagger is required for tagging workflow.")

    if on_stage_changed is not None:
        on_stage_changed("read")
    audio, sample_rate, channels = read_audio_frames(input_path)
    duration_sec = seconds_from_samples(int(audio.shape[0]), sample_rate)

    if on_stage_changed is not None:
        on_stage_changed("tag")
    result = tagger.predict_file(input_path, settings, log)
    ranked = result.top_tags
    ng_text = "-"
    top_tag = tagger.format_top_tag(ranked)
    if on_detail_changed is not None:
        on_detail_changed(f"{len(result.frames)} frame row(s), {len(result.events)} event(s)")

    row = SlicerSlice(
        index=0,
        file_name=input_path.name,
        original_path=str(input_path.resolve()),
        chunk_index=job_index,
        start_sec=0.0,
        end_sec=duration_sec,
        duration_sec=duration_sec,
        channels=channels,
        marker_count=0,
        output_path=str(input_path.resolve()),
        status="completed",
        top_tag=top_tag,
        ng_tags=ng_text,
        tags=ranked,
        frame_tags=result.frames,
        events=result.events,
    )
    if on_slice_ready is not None:
        on_slice_ready(row)

    return {
        "detected_speech_count": 0,
        "slice_count": 1,
        "muted_output_path": "",
    }


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("._")
    return (cleaned or "audio")[:96]
