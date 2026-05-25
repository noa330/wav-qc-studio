from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from ..runtime import configure_model_cache_env, get_runtime_device_str, model_cache_root

Progress = Callable[[str], None] | None

STATUS_ALIGNED = "aligned"
STATUS_REVIEW = "review"
STATUS_MISSING = "missing"
STATUS_UNALIGNABLE = "unalignable"
MISSING_ALIGNMENT_SCORE_THRESHOLD = 0.20
DEFAULT_WORD_ALIGN_LANGUAGE = "kor"

LANGUAGE_ALIASES = {
    "auto": "kor",
    "detect": "kor",
    "ko": "kor",
    "kor": "kor",
    "korean": "kor",
    "ja": "jpn",
    "jpn": "jpn",
    "japanese": "jpn",
    "zh": "zho",
    "zho": "zho",
    "chi": "zho",
    "cmn": "cmn",
    "chinese": "zho",
    "en": "eng",
    "eng": "eng",
    "english": "eng",
    "fr": "fra",
    "fra": "fra",
    "fre": "fra",
    "french": "fra",
    "de": "deu",
    "deu": "deu",
    "ger": "deu",
    "german": "deu",
    "es": "spa",
    "spa": "spa",
    "spanish": "spa",
    "it": "ita",
    "ita": "ita",
    "italian": "ita",
}

_TOKEN_RE = re.compile(r"[a-z']+")
_APOSTROPHES = str.maketrans(
    {
        "\u2019": "'",
        "\u2018": "'",
        "`": "'",
        "\u00b4": "'",
        "\u02bc": "'",
        "\uff07": "'",
    }
)


@dataclass(slots=True)
class WordAlignment:
    index: int
    original: str
    normalized: str
    start: float | None
    end: float | None
    duration: float | None
    score: float | None
    status: str
    note: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class WordAlignmentTuning:
    low_score_threshold: float = 0.72
    missing_score_threshold: float = MISSING_ALIGNMENT_SCORE_THRESHOLD

    @classmethod
    def from_config(cls, cfg: dict[str, Any]) -> "WordAlignmentTuning":
        return cls(
            low_score_threshold=_bounded_float(cfg.get("low_score_threshold"), 0.72, 0.1, 0.95),
            missing_score_threshold=_bounded_float(
                cfg.get("missing_score_threshold"),
                MISSING_ALIGNMENT_SCORE_THRESHOLD,
                0.02,
                0.8,
            ),
        )


@dataclass(slots=True)
class AlignmentReport:
    audio_path: str
    transcript_word_count: int
    aligned_word_count: int
    duration_sec: float
    model: str
    device: str
    language_code: str
    low_score_threshold: float
    words: list[WordAlignment]
    warnings: list[str]

    def to_manifest_payload(self) -> dict[str, object]:
        low_score_words = [
            word
            for word in self.words
            if word.start is None
            or word.end is None
            or word.status != STATUS_ALIGNED
            or (word.score is not None and word.score < self.low_score_threshold)
        ]
        return {
            "alignmentWords": [word.to_dict() for word in self.words],
            "alignmentWarnings": self.warnings,
            "alignmentSummary": {
                "wordCount": self.transcript_word_count,
                "alignedWordCount": self.aligned_word_count,
                "lowScoreWordCount": len(low_score_words),
                "durationSec": self.duration_sec,
                "languageCode": self.language_code,
                "lowScoreThreshold": self.low_score_threshold,
                "model": self.model,
                "device": self.device,
            },
        }


class Normalizer:
    def __init__(self, language_code: str, progress: Progress = None):
        self.language_code = language_code.strip() or DEFAULT_WORD_ALIGN_LANGUAGE
        self.progress = progress
        self._uroman = None
        try:
            import uroman as ur

            self._uroman = ur.Uroman()
        except Exception as exc:  # noqa: BLE001
            if progress:
                progress(f"[word align] uroman load failed: {exc}; using raw text normalization.")

    def normalize_word(self, word: str) -> tuple[str, str]:
        raw = word.translate(_APOSTROPHES)
        note_parts: list[str] = []
        if self._uroman is not None:
            try:
                raw = self._uroman.romanize_string(raw, lcode=self.language_code)
            except TypeError:
                raw = self._uroman.romanize_string(raw)
            except Exception as exc:  # noqa: BLE001
                note_parts.append(f"romanization failed: {exc}")

        lowered = raw.lower().translate(_APOSTROPHES)
        pieces = _TOKEN_RE.findall(lowered)
        normalized = "".join(pieces)
        dropped = re.sub(r"[a-z'\s]+", "", lowered)
        if dropped:
            note_parts.append("unsupported characters removed")
        if not normalized:
            note_parts.append("not convertible to MMS_FA tokens")
        return normalized, "; ".join(note_parts)


class BatchWordAligner:
    """PyTorch/torchaudio MMS_FA word timeline builder for Script transcripts."""

    def __init__(self, cfg: dict[str, Any], progress: Progress = print) -> None:
        align_cfg = _read_alignment_config(cfg)
        self.language_code = _normalize_align_language(align_cfg.get("language_code", DEFAULT_WORD_ALIGN_LANGUAGE))
        self.device_choice = str(align_cfg.get("device", "auto") or "auto")
        self.tuning = WordAlignmentTuning.from_config(align_cfg)
        self.low_score_threshold = self.tuning.low_score_threshold
        self.progress = progress
        self._torch = None
        self._torchaudio = None
        self._bundle = None
        self._model = None
        self._tokenizer = None
        self._aligner = None
        self._device = None

    def align(self, audio_path: str | Path, transcript_text: str) -> AlignmentReport:
        transcript_words = split_transcript(transcript_text)
        if not transcript_words:
            return AlignmentReport(
                audio_path=str(audio_path),
                transcript_word_count=0,
                aligned_word_count=0,
                duration_sec=0.0,
                model="torchaudio.pipelines.MMS_FA",
                device=self.device_label,
                language_code=self.language_code,
                low_score_threshold=self.low_score_threshold,
                words=[],
                warnings=["Transcript is empty; WordAlign was skipped."],
            )

        self._ensure_model_loaded()
        assert self._torch is not None
        assert self._torchaudio is not None
        assert self._bundle is not None
        assert self._model is not None
        assert self._tokenizer is not None
        assert self._aligner is not None
        assert self._device is not None

        audio_path = Path(audio_path)
        log = self.progress
        if log:
            log(f"[word align] normalizing transcript - {audio_path.name} - language={self.language_code}")

        normalizer = Normalizer(language_code=self.language_code, progress=log)
        normalized: list[tuple[int, str, str, str]] = []
        initial_words: list[WordAlignment] = []
        for index, word in enumerate(transcript_words, start=1):
            norm, note = normalizer.normalize_word(word)
            if norm:
                normalized.append((index, word, norm, note))
            else:
                initial_words.append(
                    WordAlignment(
                        index,
                        word,
                        norm,
                        None,
                        None,
                        None,
                        None,
                        STATUS_UNALIGNABLE,
                        note or "no token remains after normalization",
                    )
                )

        if not normalized:
            raise ValueError("MMS_FA could not read any normalized tokens. Check the WordAlign language setting and transcript text.")

        if log:
            log(f"[word align] loading audio - {audio_path.name}")
        waveform, sample_rate = self._torchaudio.load(str(audio_path))
        if waveform.size(0) > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sample_rate != self._bundle.sample_rate:
            waveform = self._torchaudio.functional.resample(waveform, sample_rate, self._bundle.sample_rate)
            sample_rate = self._bundle.sample_rate
        duration_sec = waveform.size(1) / sample_rate

        align_entries: list[tuple[str, tuple[int, str, str, str] | None, str]] = [("star", None, "*")]
        for item in normalized:
            align_entries.append(("word", item, item[2]))
            align_entries.append(("star", None, "*"))
        align_text = [entry[2] for entry in align_entries]

        if log:
            log(f"[word align] running torchaudio MMS_FA - {len(normalized)} words - {self.device_label}")
        with self._torch.inference_mode():
            emission, _ = self._model(waveform.to(self._device))
        tokenized_text = self._tokenizer(align_text)
        token_spans = [list(spans) for spans in self._aligner(emission[0], tokenized_text)]

        frame_to_sec = waveform.size(1) / emission.size(1) / sample_rate
        aligned_by_index: dict[int, WordAlignment] = {}

        for (entry_kind, item, _entry_text), spans in zip(align_entries, token_spans):
            if entry_kind == "star":
                continue

            assert item is not None
            index, original, normalized_word, note = item
            aligned_by_index[index] = _word_alignment_from_spans(
                index=index,
                original=original,
                normalized=normalized_word,
                note=note,
                spans=spans,
                frame_to_sec=frame_to_sec,
                low_score_threshold=self.low_score_threshold,
                missing_score_threshold=self.tuning.missing_score_threshold,
            )

        initial_by_index = {word.index: word for word in initial_words}
        words = [aligned_by_index.get(index) or initial_by_index[index] for index in range(1, len(transcript_words) + 1)]

        warnings = [
            "WordAlign uses PyTorch/torchaudio MMS_FA Wav2Vec2FABundle.",
            "MMS_FA aligns normalized/romanized text through the official bundle tokenizer and aligner.",
        ]
        if log:
            log(f"[word align] done - torchaudio MMS_FA - aligned={sum(1 for word in words if word.start is not None)}/{len(words)}")

        return AlignmentReport(
            audio_path=str(audio_path),
            transcript_word_count=len(transcript_words),
            aligned_word_count=sum(1 for word in words if word.start is not None),
            duration_sec=round(duration_sec, 3),
            model="torchaudio.pipelines.MMS_FA",
            device=self.device_label,
            language_code=self.language_code,
            low_score_threshold=self.low_score_threshold,
            words=words,
            warnings=warnings,
        )

    @property
    def device_label(self) -> str:
        return str(self._device) if self._device is not None else get_runtime_device_str()

    def _ensure_model_loaded(self) -> None:
        if self._model is not None:
            return

        configure_model_cache_env()
        root = model_cache_root()
        os.environ.setdefault("TORCH_HOME", str(root / "torch"))
        os.environ.setdefault("HF_HOME", str(root / "huggingface"))

        import torch
        import torchaudio
        from torchaudio.pipelines import MMS_FA as bundle

        requested_device = self.device_choice.lower().strip()
        if requested_device == "cuda":
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        elif requested_device == "cpu":
            device = torch.device("cpu")
        else:
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        if self.progress:
            self.progress(f"[model loading] PyTorch torchaudio MMS_FA WordAlign - device={device}")
        try:
            model = bundle.get_model(with_star=True, dl_kwargs={"model_dir": str(root / "torch" / "mms_fa")})
        except TypeError:
            try:
                model = bundle.get_model(with_star=True)
            except TypeError:
                model = bundle.get_model()
        model.to(device).eval()

        self._torch = torch
        self._torchaudio = torchaudio
        self._bundle = bundle
        self._model = model
        self._tokenizer = bundle.get_tokenizer()
        self._aligner = bundle.get_aligner()
        self._device = device
        if self.progress:
            self.progress("[model loading complete] PyTorch torchaudio MMS_FA WordAlign ready")


def split_transcript(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"\s+", text.strip()) if part.strip()]


def _word_alignment_from_spans(
    *,
    index: int,
    original: str,
    normalized: str,
    note: str,
    spans: Iterable[object],
    frame_to_sec: float,
    low_score_threshold: float,
    missing_score_threshold: float,
) -> WordAlignment:
    spans = list(spans)
    if not spans:
        return WordAlignment(index, original, normalized, None, None, None, None, STATUS_MISSING, note or "no alignable token span")

    start_frame, end_frame = _span_frame_bounds(spans)
    start = start_frame * frame_to_sec
    end = end_frame * frame_to_sec
    duration = max(0.0, end - start)
    score, low_token_score = _span_score_stats(spans)
    char_duration = duration / max(1, len(normalized))
    status = STATUS_ALIGNED
    notes = [note] if note else []

    if score < missing_score_threshold or char_duration < 0.012:
        status = STATUS_MISSING
        notes.append(f"score is too low or span is too short; {char_duration:.3f}s per character")
    elif score < low_score_threshold:
        status = STATUS_REVIEW
        notes.append(f"alignment score below threshold {low_score_threshold:.2f}")

    if low_token_score < 0.08 and score < low_score_threshold + 0.06:
        if status == STATUS_ALIGNED:
            status = STATUS_REVIEW
        notes.append(f"weak character score: {low_token_score:.3f}")

    long_span_threshold = min(2.2, max(0.75, len(normalized) * 0.18 + 0.25))
    if duration > long_span_threshold:
        if status == STATUS_ALIGNED:
            status = STATUS_REVIEW
        notes.append(f"word span is unusually long; threshold {long_span_threshold:.2f}s")

    return WordAlignment(
        index=index,
        original=original,
        normalized=normalized,
        start=round(start, 3),
        end=round(end, 3),
        duration=round(duration, 3),
        score=round(score, 4),
        status=status,
        note="; ".join(part for part in notes if part),
    )


def _span_frame_bounds(spans: list[object]) -> tuple[float, float]:
    return float(getattr(spans[0], "start")), float(getattr(spans[-1], "end"))


def _span_score_stats(spans: Iterable[object]) -> tuple[float, float]:
    scores: list[float] = []
    for span in spans:
        span_len = max(1, int(getattr(span, "end")) - int(getattr(span, "start")))
        scores.extend([float(getattr(span, "score"))] * span_len)
    if not scores:
        return 0.0, 0.0
    scores.sort()
    mean_score = sum(scores) / len(scores)
    low_score = scores[max(0, int(len(scores) * 0.20) - 1)]
    return mean_score, low_score


def _normalize_align_language(value: object) -> str:
    language = str(value or "").strip().lower().replace("_", "-")
    if not language:
        return DEFAULT_WORD_ALIGN_LANGUAGE
    language = LANGUAGE_ALIASES.get(language, language)
    if "-" in language:
        language = language.split("-", 1)[0]
    language = LANGUAGE_ALIASES.get(language, language)
    return language or DEFAULT_WORD_ALIGN_LANGUAGE


def _read_alignment_config(cfg: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(cfg, dict):
        return {}
    section = cfg.get("word_alignment")
    return section if isinstance(section, dict) else {}


def _bounded_float(value: object, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return min(maximum, max(minimum, parsed))
