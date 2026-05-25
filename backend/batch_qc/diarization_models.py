from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


TARGET_SAMPLE_RATE = 16000
DEFAULT_DIARIZEN_MODEL_ID = "BUT-FIT/diarizen-wavlm-large-s80-md-v2"
DEFAULT_DIARIZEN_EMBEDDING_MODEL_ID = "pyannote/wespeaker-voxceleb-resnet34-LM"
DIARIZEN_EMBEDDING_FILENAME = "pytorch_model.bin"
BATCH_OVERLAP_LABEL = "오버랩"
BATCH_MULTI_SPEAKER_LABEL = "다중화자"
MIN_OVERLAP_SECONDS = 0.05
GLOBAL_SESSION_GAP_SECONDS = 0.75
MATCH_SAMPLE_CLIP_SECONDS = 30.0
MATCH_MAX_SESSION_SECONDS = 180.0
MATCH_VERIFICATION_SAMPLE_COUNT = 5
MATCH_AUDIO_CACHE_ITEMS = 96


@dataclass(slots=True)
class BatchDiarizationJob:
    item_id: str
    file_name: str
    original_path: str
    transcript: str
    edited_transcript: str
    language: str
    speaker: str
    duration_sec: float = 0.0
    sample_rate: int = 0
    channels: int = 0
    status: str = "queued"
    active_stage: str = "queued"
    error: str = ""
    speaker_count: int = 0
    speaker_turns: str = ""
    has_overlap: bool = False
    overlap_seconds: float = 0.0
    has_multiple_speakers: bool = False
    primary_speaker: str = ""
    speaker_issue: str = ""
    alignment_words: list[dict[str, object]] = field(default_factory=list)
    alignment_warnings: list[str] = field(default_factory=list)
    alignment_summary: dict[str, object] = field(default_factory=dict)

    def to_manifest_dict(self) -> dict[str, object]:
        return {
            "id": self.item_id,
            "fileName": self.file_name,
            "originalPath": self.original_path,
            "transcript": self.transcript,
            "editedTranscript": self.edited_transcript or self.transcript,
            "language": self.language,
            "speaker": self.speaker,
            "durationSec": self.duration_sec,
            "duration_sec": self.duration_sec,
            "sampleRate": self.sample_rate,
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "status": self.status,
            "activeStage": self.active_stage,
            "error": self.error,
            "speakerCount": self.speaker_count,
            "speakerTurns": self.speaker_turns,
            "hasOverlap": self.has_overlap,
            "overlapSeconds": self.overlap_seconds,
            "hasMultipleSpeakers": self.has_multiple_speakers,
            "primarySpeaker": self.primary_speaker,
            "speakerIssue": self.speaker_issue,
            "alignmentWords": self.alignment_words,
            "alignmentWarnings": self.alignment_warnings,
            "alignmentSummary": self.alignment_summary,
        }


@dataclass(slots=True, frozen=True)
class BatchGlobalAudioWindow:
    offset_sec: float
    duration_sec: float


@dataclass(slots=True, frozen=True)
class BatchSpeakerMatchSettings:
    target_sample_rate: int = TARGET_SAMPLE_RATE
    min_overlap_sec: float = MIN_OVERLAP_SECONDS
    sample_clip_sec: float = MATCH_SAMPLE_CLIP_SECONDS
    max_session_sec: float = MATCH_MAX_SESSION_SECONDS
    verification_sample_count: int = MATCH_VERIFICATION_SAMPLE_COUNT
    session_gap_sec: float = GLOBAL_SESSION_GAP_SECONDS
    audio_cache_items: int = MATCH_AUDIO_CACHE_ITEMS
    random_seed: str = "batch_qc_sample_matching_v1"


@dataclass(slots=True)
class BatchSpeakerGroup:
    label: str
    jobs: list[BatchDiarizationJob] = field(default_factory=list)


@dataclass(slots=True)
class BatchSpeakerAudioClip:
    key: str
    job: BatchDiarizationJob
    wav: np.ndarray
    duration_sec: float


@dataclass(slots=True)
class BatchSpeakerCandidate:
    group: BatchSpeakerGroup
    clip: BatchSpeakerAudioClip


@dataclass(slots=True)
class BatchSpeakerSessionOutcome:
    turns_by_key: dict[str, list[dict[str, object]]]
    primary_by_key: dict[str, str]


@dataclass(slots=True)
class BatchSpeakerInitialMatch:
    group: BatchSpeakerGroup | None
    current_turns: list[dict[str, object]]
    blocked_by_current_issue: bool = False


@dataclass(slots=True)
class BatchSpeakerVerification:
    passed: bool
    current_turns: list[dict[str, object]]
    mismatched_clips: list[BatchSpeakerAudioClip] = field(default_factory=list)
    outcome: BatchSpeakerSessionOutcome | None = None
    blocked_by_current_issue: bool = False


class BatchSpeakerDiarizationCancelled(RuntimeError):
    pass