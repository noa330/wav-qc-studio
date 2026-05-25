from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from .errors import ToolError
from .io import read_text_any


LogFn = Callable[[str], None]


def parse_gsv_list(list_path: Path) -> list[tuple[str, str, str, str]]:
    text = read_text_any(list_path)
    rows: list[tuple[str, str, str, str]] = []
    for idx, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        parts = line.split("|", 3)
        if len(parts) != 4:
            raise ToolError(f"Invalid list line {idx}: expected wav|speaker|language|text")
        wav, speaker, lang, script = [part.strip() for part in parts]
        if not Path(wav).exists():
            raise ToolError(f"Audio file is missing on line {idx}: {wav}")
        rows.append((wav, speaker or "speaker_unknown", lang.lower(), script))
    if not rows:
        raise ToolError(f"No usable rows in {list_path}")
    return rows


def normalize_gsv_list_file(list_path: Path, exp_name: str, work_dir: Path, log: LogFn) -> Path:
    rows = parse_gsv_list(list_path)
    target = work_dir / "gpt_sovits" / exp_name / "input.list"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(f"{wav}|{speaker}|{lang}|{script}" for wav, speaker, lang, script in rows) + "\n", encoding="utf-8")
    log(f"Prepared GPT-SoVITS list: {target} ({len(rows)} rows)")
    return target


def infer_gsv_wav_dir(list_path: Path) -> str:
    rows = parse_gsv_list(list_path)
    parents = {str(Path(row[0]).parent) for row in rows}
    return next(iter(parents)) if len(parents) == 1 else ""


def write_omnivoice_jsonl_from_gsv(gsv_list: Path, exp_name: str, work_dir: Path, log: LogFn) -> Path:
    rows = parse_gsv_list(gsv_list)
    out = work_dir / "omnivoice" / exp_name / "input.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for idx, (wav, speaker, lang, text) in enumerate(rows, start=1):
            sample_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"{speaker}_{Path(wav).stem}_{idx:06d}")
            handle.write(
                json.dumps(
                    {
                        "id": sample_id,
                        "audio_path": wav,
                        "text": text,
                        "language_id": lang,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    log(f"Prepared OmniVoice JSONL: {out} ({len(rows)} rows)")
    return out


def resolve_input_file(path: Path, preferred_name: str = "train.jsonl") -> Path:
    if path.is_dir():
        candidate = path / preferred_name
        if candidate.exists():
            return candidate
        files = sorted(path.glob("*.jsonl")) + sorted(path.glob("*.json")) + sorted(path.glob("*.list"))
        if files:
            return files[0]
    return path


def normalize_omnivoice_jsonl_file(jsonl_path: Path, exp_name: str, work_dir: Path, log: LogFn) -> Path:
    jsonl_path = resolve_input_file(jsonl_path)
    source_text = read_text_any(jsonl_path)
    rows: list[dict[str, str]] = []
    wav_dir = jsonl_path.parent.parent / "wavs"
    wav_files = sorted(wav_dir.glob("*.wav")) if wav_dir.exists() else []
    for idx, raw in enumerate(source_text.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ToolError(f"Invalid JSONL line {idx}: {exc}") from exc
        sample_id = str(item.get("id") or idx)
        audio_path = Path(str(item.get("audio_path") or ""))
        if not audio_path.exists():
            numeric = re.sub(r"\D", "", sample_id)
            fallback = wav_dir / f"{int(numeric):06d}.wav" if numeric else None
            if fallback and fallback.exists():
                audio_path = fallback
            elif idx <= len(wav_files):
                audio_path = wav_files[idx - 1]
            else:
                raise ToolError(f"Audio path is missing for OmniVoice JSONL line {idx}: {item.get('audio_path')}")
        rows.append(
            {
                "id": sample_id,
                "audio_path": str(audio_path),
                "text": str(item.get("text") or ""),
                "language_id": str(item.get("language_id") or item.get("language") or "ko"),
            }
        )
    if not rows:
        raise ToolError(f"No usable rows in {jsonl_path}")
    out = work_dir / "omnivoice" / exp_name / "input.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    log(f"Prepared OmniVoice JSONL: {out} ({len(rows)} rows)")
    return out


def prepare_omnivoice_input_file(input_path: Path, exp_name: str, work_dir: Path, log: LogFn) -> Path:
    input_path = resolve_input_file(input_path)
    suffix = input_path.suffix.lower()
    if suffix in {".jsonl", ".json"}:
        return normalize_omnivoice_jsonl_file(input_path, exp_name, work_dir, log)
    return write_omnivoice_jsonl_from_gsv(input_path, exp_name, work_dir, log)
