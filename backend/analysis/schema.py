from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class TaskSelection:
    pron: bool = False
    noise: bool = False
    speaker: bool = False
    speaker_method: str = "msdd"
    transcription_language: str = "auto"

    def normalize(self) -> "TaskSelection":
        if not any([self.pron, self.noise, self.speaker]):
            self.pron = self.noise = self.speaker = True
        return self


@dataclass
class FileAnalysisResult:
    file_name: str
    absolute_path: str
    duration_sec: float = 0.0
    sample_rate: int = 0
    channels: int = 0

    transcript: str = ""
    language: str = ""
    pronunciation_score_1to5: float | None = None
    pronunciation_flag_bad: str = ""

    noise_bak: float | None = None
    noise_sig: float | None = None
    noise_ovrl: float | None = None
    noise_p808_mos: float | None = None

    speaker_count: int | None = None
    speaker_groups: str = ""

    error: str = ""

    _speaker_local_items: list[dict[str, Any]] = field(default_factory=list, repr=False)

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        row.pop("_speaker_local_items", None)
        return row
