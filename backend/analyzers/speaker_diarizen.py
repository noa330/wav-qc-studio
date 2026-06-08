from __future__ import annotations

from pathlib import Path
from typing import Any

from ..batch_qc.diarization import DiariZenBatchDiarizer


class DiariZenScoreSpeakerAnalyzer:
    def __init__(self, cfg: dict[str, Any]) -> None:
        self.diarizer = DiariZenBatchDiarizer(cfg)

    def analyze(self, wav_path: str) -> dict[str, Any]:
        path = Path(wav_path)
        turns = self.diarizer.diarize(path, session_name=f"score_{self._safe_stem(path)}")
        speakers = {speaker for _start, _end, speaker in turns}
        overlap_seconds = self._overlap_seconds(turns)
        return {
            "has_overlap": "O" if overlap_seconds > 0 else "X",
            "overlap_seconds": overlap_seconds,
            "speaker_count": len(speakers),
            "_speaker_local_items": [],
            "_warning": "" if turns else "DiariZen returned no speaker turns for this file.",
        }

    @staticmethod
    def _safe_stem(path: Path) -> str:
        stem = path.stem
        safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in stem).strip("_")
        return safe or "audio"

    @staticmethod
    def _overlap_seconds(turns: list[tuple[float, float, str]]) -> float:
        total = 0.0
        ordered = sorted(turns, key=lambda item: (item[0], item[1], item[2]))
        for index, (left_start, left_end, left_speaker) in enumerate(ordered):
            for right_start, right_end, right_speaker in ordered[index + 1 :]:
                if right_start >= left_end:
                    break
                if left_speaker == right_speaker:
                    continue
                overlap = min(left_end, right_end) - max(left_start, right_start)
                if overlap > 0:
                    total += overlap
        return round(total, 3)
