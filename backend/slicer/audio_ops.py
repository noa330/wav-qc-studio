from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import soundfile as sf

from .schema import SlicerSettings

TARGET_SR = 16000


def read_audio_frames(path: str | Path) -> tuple[np.ndarray, int, int]:
    try:
        audio, sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
    except Exception as exc:
        raise RuntimeError(f"Could not read audio file: {path} ({exc})") from exc

    if audio.size == 0:
        raise RuntimeError(f"Audio file is empty: {path}")

    audio = np.nan_to_num(audio.astype(np.float32, copy=False))
    channels = int(audio.shape[1])
    return np.clip(audio, -1.0, 1.0), int(sample_rate), channels


def to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return np.nan_to_num(audio.astype(np.float32, copy=False))
    return np.nan_to_num(np.mean(audio, axis=1, dtype=np.float64).astype(np.float32, copy=False))


def resample_linear(samples: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return samples.astype(np.float32, copy=False)
    if len(samples) == 0:
        return samples.astype(np.float32, copy=False)

    duration = len(samples) / float(src_sr)
    dst_len = max(1, int(round(duration * dst_sr)))
    src_x = np.linspace(0.0, duration, num=len(samples), endpoint=False, dtype=np.float64)
    dst_x = np.linspace(0.0, duration, num=dst_len, endpoint=False, dtype=np.float64)
    return np.interp(dst_x, src_x, samples).astype(np.float32)


def resample_poly(samples: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return samples.astype(np.float32, copy=False)
    if len(samples) == 0:
        return samples.astype(np.float32, copy=False)

    from scipy.signal import resample_poly as scipy_resample_poly

    gcd = math.gcd(src_sr, dst_sr)
    up = dst_sr // gcd
    down = src_sr // gcd
    return scipy_resample_poly(samples, up, down).astype(np.float32)


def write_wav(path: str | Path, audio: np.ndarray, sample_rate: int) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(target), np.clip(audio, -1.0, 1.0), sample_rate, subtype="PCM_16")
    return target


def normalize_clip_audio(
    audio: np.ndarray,
    target_peak: float,
    alpha: float,
) -> np.ndarray:
    frames = np.nan_to_num(audio.astype(np.float32, copy=True))
    if frames.size == 0:
        return frames

    peak = float(np.max(np.abs(frames)))
    if peak <= 1e-8:
        return np.clip(frames, -1.0, 1.0).astype(np.float32, copy=False)

    target_peak = max(0.0, min(1.0, float(target_peak)))
    alpha = max(0.0, min(1.0, float(alpha)))
    if not np.isfinite(target_peak) or not np.isfinite(alpha):
        raise ValueError("Normalization settings are invalid.")

    normalized = frames / peak * target_peak
    mixed = normalized * alpha + frames * (1.0 - alpha)
    return np.clip(mixed, -1.0, 1.0).astype(np.float32, copy=False)


def snap_to_zero_crossing(
    mono: np.ndarray,
    sample_rate: int,
    sample_idx: int,
    search_ms: float,
    direction: str = "nearest",
) -> int:
    total = int(mono.shape[0])
    if total <= 1 or sample_rate <= 0:
        return int(max(0, min(sample_idx, total)))

    idx = int(max(1, min(sample_idx, total - 1)))
    search = max(1, int(round((search_ms / 1000.0) * sample_rate)))
    lo = max(1, idx - search)
    hi = min(total - 1, idx + search)
    if hi <= lo:
        return idx

    segment = mono[lo - 1 : hi + 1]
    zero_hits = np.where(
        (segment[:-1] == 0.0)
        | (segment[1:] == 0.0)
        | ((segment[:-1] < 0.0) & (segment[1:] > 0.0))
        | ((segment[:-1] > 0.0) & (segment[1:] < 0.0))
    )[0]
    if zero_hits.size == 0:
        return idx

    candidates = lo + zero_hits
    if direction == "left":
        left = candidates[candidates <= idx]
        if left.size:
            return int(left[-1])
    elif direction == "right":
        right = candidates[candidates >= idx]
        if right.size:
            return int(right[0])
    return int(candidates[np.argmin(np.abs(candidates - idx))])


def snap_to_quiet_boundary(
    mono: np.ndarray,
    sample_rate: int,
    sample_idx: int,
    search_ms: float,
    zero_cross_search_ms: float,
) -> int:
    total = int(mono.shape[0])
    if total <= 1 or sample_rate <= 0 or search_ms <= 0.0:
        return snap_to_zero_crossing(mono, sample_rate, sample_idx, zero_cross_search_ms)

    idx = int(max(0, min(sample_idx, total - 1)))
    search = max(1, int(round((search_ms / 1000.0) * sample_rate)))
    lo = max(0, idx - search)
    hi = min(total, idx + search + 1)
    if hi - lo <= 2:
        return snap_to_zero_crossing(mono, sample_rate, idx, zero_cross_search_ms)

    segment = mono[lo:hi].astype(np.float32, copy=False)
    energy = np.square(segment, dtype=np.float32)
    window = max(3, int(round(0.010 * sample_rate)))
    window = min(window, energy.size)
    if window > 1:
        kernel = np.ones(window, dtype=np.float32) / float(window)
        scores = np.convolve(energy, kernel, mode="same")
    else:
        scores = energy

    min_score = float(np.min(scores))
    candidates = np.flatnonzero(scores <= (min_score * 1.05 + 1e-12))
    if candidates.size == 0:
        quiet_idx = int(np.argmin(scores))
    else:
        quiet_idx = int(candidates[np.argmin(np.abs((lo + candidates) - idx))])

    quiet_sample = lo + quiet_idx
    return snap_to_zero_crossing(mono, sample_rate, quiet_sample, zero_cross_search_ms)


def build_keep_ranges(
    audio_frames: np.ndarray,
    sample_rate: int,
    speech_segments: list[tuple[float, float]],
    settings: SlicerSettings,
) -> list[tuple[int, int]]:
    total_frames = int(audio_frames.shape[0])
    if total_frames <= 0 or sample_rate <= 0:
        return []

    mono = to_mono(audio_frames)
    pad_frames = max(0, int(round((settings.speech_pad_ms / 1000.0) * sample_rate)))
    merge_gap_frames = max(0, int(round((settings.monitor_merge_gap_ms / 1000.0) * sample_rate)))
    merge_max_frames = max(0, int(round((settings.monitor_merge_max_ms / 1000.0) * sample_rate)))
    ranges: list[tuple[int, int]] = []

    for start_sec, end_sec in speech_segments:
        start_idx = max(0, int(np.floor(float(start_sec) * sample_rate)) - pad_frames)
        end_idx = min(total_frames, int(np.ceil(float(end_sec) * sample_rate)) + pad_frames)
        if end_idx <= start_idx:
            continue

        start_idx = snap_to_quiet_boundary(
            mono,
            sample_rate,
            start_idx,
            settings.quiet_boundary_search_ms,
            settings.zero_cross_search_ms,
        )
        end_idx = snap_to_quiet_boundary(
            mono,
            sample_rate,
            end_idx,
            settings.quiet_boundary_search_ms,
            settings.zero_cross_search_ms,
        )
        if end_idx > start_idx:
            ranges.append((int(start_idx), int(end_idx)))

    if not ranges:
        return []

    ranges.sort()
    merged: list[list[int]] = [[ranges[0][0], ranges[0][1]]]
    for start_idx, end_idx in ranges[1:]:
        previous = merged[-1]
        next_duration = end_idx - previous[0]
        if start_idx <= previous[1] + merge_gap_frames and (merge_max_frames <= 0 or next_duration <= merge_max_frames):
            previous[1] = max(previous[1], end_idx)
        else:
            merged.append([start_idx, end_idx])

    return [(int(start_idx), int(end_idx)) for start_idx, end_idx in merged]


def build_mute_ranges(total_frames: int, keep_ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if total_frames <= 0:
        return []
    if not keep_ranges:
        return [(0, total_frames)]

    mute_ranges: list[tuple[int, int]] = []
    cursor = 0
    for start_idx, end_idx in sorted(keep_ranges):
        start_idx = max(0, min(total_frames, int(start_idx)))
        end_idx = max(0, min(total_frames, int(end_idx)))
        if start_idx > cursor:
            mute_ranges.append((cursor, start_idx))
        cursor = max(cursor, end_idx)
    if cursor < total_frames:
        mute_ranges.append((cursor, total_frames))
    return [(start_idx, end_idx) for start_idx, end_idx in mute_ranges if end_idx > start_idx]


def daw_style_mute_ranges(
    audio: np.ndarray,
    sample_rate: int,
    mute_ranges: list[tuple[int, int]],
    splice_ms: float = 35.0,
    floor_db: float = -90.0,
) -> np.ndarray:
    out = np.array(audio, dtype=np.float32, copy=True)
    if out.ndim == 1:
        out = out[:, None]

    total_samples, channels = out.shape
    if total_samples <= 0 or sample_rate <= 0:
        return out

    floor_amp = 0.0 if float(floor_db) <= -119.9 else float(10.0 ** (float(floor_db) / 20.0))
    if not np.isfinite(floor_amp):
        raise ValueError("floor dB value is invalid.")

    splice_base = max(1, int(round(float(splice_ms) * sample_rate / 1000.0)))
    rng = np.random.default_rng()

    for start_idx, end_idx in mute_ranges:
        start = max(0, min(int(start_idx), total_samples))
        end = max(0, min(int(end_idx), total_samples))
        if end <= start:
            continue

        region_len = end - start
        if floor_amp > 0.0:
            floor_region = rng.standard_normal((region_len, channels), dtype=np.float32) * floor_amp
        else:
            floor_region = np.zeros((region_len, channels), dtype=np.float32)
        out[start:end] = floor_region

        splice = min(splice_base, start, total_samples - end, max(1, region_len // 2))
        if splice <= 0:
            continue

        t = np.linspace(0.0, 1.0, splice, dtype=np.float32)
        fade_out = np.cos(t * np.pi / 2.0)
        fade_in = np.sin(t * np.pi / 2.0)

        pre = out[start - splice : start].copy()
        floor_in = floor_region[:splice]
        out[start - splice : start] = pre * fade_out[:, None] + floor_in * fade_in[:, None]

        post = out[end : end + splice].copy()
        floor_out = floor_region[-splice:]
        out[end : end + splice] = floor_out * fade_out[:, None] + post * fade_in[:, None]

    return np.clip(out, -1.0, 1.0).astype(np.float32, copy=False)


def group_keep_ranges(
    keep_ranges: list[tuple[int, int]],
    sample_rate: int,
    split_gap_sec: float,
    max_merge_ms: float = 0.0,
) -> list[tuple[int, int, int, list[tuple[int, int]]]]:
    if not keep_ranges:
        return []

    threshold_frames = max(0, int(round(split_gap_sec * sample_rate)))
    max_merge_frames = max(0, int(round((max_merge_ms / 1000.0) * sample_rate)))
    groups: list[dict[str, object]] = [{"start": keep_ranges[0][0], "end": keep_ranges[0][1], "components": [keep_ranges[0]]}]
    for start_idx, end_idx in keep_ranges[1:]:
        current = groups[-1]
        current_end = int(current["end"])
        current_start = int(current["start"])
        gap = start_idx - current_end
        next_duration = end_idx - current_start
        if gap >= threshold_frames or (max_merge_frames > 0 and next_duration > max_merge_frames):
            groups.append({"start": start_idx, "end": end_idx, "components": [(start_idx, end_idx)]})
        else:
            current["end"] = max(current_end, end_idx)
            components = current["components"]
            assert isinstance(components, list)
            components.append((start_idx, end_idx))

    result: list[tuple[int, int, int, list[tuple[int, int]]]] = []
    for group in groups:
        components = group["components"]
        assert isinstance(components, list)
        result.append((int(group["start"]), int(group["end"]), len(components), [(int(start), int(end)) for start, end in components]))
    return result


def extract_tagger_audio(
    audio_frames: np.ndarray,
    sample_rate: int,
    start_idx: int,
    end_idx: int,
) -> np.ndarray:
    start = max(0, min(int(start_idx), int(audio_frames.shape[0])))
    end = max(0, min(int(end_idx), int(audio_frames.shape[0])))
    if end <= start:
        return np.zeros(TARGET_SR, dtype=np.float32)

    mono = to_mono(audio_frames[start:end])
    return resample_poly(mono, sample_rate, TARGET_SR).astype(np.float32)


def seconds_from_samples(sample_index: int, sample_rate: int) -> float:
    if sample_rate <= 0:
        return 0.0
    return round(float(sample_index) / float(sample_rate), 6)
