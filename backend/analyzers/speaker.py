from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from .speaker_fallback import SpeakerFallbackMixin
from .speaker_diarizen import DiariZenScoreSpeakerAnalyzer
from .speaker_msdd import SpeakerMsddMixin
from .speaker_runtime import LocalSpeakerEmbedding, SpeakerRuntimeMixin


class _NemoSpeakerAnalyzer(SpeakerRuntimeMixin, SpeakerMsddMixin, SpeakerFallbackMixin):
    def __init__(self, cfg: dict[str, Any], method: str = "msdd") -> None:
        self.initialize_runtime(cfg, method)

    def analyze(self, wav_path: str) -> dict[str, Any]:
        tmp_base = Path(self.tmp_root) if self.tmp_root else None
        work_dir_path = tempfile.mkdtemp(prefix="wavqc_nemo_", dir=str(tmp_base) if tmp_base else None)
        work_dir = Path(work_dir_path)
        try:
            if self.analysis_method == "embedding_vad":
                return self._analyze_with_embedding_fallback(wav_path, work_dir, cause=None, emit_warning=False)

            return self._analyze_with_msdd(wav_path, work_dir)
        except Exception as e:  # noqa: BLE001
            if self.analysis_method == "embedding_vad":
                raise RuntimeError(f"Embedding+energy-VAD analysis failed: {type(e).__name__}: {e}") from e

            if self.fallback_enabled:
                try:
                    return self._analyze_with_embedding_fallback(wav_path, work_dir, cause=e, emit_warning=True)
                except Exception as fb_e:  # noqa: BLE001
                    raise RuntimeError(
                        f"NeMo local diarization failed; MSDD error={type(e).__name__}: {e}; "
                        f"fallback error={type(fb_e).__name__}: {fb_e}"
                    ) from fb_e
            raise RuntimeError(f"NeMo local diarization failed: {type(e).__name__}: {e}") from e
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


class SpeakerAnalyzer:
    def __init__(self, cfg: dict[str, Any], method: str = "msdd") -> None:
        speaker_cfg = cfg.get("speaker", {})
        backend = str(speaker_cfg.get("backend", "nemo") or "nemo").strip().lower()
        if backend == "diarizen":
            self._impl = DiariZenScoreSpeakerAnalyzer(cfg)
        else:
            self._impl = _NemoSpeakerAnalyzer(cfg, method)

    def analyze(self, wav_path: str) -> dict[str, Any]:
        return self._impl.analyze(wav_path)


__all__ = ["LocalSpeakerEmbedding", "SpeakerAnalyzer"]
