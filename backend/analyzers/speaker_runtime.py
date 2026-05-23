from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torchaudio

from ..audio_utils import audio_info, read_audio_native
from ..runtime import get_runtime_device, get_runtime_device_str, suppress_external_console


@dataclass
class LocalSpeakerEmbedding:
    id: str
    file_path: str
    local_speaker: str
    embedding: np.ndarray


class SpeakerRuntimeMixin:
        def initialize_runtime(self, cfg: dict[str, Any], method: str = 'msdd') -> None:
            self.cfg = cfg["speaker"]
            raw_method = str(method or self.cfg.get('analysis_method', 'msdd')).strip().lower()
            self.analysis_method = 'embedding_vad' if raw_method in {'embedding_vad', 'embedding+energy-vad', 'embedding'} else 'msdd'
            self.device = get_runtime_device()
            self.device_str = get_runtime_device_str()

            print("[모델 로딩] 화자 분석 런타임 준비 중 · NVIDIA NeMo")
            try:
                with suppress_external_console():
                    import nemo.collections.asr as nemo_asr
                    from nemo.collections.asr.models import EncDecSpeakerLabelModel
                    try:
                        from nemo.collections.asr.models.msdd_models import NeuralDiarizer
                    except Exception:  # noqa: BLE001
                        from nemo.collections.asr.models import NeuralDiarizer
            except Exception as e:  # noqa: BLE001
                raise RuntimeError(
                    "NVIDIA NeMo speaker diarization runtime is unavailable. "
                    "Install nemo_toolkit[asr] and its dependencies first."
                ) from e

            print("[모델 로딩 완료] 화자 분석 런타임 준비 완료")
            self._nemo_asr = nemo_asr
            self._speaker_model_cls = EncDecSpeakerLabelModel
            self._neural_diarizer_cls = NeuralDiarizer

            self.vad_model_path = str(self.cfg.get("vad_model_path", "vad_multilingual_marblenet"))
            self.diarizer_model_path = str(self.cfg.get("diarizer_model_path", "diar_msdd_telephonic"))
            self.embedding_model_path = str(self.cfg.get("embedding_model_path", "titanet_large"))
            self.min_segment_sec = float(self.cfg.get("min_segment_sec", 1.0))
            self.max_concat_sec = float(self.cfg.get("max_concat_sec_per_local_speaker", 12.0))
            self.max_num_speakers = int(self.cfg.get("max_num_speakers", 8))
            self.msdd_infer_batch_size = int(self.cfg.get("msdd_infer_batch_size", 8))
            self.msdd_sigmoid_threshold = float(self.cfg.get("msdd_sigmoid_threshold", 0.7))
            self.msdd_diar_window_length = int(self.cfg.get("msdd_diar_window_length", 50))
            self.msdd_overlap_infer_spk_limit = int(self.cfg.get("msdd_overlap_infer_spk_limit", 5))
            self.fast_mode = bool(self.cfg.get("fast_mode", True))
            self.msdd_min_duration_sec = float(self.cfg.get("msdd_min_duration_sec", 30.0))
            self.msdd_single_scale = bool(self.cfg.get("msdd_single_scale", True))
            self.msdd_single_window_sec = float(self.cfg.get("msdd_single_window_sec", 1.5))
            self.msdd_single_shift_sec = float(self.cfg.get("msdd_single_shift_sec", 0.75))
            self.tmp_root = self.cfg.get("temp_root_dir")
            self.fallback_enabled = bool(self.cfg.get("fallback_to_embedding_vad", True))
            self.fallback_top_db = float(self.cfg.get("fallback_vad_top_db", 35.0))
            self.fallback_min_gap_sec = float(self.cfg.get("fallback_min_gap_sec", 0.15))
            self.fallback_max_seg_sec = float(self.cfg.get("fallback_max_seg_sec", 8.0))
            self.fallback_min_speech_sec = float(self.cfg.get("fallback_min_speech_sec", 0.35))
            self.fallback_max_segments = int(self.cfg.get("fallback_max_segments", 4))
            self.msdd_precheck_enabled = bool(self.cfg.get("msdd_precheck_enabled", True))
            self.msdd_precheck_min_total_speech_sec = float(self.cfg.get("msdd_precheck_min_total_speech_sec", 2.4))
            self.msdd_precheck_min_longest_speech_sec = float(self.cfg.get("msdd_precheck_min_longest_speech_sec", 1.0))
            self.msdd_precheck_min_segments = int(self.cfg.get("msdd_precheck_min_segments", 2))

            print(f"[모델 로딩] 화자 임베딩 모델 준비 중 · {self.embedding_model_path}")
            with suppress_external_console():
                self.embedder = self._speaker_model_cls.from_pretrained(model_name=self.embedding_model_path)
                self.embedder = self.embedder.to(self.device)
                self.embedder.eval()
            print("[모델 로딩 완료] 화자 임베딩 모델 준비 완료")

        @staticmethod
        def _safe_stem(path: str) -> str:
            stem = Path(path).stem
            safe = ''.join(ch if ch.isalnum() or ch in ('-', '_') else '_' for ch in stem).strip('_')
            return safe or 'audio'

        def _prepare_ascii_input_audio(self, wav_path: str, work_dir: Path) -> str:
            src = Path(wav_path)
            suffix = src.suffix if src.suffix else '.wav'
            safe_input = work_dir / f'input_audio{suffix.lower()}'
            try:
                shutil.copy2(src, safe_input)
                return str(safe_input)
            except Exception:
                wav_native, sr_native, _channels = read_audio_native(wav_path)
                if wav_native.ndim > 1:
                    wav_out = np.transpose(wav_native)
                else:
                    wav_out = wav_native
                import soundfile as sf

                sf.write(safe_input, wav_out, sr_native)
                return str(safe_input)

        def _build_manifest(self, wav_path: str, work_dir: Path) -> Path:
            manifest_path = work_dir / 'input_manifest.json'
            item = {
                'audio_filepath': wav_path,
                'offset': 0,
                'duration': None,
                'label': 'infer',
                'text': '-',
                'num_speakers': None,
                'rttm_filepath': None,
                'uem_filepath': None,
            }
            with open(manifest_path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(item, ensure_ascii=True) + "\n")
            return manifest_path

        def _probe_duration_sec(self, wav_path: str) -> float | None:
            try:
                duration_sec, _sr, _ch = audio_info(wav_path)
                return float(duration_sec)
            except Exception:
                try:
                    meta = torchaudio.info(wav_path)
                    if meta.sample_rate > 0:
                        return float(meta.num_frames) / float(meta.sample_rate)
                except Exception:
                    return None
            return None

        def _should_use_fast_fallback(self, wav_path: str) -> bool:
            if not self.fast_mode:
                return False
            duration_sec = self._probe_duration_sec(wav_path)
            if duration_sec is None:
                return False
            return duration_sec < self.msdd_min_duration_sec

        def _msdd_precheck_reason(self, wav_path: str) -> str | None:
            if not self.msdd_precheck_enabled:
                return None
            try:
                wav_native, sr_native, _channels = read_audio_native(wav_path)
                if wav_native.ndim > 1:
                    wav_mono = np.mean(wav_native, axis=0)
                else:
                    wav_mono = wav_native
                speech_segs = self._simple_speech_segments(wav_mono, sr_native)
            except Exception:
                return None

            if not speech_segs:
                return 'no usable speech segment after precheck'

            total_speech = float(sum(max(0.0, end - start) for start, end in speech_segs))
            longest_speech = float(max((end - start) for start, end in speech_segs))
            segment_count = int(len(speech_segs))

            if total_speech < self.msdd_precheck_min_total_speech_sec:
                return f'insufficient effective speech ({total_speech:.2f}s < {self.msdd_precheck_min_total_speech_sec:.2f}s)'
            if longest_speech < self.msdd_precheck_min_longest_speech_sec:
                return f'longest speech chunk too short ({longest_speech:.2f}s < {self.msdd_precheck_min_longest_speech_sec:.2f}s)'
            if segment_count < self.msdd_precheck_min_segments:
                return f'too few speech segments ({segment_count} < {self.msdd_precheck_min_segments})'
            return None
