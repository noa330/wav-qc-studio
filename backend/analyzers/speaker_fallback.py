from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from sklearn.cluster import AgglomerativeClustering

from ..audio_utils import concat_segments, read_audio_native


class SpeakerFallbackMixin:
        @staticmethod
        def _merge_segments(segments: list[tuple[float, float]], min_gap_sec: float) -> list[tuple[float, float]]:
            if not segments:
                return []
            merged: list[list[float]] = [[segments[0][0], segments[0][1]]]
            for start, end in segments[1:]:
                prev = merged[-1]
                if start - prev[1] <= min_gap_sec:
                    prev[1] = max(prev[1], end)
                else:
                    merged.append([start, end])
            return [(float(s), float(e)) for s, e in merged]

        def _simple_speech_segments(self, wav: np.ndarray, sr: int) -> list[tuple[float, float]]:
            import librosa

            wav = np.asarray(wav, dtype=np.float32).reshape(-1)
            if wav.size == 0:
                return []
            intervals = librosa.effects.split(
                wav,
                top_db=self.fallback_top_db,
                frame_length=2048,
                hop_length=512,
            )
            raw = [(float(start) / sr, float(end) / sr) for start, end in intervals.tolist() if end > start]
            merged = self._merge_segments(raw, self.fallback_min_gap_sec)
            trimmed: list[tuple[float, float]] = []
            for start, end in merged:
                dur = end - start
                if dur < self.fallback_min_speech_sec:
                    continue
                if dur <= self.fallback_max_seg_sec:
                    trimmed.append((start, end))
                    continue
                cursor = start
                chunk = min(self.max_concat_sec, self.fallback_max_seg_sec)
                step = max(self.min_segment_sec, chunk)
                while cursor < end:
                    chunk_end = min(cursor + chunk, end)
                    if chunk_end - cursor >= self.fallback_min_speech_sec:
                        trimmed.append((cursor, chunk_end))
                    if chunk_end >= end:
                        break
                    cursor += step
            if len(trimmed) > self.fallback_max_segments:
                trimmed = sorted(trimmed, key=lambda x: (x[1] - x[0]), reverse=True)[: self.fallback_max_segments]
                trimmed = sorted(trimmed, key=lambda x: x[0])
            return trimmed

        def _embedding_from_concat(self, audio: np.ndarray, sr: int, work_dir: Path, speaker_key: str) -> np.ndarray:
            tmp_wav = work_dir / f'embed_{speaker_key}.wav'
            sig = np.asarray(audio, dtype=np.float32)
            if sig.ndim != 1:
                sig = sig.reshape(-1)
            max_abs = float(np.max(np.abs(sig))) if sig.size else 0.0
            if max_abs > 1.0:
                sig = sig / max_abs
            import soundfile as sf

            sf.write(tmp_wav, sig, sr)
            emb = self.embedder.get_embedding(str(tmp_wav))
            emb_np = emb.squeeze().detach().cpu().numpy().astype(np.float32)
            return emb_np

        def _analyze_with_embedding_fallback(self, wav_path: str, work_dir: Path, cause: Exception | None = None, emit_warning: bool = True) -> dict[str, Any]:
            wav_native, sr_native, _channels = read_audio_native(wav_path)
            if wav_native.ndim > 1:
                wav_mono = np.mean(wav_native, axis=0)
            else:
                wav_mono = wav_native

            speech_segs = self._simple_speech_segments(wav_mono, sr_native)
            if not speech_segs:
                warning = 'Embedding fallback found no usable speech segment.'
                if cause is not None:
                    warning = f'{warning} Root cause: {type(cause).__name__}: {cause}'
                return {
                    'has_overlap': 'X',
                    'overlap_seconds': 0.0,
                    'speaker_count': 0,
                    '_speaker_local_items': [],
                    '_warning': warning if emit_warning else '',
                }

            seg_embeddings: list[np.ndarray] = []
            seg_meta: list[tuple[float, float]] = []
            for idx, (start, end) in enumerate(speech_segs):
                seg_audio = concat_segments(wav_mono, sr_native, [(start, end)], self.fallback_max_seg_sec)
                if len(seg_audio) < int(sr_native * self.fallback_min_speech_sec):
                    continue
                emb_np = self._embedding_from_concat(seg_audio, sr_native, work_dir, f'fbseg_{idx:03d}')
                seg_embeddings.append(emb_np)
                seg_meta.append((start, end))

            if not seg_embeddings:
                warning = 'Embedding fallback could not extract any segment embedding.'
                if cause is not None:
                    warning = f'{warning} Root cause: {type(cause).__name__}: {cause}'
                return {
                    'has_overlap': 'X',
                    'overlap_seconds': 0.0,
                    'speaker_count': 0,
                    '_speaker_local_items': [],
                    '_warning': warning if emit_warning else '',
                }

            if len(seg_embeddings) == 1:
                labels = np.array([0], dtype=np.int32)
            else:
                X = np.stack(seg_embeddings, axis=0)
                clusterer = AgglomerativeClustering(
                    n_clusters=None,
                    metric='cosine',
                    linkage='average',
                    distance_threshold=float(self.cfg.get('cluster_distance_threshold', 0.30)),
                )
                labels = clusterer.fit_predict(X)

            grouped: dict[int, list[tuple[float, float]]] = {}
            for (start, end), label in zip(seg_meta, labels.tolist()):
                grouped.setdefault(int(label), []).append((start, end))

            local_items: list[dict[str, Any]] = []
            for out_idx, old_label in enumerate(sorted(grouped)):
                segs = grouped[old_label]
                concat = concat_segments(wav_mono, sr_native, segs, self.max_concat_sec)
                if len(concat) < int(sr_native * self.fallback_min_speech_sec):
                    continue
                emb_np = self._embedding_from_concat(concat, sr_native, work_dir, f'fallback_{out_idx:03d}')
                local_items.append(
                    {
                        'id': f'{wav_path}::L{out_idx:03d}',
                        'file_path': wav_path,
                        'local_speaker': f'fallback_{out_idx:03d}',
                        'embedding': emb_np,
                    }
                )

            warning = ''
            if emit_warning:
                warning = 'MSDD diarization failed, so embedding+energy-VAD fallback was used.'
                if cause is not None:
                    warning = f'{warning} Root cause: {type(cause).__name__}: {cause}'

            return {
                'has_overlap': 'X',
                'overlap_seconds': 0.0,
                'speaker_count': len(local_items),
                '_speaker_local_items': local_items,
                '_warning': warning,
            }
