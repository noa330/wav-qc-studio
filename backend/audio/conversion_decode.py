from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


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
