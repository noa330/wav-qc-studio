from __future__ import annotations

import json
import os
import random
import tempfile
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any, Callable

import numpy as np
import soundfile as sf

from ..audio_utils import audio_info, read_audio
from ..manifest_io import atomic_write_json
from ..runtime import hf_hub_download, hf_repo_dir, hf_snapshot_download, load_config, merge_config_overrides, suppress_external_console
from .schema import BATCH_UNKNOWN_SPEAKER_LABEL, BatchQcExportSummary
from .diarization_models import (
    BATCH_MULTI_SPEAKER_LABEL,
    BATCH_OVERLAP_LABEL,
    DEFAULT_DIARIZEN_EMBEDDING_MODEL_ID,
    DEFAULT_DIARIZEN_MODEL_ID,
    DIARIZEN_EMBEDDING_FILENAME,
    GLOBAL_SESSION_GAP_SECONDS,
    MATCH_AUDIO_CACHE_ITEMS,
    MATCH_MAX_SESSION_SECONDS,
    MATCH_SAMPLE_CLIP_SECONDS,
    MATCH_VERIFICATION_SAMPLE_COUNT,
    MIN_OVERLAP_SECONDS,
    TARGET_SAMPLE_RATE,
    BatchDiarizationJob,
    BatchGlobalAudioWindow,
    BatchSpeakerAudioClip,
    BatchSpeakerCandidate,
    BatchSpeakerDiarizationCancelled,
    BatchSpeakerGroup,
    BatchSpeakerInitialMatch,
    BatchSpeakerMatchSettings,
    BatchSpeakerSessionOutcome,
    BatchSpeakerVerification,
)


class DiariZenBatchDiarizer:
    def __init__(self, cfg: dict[str, Any] | None = None) -> None:
        cfg = (cfg or load_config()).get("speaker", {})
        self.model_id = str(cfg.get("diarizen_model_id", DEFAULT_DIARIZEN_MODEL_ID))
        self.embedding_model_id = str(cfg.get("diarizen_embedding_model_id", DEFAULT_DIARIZEN_EMBEDDING_MODEL_ID))
        raw_cache_dir = cfg.get("diarizen_cache_dir")
        self.cache_dir = Path(str(raw_cache_dir).strip()) if raw_cache_dir else hf_repo_dir(self.model_id, namespace="batch_qc")
        raw_embedding_cache_dir = cfg.get("diarizen_embedding_cache_dir")
        self.embedding_cache_dir = Path(str(raw_embedding_cache_dir).strip()) if raw_embedding_cache_dir else hf_repo_dir(self.embedding_model_id, namespace="batch_qc")
        self.model_path = hf_snapshot_download(
            self.model_id,
            local_dir=self.cache_dir,
            log=print,
            label="DiariZen",
        )
        self.embedding_model_path = hf_hub_download(
            self.embedding_model_id,
            filename=DIARIZEN_EMBEDDING_FILENAME,
            local_dir=self.embedding_cache_dir,
            log=print,
            label="DiariZen embedding",
        )
        os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

        try:
            with suppress_external_console():
                from diarizen.pipelines.inference import DiariZenPipeline
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "DiariZen runtime is unavailable. Install DiariZen and pyannote.audio in .venv before running Script speaker separation."
            ) from exc

        print(f"[model] Loading DiariZen speaker diarization model: {self.model_id}")
        with suppress_external_console():
            self.pipeline = DiariZenPipeline(
                diarizen_hub=Path(self.model_path),
                embedding_model=self.embedding_model_path,
            )
        print("[model] DiariZen speaker diarization model is ready")

    def diarize(self, wav_path: Path, session_name: str) -> list[tuple[float, float, str]]:
        with suppress_external_console():
            result = self.pipeline(str(wav_path), sess_name=session_name)

        turns: list[tuple[float, float, str]] = []
        for turn, _, speaker in result.itertracks(yield_label=True):
            start = float(turn.start)
            end = float(turn.end)
            if end <= start:
                continue
            turns.append((start, end, str(speaker)))
        return turns


def run_batch_speaker_diarization(
    request_path: Path,
    manifest_path: Path,
    cancel_file: Path | None = None,
    config_overrides: dict[str, dict[str, Any]] | None = None,
) -> int:
    payload = json.loads(request_path.read_text(encoding="utf-8-sig"))
    input_folder = str(payload.get("inputFolder", "") or "")
    jobs = _load_jobs(payload)
    if not jobs:
        raise ValueError("No Script rows were provided for speaker separation.")

    _write_manifest(manifest_path, input_folder, jobs, "running")
    valid_jobs = _prepare_valid_jobs(jobs)
    _write_manifest(manifest_path, input_folder, jobs, "running")
    if _cancel_requested(cancel_file):
        _mark_cancelled(jobs)
        _write_manifest(manifest_path, input_folder, jobs, "failed")
        return 130

    if not valid_jobs:
        _write_manifest(manifest_path, input_folder, jobs, "completed_with_errors")
        return 1

    cfg = load_config()
    if config_overrides:
        merge_config_overrides(cfg, config_overrides)
    speaker_cfg = cfg.get("speaker", {})
    target_sample_rate = int(speaker_cfg.get("batch_qc_target_sample_rate", TARGET_SAMPLE_RATE))
    min_overlap_sec = float(speaker_cfg.get("batch_qc_min_overlap_sec", MIN_OVERLAP_SECONDS))
    match_settings = _batch_speaker_match_settings(speaker_cfg, target_sample_rate, min_overlap_sec)

    with tempfile.TemporaryDirectory(prefix="wavqc_diarizen_") as work_dir_raw:
        work_dir = Path(work_dir_raw)

        try:
            strategy = SampleMatchingBatchDiarizationStrategy(
                valid_jobs,
                diarizer_factory=lambda: DiariZenBatchDiarizer(cfg),
                work_dir=work_dir,
                settings=match_settings,
                on_update=lambda: _write_manifest(manifest_path, input_folder, jobs, "running"),
                should_cancel=lambda: _cancel_requested(cancel_file),
            )
            strategy.run()
        except BatchSpeakerDiarizationCancelled:
            _mark_cancelled(valid_jobs)
            _write_manifest(manifest_path, input_folder, jobs, "failed")
            return 130
        except Exception as exc:  # noqa: BLE001
            for job in valid_jobs:
                if job.status in {"queued", "running"}:
                    job.status = "failed"
                    job.active_stage = "failed"
                    job.error = f"{type(exc).__name__}: {exc}"

        _write_manifest(manifest_path, input_folder, jobs, "running")

    failed = any(job.status == "failed" for job in jobs)
    _write_manifest(manifest_path, input_folder, jobs, "completed_with_errors" if failed else "completed")
    return 1 if failed else 0


def _load_jobs(payload: dict[str, Any]) -> list[BatchDiarizationJob]:
    rows = payload.get("jobs", [])
    if not isinstance(rows, list):
        return []

    jobs: list[BatchDiarizationJob] = []
    for index, item in enumerate(rows, start=1):
        if not isinstance(item, dict):
            continue
        original_path = str(item.get("originalPath", "") or item.get("absolute_path", "") or "")
        file_name = str(item.get("fileName", "") or Path(original_path).name or f"row_{index}.wav")
        jobs.append(
            BatchDiarizationJob(
                item_id=str(item.get("id", "") or f"{index:06d}"),
                file_name=file_name,
                original_path=original_path,
                transcript=str(item.get("transcript", "") or ""),
                edited_transcript=str(item.get("editedTranscript", "") or item.get("edited_transcript", "") or item.get("transcript", "") or ""),
                language=str(item.get("language", "") or ""),
                speaker=str(item.get("speaker", "") or BATCH_UNKNOWN_SPEAKER_LABEL),
                duration_sec=_float_value(item.get("durationSec", item.get("duration_sec", 0.0))),
                sample_rate=_int_value(item.get("sampleRate", item.get("sample_rate", 0))),
                channels=_int_value(item.get("channels", 0)),
                alignment_words=_record_list(item.get("alignmentWords")),
                alignment_warnings=_string_list(item.get("alignmentWarnings")),
                alignment_summary=_record_value(item.get("alignmentSummary")),
            )
        )
    return jobs


def _float_value(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _int_value(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _record_list(value: Any) -> list[dict[str, object]]:
    parsed = _json_value(value)
    if not isinstance(parsed, list):
        return []
    return [dict(item) for item in parsed if isinstance(item, dict)]


def _string_list(value: Any) -> list[str]:
    parsed = _json_value(value)
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if item is not None]


def _record_value(value: Any) -> dict[str, object]:
    parsed = _json_value(value)
    return dict(parsed) if isinstance(parsed, dict) else {}


def _prepare_valid_jobs(jobs: list[BatchDiarizationJob]) -> list[BatchDiarizationJob]:
    valid_jobs: list[BatchDiarizationJob] = []
    for job in jobs:
        path = Path(job.original_path)
        if not job.original_path or not path.exists() or path.suffix.lower() != ".wav":
            job.status = "failed"
            job.active_stage = "missing_audio"
            job.error = f"Audio file not found: {job.original_path}"
            continue

        job.status = "queued"
        job.active_stage = "queued"
        valid_jobs.append(job)
    return valid_jobs


def _batch_speaker_match_settings(
    speaker_cfg: dict[str, Any],
    target_sample_rate: int,
    min_overlap_sec: float,
) -> BatchSpeakerMatchSettings:
    return BatchSpeakerMatchSettings(
        target_sample_rate=max(8000, min(48000, int(target_sample_rate))),
        min_overlap_sec=max(0.0, float(min_overlap_sec)),
        sample_clip_sec=_bounded_float(speaker_cfg.get("batch_qc_match_sample_clip_sec"), MATCH_SAMPLE_CLIP_SECONDS, 1.0, 120.0),
        max_session_sec=_bounded_float(speaker_cfg.get("batch_qc_match_max_session_sec"), MATCH_MAX_SESSION_SECONDS, 30.0, 600.0),
        verification_sample_count=_bounded_int(speaker_cfg.get("batch_qc_match_verification_samples"), MATCH_VERIFICATION_SAMPLE_COUNT, 1, 20),
        session_gap_sec=_bounded_float(speaker_cfg.get("batch_qc_match_gap_sec"), GLOBAL_SESSION_GAP_SECONDS, 0.0, 5.0),
        audio_cache_items=_bounded_int(speaker_cfg.get("batch_qc_match_audio_cache_items"), MATCH_AUDIO_CACHE_ITEMS, 0, 2048),
        random_seed=str(speaker_cfg.get("batch_qc_match_random_seed") or "batch_qc_sample_matching_v1"),
    )


def _bounded_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _read_single_audio_array(job: BatchDiarizationJob, target_sample_rate: int = TARGET_SAMPLE_RATE) -> np.ndarray:
    wav, _sr = read_audio(job.original_path, target_sr=target_sample_rate, mono=True)
    wav = np.asarray(wav, dtype=np.float32).reshape(-1)
    if wav.size == 0:
        raise ValueError("Audio file is empty.")
    job.duration_sec = round(float(wav.size / target_sample_rate), 3)
    job.sample_rate = target_sample_rate
    job.channels = 1
    return wav


def _read_clipped_audio_array(
    job: BatchDiarizationJob,
    target_sample_rate: int = TARGET_SAMPLE_RATE,
    max_clip_sec: float = MATCH_SAMPLE_CLIP_SECONDS,
) -> np.ndarray:
    max_clip_sec = max(0.0, float(max_clip_sec))
    try:
        duration_sec, _native_sr, channels = audio_info(job.original_path)
    except Exception:  # noqa: BLE001
        duration_sec = 0.0
        channels = 1

    try:
        import librosa
    except ModuleNotFoundError:
        wav = _read_single_audio_array(job, target_sample_rate=target_sample_rate)
        max_samples = int(round(max_clip_sec * target_sample_rate)) if max_clip_sec > 0 else 0
        return wav[:max_samples] if max_samples > 0 and wav.size > max_samples else wav

    load_kwargs: dict[str, object] = {"sr": target_sample_rate, "mono": True}
    if max_clip_sec > 0:
        load_kwargs["duration"] = max_clip_sec
    wav, _sr = librosa.load(str(job.original_path), **load_kwargs)
    wav = np.asarray(wav, dtype=np.float32).reshape(-1)
    if wav.size == 0:
        raise ValueError("Audio file is empty.")

    actual_duration = duration_sec if duration_sec > 0 else float(wav.size / target_sample_rate)
    job.duration_sec = round(actual_duration, 3)
    job.sample_rate = target_sample_rate
    job.channels = 1
    return wav


def _apply_job_speaker(
    job: BatchDiarizationJob,
    job_turns: list[dict[str, object]],
    issue_turns: list[dict[str, object]] | None = None,
    min_overlap_sec: float = MIN_OVERLAP_SECONDS,
) -> None:
    totals: dict[str, float] = defaultdict(float)
    for turn in job_turns:
        speaker = str(turn["speaker"])
        totals[speaker] += max(0.0, float(turn["endSec"]) - float(turn["startSec"]))

    if not totals:
        job.speaker = job.speaker or BATCH_UNKNOWN_SPEAKER_LABEL
        job.speaker_count = 0
        job.speaker_turns = "[]"
        job.has_overlap = False
        job.overlap_seconds = 0.0
        job.has_multiple_speakers = False
        job.primary_speaker = ""
        job.speaker_issue = ""
        job.status = "failed"
        job.active_stage = "no_speech"
        job.error = "DiariZen did not return speaker turns for this audio."
        return

    primary_speaker = max(totals.items(), key=lambda item: item[1])[0]
    issue_totals: dict[str, float] = defaultdict(float)
    for turn in issue_turns or job_turns:
        speaker = str(turn["speaker"])
        issue_totals[speaker] += max(0.0, float(turn["endSec"]) - float(turn["startSec"]))
    speaker_count = max(len(totals), len(issue_totals))
    overlap = max(_overlap_seconds(job_turns), _overlap_seconds(issue_turns or job_turns))
    has_overlap = overlap >= min_overlap_sec
    has_multiple_speakers = speaker_count >= 2

    if has_overlap:
        job.speaker = BATCH_OVERLAP_LABEL
        job.speaker_issue = "overlap"
    elif has_multiple_speakers:
        job.speaker = BATCH_MULTI_SPEAKER_LABEL
        job.speaker_issue = "multi_speaker"
    else:
        job.speaker = primary_speaker
        job.speaker_issue = ""

    job.speaker_count = speaker_count
    job.speaker_turns = json.dumps(job_turns, ensure_ascii=False)
    job.has_overlap = has_overlap
    job.overlap_seconds = overlap
    job.has_multiple_speakers = has_multiple_speakers
    job.primary_speaker = primary_speaker
    job.status = "completed"
    job.active_stage = "completed"
    job.error = ""


def _overlap_seconds(job_turns: list[dict[str, object]]) -> float:
    total = 0.0
    for index, left in enumerate(job_turns):
        left_speaker = str(left.get("speaker", ""))
        left_start = float(left.get("startSec", 0.0))
        left_end = float(left.get("endSec", 0.0))
        for right in job_turns[index + 1 :]:
            if left_speaker == str(right.get("speaker", "")):
                continue
            overlap = min(left_end, float(right.get("endSec", 0.0))) - max(left_start, float(right.get("startSec", 0.0)))
            if overlap > 0:
                total += overlap
    return round(total, 3)


def _speaker_totals(job_turns: list[dict[str, object]]) -> dict[str, float]:
    totals: dict[str, float] = defaultdict(float)
    for turn in job_turns:
        speaker = str(turn.get("speaker", ""))
        if not speaker:
            continue
        totals[speaker] += max(0.0, float(turn.get("endSec", 0.0)) - float(turn.get("startSec", 0.0)))
    return dict(totals)


def _primary_speaker_from_turns(job_turns: list[dict[str, object]]) -> str:
    totals = _speaker_totals(job_turns)
    if not totals:
        return ""
    return max(totals.items(), key=lambda item: item[1])[0]


def _remap_turn_speakers(job_turns: list[dict[str, object]], speaker_map: dict[str, str]) -> list[dict[str, object]]:
    mapped: list[dict[str, object]] = []
    for turn in job_turns:
        raw_speaker = str(turn.get("speaker", ""))
        mapped.append({**turn, "speaker": speaker_map.get(raw_speaker, raw_speaker)})
    return mapped


def _split_session_turns_raw(
    turns: list[tuple[float, float, str]],
    windows: dict[str, BatchGlobalAudioWindow],
    min_turn_sec: float = 0.01,
) -> dict[str, list[dict[str, object]]]:
    turns_by_key: dict[str, list[dict[str, object]]] = defaultdict(list)
    for start, end, speaker in turns:
        if end <= start:
            continue

        for key, window in windows.items():
            window_start = window.offset_sec
            window_end = window.offset_sec + window.duration_sec
            clipped_start = max(float(start), window_start)
            clipped_end = min(float(end), window_end)
            if clipped_end - clipped_start < min_turn_sec:
                continue

            turns_by_key[key].append(
                {
                    "startSec": round(clipped_start - window_start, 3),
                    "endSec": round(clipped_end - window_start, 3),
                    "speaker": str(speaker),
                }
            )

    for job_turns in turns_by_key.values():
        job_turns.sort(key=lambda turn: (float(turn["startSec"]), float(turn["endSec"]), str(turn["speaker"])))
    return dict(turns_by_key)


class BatchSpeakerClipCache:
    def __init__(self, settings: BatchSpeakerMatchSettings) -> None:
        self.settings = settings
        self._cache: OrderedDict[str, np.ndarray] = OrderedDict()

    def load(self, key: str, job: BatchDiarizationJob) -> BatchSpeakerAudioClip:
        cache_key = self._cache_key(job)
        wav = self._cache.get(cache_key)
        if wav is not None:
            self._cache.move_to_end(cache_key)
        else:
            wav = _read_clipped_audio_array(
                job,
                target_sample_rate=self.settings.target_sample_rate,
                max_clip_sec=self.settings.sample_clip_sec,
            )
            self._remember(cache_key, wav)

        duration_sec = float(wav.size / self.settings.target_sample_rate)
        return BatchSpeakerAudioClip(key=key, job=job, wav=wav, duration_sec=duration_sec)

    def _cache_key(self, job: BatchDiarizationJob) -> str:
        return f"{Path(job.original_path).resolve()}|{self.settings.target_sample_rate}|{self.settings.sample_clip_sec:.3f}"

    def _remember(self, key: str, wav: np.ndarray) -> None:
        limit = max(0, int(self.settings.audio_cache_items))
        if limit <= 0:
            return
        self._cache[key] = wav
        self._cache.move_to_end(key)
        while len(self._cache) > limit:
            self._cache.popitem(last=False)


class SampleMatchingBatchDiarizationStrategy:
    CURRENT_KEY = "__current__"

    def __init__(
        self,
        jobs: list[BatchDiarizationJob],
        diarizer_factory: Callable[[], DiariZenBatchDiarizer],
        work_dir: Path,
        settings: BatchSpeakerMatchSettings,
        on_update: Callable[[], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> None:
        self.jobs = jobs
        self.diarizer_factory = diarizer_factory
        self.work_dir = work_dir
        self.settings = settings
        self.on_update = on_update
        self.should_cancel = should_cancel
        self.clip_cache = BatchSpeakerClipCache(settings)
        self.groups: list[BatchSpeakerGroup] = []
        self._diarizer: DiariZenBatchDiarizer | None = None
        self._session_index = 0
        self._next_speaker_index = 1

    def run(self) -> None:
        for job in self.jobs:
            if job.status == "failed":
                continue
            self._raise_if_cancelled()
            self._process_job(job)
            self._emit()

    def _process_job(self, job: BatchDiarizationJob) -> None:
        job.status = "running"
        job.active_stage = "preparing_diarization"
        job.error = ""
        job.speaker = BATCH_UNKNOWN_SPEAKER_LABEL
        self._emit()

        try:
            current_clip = self.clip_cache.load(self.CURRENT_KEY, job)
        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.active_stage = "failed"
            job.error = f"{type(exc).__name__}: {exc}"
            return

        if not self.groups:
            outcome = self._run_session([current_clip], "seed")
            self._assign_new_or_issue(job, outcome.turns_by_key.get(self.CURRENT_KEY, []))
            return

        skipped_groups: set[str] = set()
        last_current_turns: list[dict[str, object]] = []
        while True:
            initial = self._find_initial_match(current_clip, skipped_groups)
            last_current_turns = initial.current_turns or last_current_turns
            if initial.blocked_by_current_issue:
                self._apply_observed_turns(job, initial.current_turns)
                return
            if initial.group is None:
                break

            verification = self._verify_group_match(current_clip, initial.group)
            last_current_turns = verification.current_turns or last_current_turns
            if verification.blocked_by_current_issue:
                self._apply_observed_turns(job, verification.current_turns)
                return
            if verification.passed:
                self._assign_to_group(job, verification.current_turns or initial.current_turns, initial.group)
                self._recheck_mismatched_samples(current_clip, initial.group, verification.mismatched_clips)
                return

            skipped_groups.add(initial.group.label)
            if len(skipped_groups) >= len([group for group in self.groups if group.jobs]):
                break

        if not last_current_turns:
            outcome = self._run_session([current_clip], "new_speaker")
            last_current_turns = outcome.turns_by_key.get(self.CURRENT_KEY, [])
        self._assign_new_or_issue(job, last_current_turns)

    def _find_initial_match(self, current_clip: BatchSpeakerAudioClip, skipped_groups: set[str]) -> BatchSpeakerInitialMatch:
        last_current_turns: list[dict[str, object]] = []
        for candidates in self._candidate_batches(current_clip, skipped_groups):
            self._set_current_stage(current_clip.job, "diarizing")
            outcome = self._run_session([current_clip, *[candidate.clip for candidate in candidates]], "candidate")
            current_turns = outcome.turns_by_key.get(self.CURRENT_KEY, [])
            last_current_turns = current_turns or last_current_turns
            if self._has_current_blocking_issue(current_turns):
                return BatchSpeakerInitialMatch(None, current_turns, blocked_by_current_issue=True)

            current_primary = outcome.primary_by_key.get(self.CURRENT_KEY, "")
            if not current_primary:
                return BatchSpeakerInitialMatch(None, current_turns, blocked_by_current_issue=True)

            for candidate in candidates:
                sample_primary = outcome.primary_by_key.get(candidate.clip.key, "")
                if sample_primary and sample_primary == current_primary:
                    return BatchSpeakerInitialMatch(candidate.group, current_turns)

        return BatchSpeakerInitialMatch(None, last_current_turns)

    def _verify_group_match(self, current_clip: BatchSpeakerAudioClip, group: BatchSpeakerGroup) -> BatchSpeakerVerification:
        sample_clips = self._verification_sample_clips(current_clip, group)
        if not sample_clips:
            return BatchSpeakerVerification(False, [])

        self._set_current_stage(current_clip.job, "diarizing")
        outcome = self._run_session([current_clip, *sample_clips], "verify")
        current_turns = outcome.turns_by_key.get(self.CURRENT_KEY, [])
        if self._has_current_blocking_issue(current_turns):
            return BatchSpeakerVerification(False, current_turns, outcome=outcome, blocked_by_current_issue=True)

        current_primary = outcome.primary_by_key.get(self.CURRENT_KEY, "")
        matched: list[BatchSpeakerAudioClip] = []
        mismatched: list[BatchSpeakerAudioClip] = []
        for sample_clip in sample_clips:
            sample_primary = outcome.primary_by_key.get(sample_clip.key, "")
            if sample_primary and sample_primary == current_primary:
                matched.append(sample_clip)
            else:
                mismatched.append(sample_clip)

        required = (len(sample_clips) // 2) + 1
        return BatchSpeakerVerification(
            passed=len(matched) >= required,
            current_turns=current_turns,
            mismatched_clips=mismatched,
            outcome=outcome,
        )

    def _recheck_mismatched_samples(
        self,
        current_clip: BatchSpeakerAudioClip,
        group: BatchSpeakerGroup,
        mismatched_clips: list[BatchSpeakerAudioClip],
    ) -> None:
        if not mismatched_clips:
            return

        self._set_current_stage(current_clip.job, "diarizing")
        outcome = self._run_session([current_clip, *mismatched_clips], "recheck")
        current_primary = outcome.primary_by_key.get(self.CURRENT_KEY, "")
        new_groups_by_label: dict[str, BatchSpeakerGroup] = {}

        for sample_clip in mismatched_clips:
            sample_turns = outcome.turns_by_key.get(sample_clip.key, [])
            sample_primary = outcome.primary_by_key.get(sample_clip.key, "")
            if sample_primary and sample_primary == current_primary and not self._has_current_blocking_issue(sample_turns):
                self._assign_to_group(sample_clip.job, sample_turns, group, append_if_missing=False)
                continue

            self._remove_from_group(sample_clip.job, group)
            if self._has_current_blocking_issue(sample_turns):
                self._apply_observed_turns(sample_clip.job, sample_turns)
                continue

            outlier_key = sample_primary or sample_clip.key
            outlier_group = new_groups_by_label.get(outlier_key)
            if outlier_group is None:
                outlier_group = BatchSpeakerGroup(self._new_speaker_label())
                new_groups_by_label[outlier_key] = outlier_group
                self.groups.append(outlier_group)
            self._assign_to_group(sample_clip.job, sample_turns, outlier_group, append_if_missing=True)

        self._drop_empty_groups()
        if current_clip.job.status == "running":
            current_clip.job.status = "completed"
            current_clip.job.active_stage = "completed"
            self._emit()

    def _candidate_batches(
        self,
        current_clip: BatchSpeakerAudioClip,
        skipped_groups: set[str],
    ) -> list[list[BatchSpeakerCandidate]]:
        batches: list[list[BatchSpeakerCandidate]] = []
        current_batch: list[BatchSpeakerCandidate] = []
        for group in [item for item in self.groups if item.label not in skipped_groups and item.jobs]:
            sample_job = self._choose_group_jobs(group, current_clip.job, 1, "candidate")
            if not sample_job:
                continue
            sample_clip = self.clip_cache.load(f"sample:{group.label}:{sample_job[0].item_id}", sample_job[0])
            candidate = BatchSpeakerCandidate(group=group, clip=sample_clip)
            candidate_clips = [current_clip, *[item.clip for item in current_batch], sample_clip]
            if current_batch and self._session_duration(candidate_clips) > self.settings.max_session_sec:
                batches.append(current_batch)
                current_batch = []
                candidate_clips = [current_clip, sample_clip]
            current_batch.append(candidate)
        if current_batch:
            batches.append(current_batch)
        return batches

    def _verification_sample_clips(self, current_clip: BatchSpeakerAudioClip, group: BatchSpeakerGroup) -> list[BatchSpeakerAudioClip]:
        max_count = max(1, int(self.settings.verification_sample_count))
        sample_jobs = self._choose_group_jobs(group, current_clip.job, min(len(group.jobs), max_count * 3), "verify")
        sample_clips: list[BatchSpeakerAudioClip] = []
        for sample_job in sample_jobs:
            if len(sample_clips) >= max_count:
                break
            sample_clip = self.clip_cache.load(f"verify:{group.label}:{sample_job.item_id}", sample_job)
            next_clips = [current_clip, *sample_clips, sample_clip]
            if sample_clips and self._session_duration(next_clips) > self.settings.max_session_sec:
                continue
            sample_clips.append(sample_clip)
        return sample_clips

    def _choose_group_jobs(
        self,
        group: BatchSpeakerGroup,
        current_job: BatchDiarizationJob,
        count: int,
        purpose: str,
    ) -> list[BatchDiarizationJob]:
        candidates = [job for job in group.jobs if job.item_id != current_job.item_id]
        if not candidates:
            return []
        candidates.sort(key=lambda item: (item.item_id, item.file_name, item.original_path))
        rng = random.Random(f"{self.settings.random_seed}|{purpose}|{current_job.item_id}|{group.label}|{len(candidates)}")
        rng.shuffle(candidates)
        return candidates[: max(0, count)]

    def _run_session(self, clips: list[BatchSpeakerAudioClip], purpose: str) -> BatchSpeakerSessionOutcome:
        self._raise_if_cancelled()
        self._session_index += 1
        session_path = self.work_dir / f"batch_qc_speaker_match_{self._session_index:06d}.wav"
        windows = self._write_session_audio(clips, session_path)
        diarizer = self._get_diarizer()
        session_name = f"batch_qc_{purpose}_{self._session_index:06d}"
        turns = diarizer.diarize(session_path, session_name=session_name)
        turns_by_key = _split_session_turns_raw(turns, windows)
        primary_by_key = {key: _primary_speaker_from_turns(job_turns) for key, job_turns in turns_by_key.items()}
        return BatchSpeakerSessionOutcome(turns_by_key=turns_by_key, primary_by_key=primary_by_key)

    def _write_session_audio(self, clips: list[BatchSpeakerAudioClip], output_path: Path) -> dict[str, BatchGlobalAudioWindow]:
        parts: list[np.ndarray] = []
        windows: dict[str, BatchGlobalAudioWindow] = {}
        gap_samples = max(0, int(round(self.settings.session_gap_sec * self.settings.target_sample_rate)))
        offset_samples = 0

        for clip in clips:
            if parts and gap_samples > 0:
                parts.append(np.zeros(gap_samples, dtype=np.float32))
                offset_samples += gap_samples
            windows[clip.key] = BatchGlobalAudioWindow(
                offset_sec=offset_samples / self.settings.target_sample_rate,
                duration_sec=clip.duration_sec,
            )
            parts.append(clip.wav.astype(np.float32))
            offset_samples += clip.wav.size

        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output_path, np.concatenate(parts).astype(np.float32), self.settings.target_sample_rate)
        return windows

    def _session_duration(self, clips: list[BatchSpeakerAudioClip]) -> float:
        if not clips:
            return 0.0
        gap_total = max(0, len(clips) - 1) * self.settings.session_gap_sec
        return sum(clip.duration_sec for clip in clips) + gap_total

    def _assign_new_or_issue(self, job: BatchDiarizationJob, current_turns: list[dict[str, object]]) -> None:
        if self._has_current_blocking_issue(current_turns):
            self._apply_observed_turns(job, current_turns)
            return

        group = BatchSpeakerGroup(self._new_speaker_label())
        self.groups.append(group)
        self._assign_to_group(job, current_turns, group, append_if_missing=True)

    def _assign_to_group(
        self,
        job: BatchDiarizationJob,
        job_turns: list[dict[str, object]],
        group: BatchSpeakerGroup,
        append_if_missing: bool = True,
    ) -> None:
        self._apply_clean_assignment(job, job_turns, group.label)
        if job.status == "completed" and not job.speaker_issue and append_if_missing and job not in group.jobs:
            group.jobs.append(job)

    def _apply_clean_assignment(self, job: BatchDiarizationJob, job_turns: list[dict[str, object]], speaker_label: str) -> None:
        primary = _primary_speaker_from_turns(job_turns)
        mapped_turns = _remap_turn_speakers(job_turns, {primary: speaker_label}) if primary else job_turns
        _apply_job_speaker(job, mapped_turns, min_overlap_sec=self.settings.min_overlap_sec)
        if job.status == "completed" and not job.speaker_issue:
            job.speaker = speaker_label
            job.primary_speaker = speaker_label
            job.speaker_count = 1

    def _apply_observed_turns(self, job: BatchDiarizationJob, job_turns: list[dict[str, object]]) -> None:
        if not job_turns:
            job.speaker = BATCH_UNKNOWN_SPEAKER_LABEL
        _apply_job_speaker(job, job_turns, min_overlap_sec=self.settings.min_overlap_sec)

    def _has_current_blocking_issue(self, job_turns: list[dict[str, object]]) -> bool:
        if not job_turns:
            return True
        if _overlap_seconds(job_turns) >= self.settings.min_overlap_sec:
            return True
        return len(_speaker_totals(job_turns)) >= 2

    def _remove_from_group(self, job: BatchDiarizationJob, group: BatchSpeakerGroup) -> None:
        group.jobs = [item for item in group.jobs if item is not job]

    def _drop_empty_groups(self) -> None:
        self.groups = [group for group in self.groups if group.jobs]

    def _new_speaker_label(self) -> str:
        label = f"speaker_{self._next_speaker_index:03d}"
        self._next_speaker_index += 1
        return label

    def _get_diarizer(self) -> DiariZenBatchDiarizer:
        if self._diarizer is None:
            self._diarizer = self.diarizer_factory()
        return self._diarizer

    def _set_current_stage(self, job: BatchDiarizationJob, stage: str) -> None:
        job.status = "running"
        job.active_stage = stage
        self._emit()

    def _raise_if_cancelled(self) -> None:
        if self.should_cancel and self.should_cancel():
            raise BatchSpeakerDiarizationCancelled("Cancelled by user.")

    def _emit(self) -> None:
        if self.on_update:
            self.on_update()


def _write_manifest(manifest_path: Path, input_folder: str, jobs: list[BatchDiarizationJob], session_status: str) -> None:
    summary = BatchQcExportSummary.from_jobs(jobs)
    payload = {
        "sessionStatus": session_status,
        "inputFolder": input_folder,
        "manifestPath": str(manifest_path.resolve()),
        "summary": summary.to_manifest_dict(),
        "jobs": [job.to_manifest_dict() for job in jobs],
    }
    atomic_write_json(manifest_path, payload)


def _cancel_requested(cancel_file: Path | None) -> bool:
    return bool(cancel_file and cancel_file.exists())


def _mark_cancelled(jobs: list[BatchDiarizationJob]) -> None:
    for job in jobs:
        if job.status in {"queued", "running"}:
            job.status = "failed"
            job.active_stage = "cancelled"
            job.error = "Cancelled by user."
