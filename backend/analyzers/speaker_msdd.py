from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from omegaconf import OmegaConf

from ..audio_utils import concat_segments, read_audio_native
from ..runtime import suppress_external_console


class SpeakerMsddMixin:
        def _build_nemo_cfg(self, manifest_path: Path, work_dir: Path) -> Any:
            if self.msdd_single_scale:
                window_length_in_sec = [self.msdd_single_window_sec]
                shift_length_in_sec = [self.msdd_single_shift_sec]
                multiscale_weights = [1]
            else:
                window_length_in_sec = [1.5, 1.25, 1.0, 0.75, 0.5]
                shift_length_in_sec = [0.75, 0.625, 0.5, 0.375, 0.25]
                multiscale_weights = [1, 1, 1, 1, 1]
            cfg_dict = {
                'name': 'NeuralDiarizer',
                'num_workers': 0,
                'sample_rate': 16000,
                'batch_size': 32,
                'device': self.device_str,
                'verbose': False,
                'diarizer': {
                    'manifest_filepath': str(manifest_path),
                    'out_dir': str(work_dir),
                    'oracle_vad': False,
                    'collar': 0.25,
                    'ignore_overlap': False,
                    'vad': {
                        'model_path': self.vad_model_path,
                        'external_vad_manifest': None,
                        'parameters': {
                            'window_length_in_sec': 0.15,
                            'shift_length_in_sec': 0.01,
                            'smoothing': 'median',
                            'overlap': 0.5,
                            'onset': 0.1,
                            'offset': 0.1,
                            'pad_onset': 0.1,
                            'pad_offset': 0.0,
                            'min_duration_on': 0.0,
                            'min_duration_off': 0.2,
                            'filter_speech_first': True,
                        },
                    },
                    'speaker_embeddings': {
                        'model_path': self.embedding_model_path,
                        'parameters': {
                            'window_length_in_sec': window_length_in_sec,
                            'shift_length_in_sec': shift_length_in_sec,
                            'multiscale_weights': multiscale_weights,
                            'save_embeddings': True,
                        },
                    },
                    'clustering': {
                        'parameters': {
                            'oracle_num_speakers': False,
                            'max_num_speakers': self.max_num_speakers,
                            'enhanced_count_thres': 80,
                            'max_rp_threshold': 0.25,
                            'sparse_search_volume': 30,
                            'maj_vote_spk_count': False,
                            'chunk_cluster_count': 50,
                            'embeddings_per_chunk': 10000,
                        },
                    },
                    'msdd_model': {
                        'model_path': self.diarizer_model_path,
                        'parameters': {
                            'use_speaker_model_from_ckpt': True,
                            'infer_batch_size': self.msdd_infer_batch_size,
                            'sigmoid_threshold': [self.msdd_sigmoid_threshold],
                            'seq_eval_mode': False,
                            'split_infer': True,
                            'diar_window_length': self.msdd_diar_window_length,
                            'overlap_infer_spk_limit': self.msdd_overlap_infer_spk_limit,
                        },
                    },
                },
            }
            return OmegaConf.create(cfg_dict)

        @staticmethod
        def _parse_rttm(rttm_path: Path) -> list[tuple[float, float, str]]:
            segments: list[tuple[float, float, str]] = []
            with open(rttm_path, 'r', encoding='utf-8') as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) < 8 or parts[0].upper() != 'SPEAKER':
                        continue
                    start = float(parts[3])
                    dur = float(parts[4])
                    speaker = str(parts[7])
                    end = max(start, start + dur)
                    segments.append((start, end, speaker))
            return segments

        @staticmethod
        def _overlap_seconds(segments: list[tuple[float, float, str]]) -> float:
            events: list[tuple[float, int]] = []
            for start, end, _speaker in segments:
                if end <= start:
                    continue
                events.append((start, 1))
                events.append((end, -1))
            if not events:
                return 0.0
            events.sort(key=lambda x: (x[0], -x[1]))
            active = 0
            prev_t: float | None = None
            total = 0.0
            for t, delta in events:
                if prev_t is not None and t > prev_t and active >= 2:
                    total += t - prev_t
                active += delta
                prev_t = t
            return total

        def _analyze_with_msdd(self, wav_path: str, work_dir: Path) -> dict[str, Any]:
            nemo_input_wav = self._prepare_ascii_input_audio(wav_path, work_dir)
            manifest_path = self._build_manifest(nemo_input_wav, work_dir)
            cfg = self._build_nemo_cfg(manifest_path, work_dir)
            with suppress_external_console():
                diarizer = self._neural_diarizer_cls(cfg=cfg)
                diarizer.diarize()

            rttm_dir = work_dir / 'pred_rttms'
            rttm_path = rttm_dir / f'{self._safe_stem(wav_path)}.rttm'
            if not rttm_path.exists():
                rttm_candidates = sorted(rttm_dir.glob('*.rttm'))
                if not rttm_candidates:
                    return {
                        'has_overlap': 'X',
                        'overlap_seconds': 0.0,
                        'speaker_count': 0,
                        '_speaker_local_items': [],
                        '_warning': 'MSDD produced no RTTM for this file; treated as no valid speaker turns.',
                    }
                rttm_path = rttm_candidates[0]

            diar_segments = self._parse_rttm(rttm_path)
            speaker_segments: dict[str, list[tuple[float, float]]] = {}
            for start, end, speaker in diar_segments:
                if end - start < self.min_segment_sec:
                    continue
                speaker_segments.setdefault(speaker, []).append((start, end))

            overlap_seconds = self._overlap_seconds(diar_segments)

            wav_native, sr_native, _channels = read_audio_native(wav_path)
            if wav_native.ndim > 1:
                wav_mono = np.mean(wav_native, axis=0)
            else:
                wav_mono = wav_native

            local_items: list[dict[str, Any]] = []
            for idx, (speaker, segs) in enumerate(sorted(speaker_segments.items())):
                concat = concat_segments(wav_mono, sr_native, segs, self.max_concat_sec)
                if len(concat) < int(sr_native * self.min_segment_sec):
                    continue
                emb_np = self._embedding_from_concat(concat, sr_native, work_dir, f'msdd_{idx:03d}')
                local_items.append(
                    {
                        'id': f'{wav_path}::L{idx:03d}',
                        'file_path': wav_path,
                        'local_speaker': speaker,
                        'embedding': emb_np,
                    }
                )

            return {
                'has_overlap': 'O' if overlap_seconds > 0.2 else 'X',
                'overlap_seconds': round(overlap_seconds, 3),
                'speaker_count': len(speaker_segments),
                '_speaker_local_items': local_items,
            }
