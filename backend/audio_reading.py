from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import soundfile as sf

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
