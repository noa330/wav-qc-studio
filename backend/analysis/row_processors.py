from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..audio_utils import audio_info
from ..clustering import cluster_speaker_embeddings, reduce_file_groups
from .schema import FileAnalysisResult, TaskSelection


def add_error(row: FileAnalysisResult, msg: str) -> None:
    msg = msg.strip()
    if not msg:
        return
    if row.error:
        row.error += " | " + msg
    else:
        row.error = msg


def build_output_rows(
    cfg: dict[str, Any],
    tasks: TaskSelection,
    results: list[FileAnalysisResult],
    all_local_speaker_items: list[dict[str, object]],
) -> list[dict[str, object]]:
    rows = [deepcopy(r) for r in results]
    if tasks.speaker and all_local_speaker_items:
        threshold = float(cfg["speaker"].get("cluster_distance_threshold", 0.30))
        id_to_group = cluster_speaker_embeddings(all_local_speaker_items, distance_threshold=threshold)
        file_groups = reduce_file_groups(all_local_speaker_items, id_to_group)
        for row in rows:
            row.speaker_groups = file_groups.get(row.absolute_path, "")
    return [r.to_row() for r in rows]


def populate_audio_info(row: FileAnalysisResult, wav_path: str) -> None:
    duration_sec, sample_rate, channels = audio_info(wav_path)
    row.duration_sec = round(duration_sec, 3)
    row.sample_rate = sample_rate
    row.channels = channels


def process_pronunciation(row: FileAnalysisResult, tasks: TaskSelection, pronunciation_analyzer, wav_path: str) -> None:
    if tasks.pron and pronunciation_analyzer is None:
        add_error(row, "[pronunciation] analyzer is unavailable. Check the Whisper model, GPU, or local model cache.")
        return
    if pronunciation_analyzer is None:
        return

    try:
        pron_res = pronunciation_analyzer.score(wav_path)
        row.transcript = pron_res.get("transcript", "")
        row.language = pron_res.get("language", "")
        row.pronunciation_score_1to5 = pron_res.get("pronunciation_score_1to5")
        row.pronunciation_flag_bad = pron_res.get("pronunciation_flag_bad", "")
    except Exception as e:  # noqa: BLE001
        add_error(row, f"[pronunciation] {type(e).__name__}: {e}")


def process_noise(row: FileAnalysisResult, tasks: TaskSelection, noise_scorer, wav_path: str) -> None:
    if tasks.noise and noise_scorer is None:
        add_error(row, "[noise] analyzer is unavailable. Check DNSMOS or onnxruntime-gpu installation.")
        return
    if noise_scorer is None:
        return

    try:
        noise_res = noise_scorer.score(wav_path)
        row.noise_bak = noise_res.get("noise_bak")
        row.noise_sig = noise_res.get("noise_sig")
        row.noise_ovrl = noise_res.get("noise_ovrl")
        row.noise_p808_mos = noise_res.get("noise_p808_mos")
    except Exception as e:  # noqa: BLE001
        add_error(row, f"[noise] {type(e).__name__}: {e}")


def process_speaker(row: FileAnalysisResult, tasks: TaskSelection, speaker_analyzer, wav_path: str, all_local_speaker_items: list[dict[str, object]]) -> None:
    if tasks.speaker and speaker_analyzer is None:
        add_error(row, "[speaker] analyzer is unavailable. Check NeMo, GPU, or local model cache.")
        return
    if speaker_analyzer is None:
        return

    try:
        spk_res = speaker_analyzer.analyze(wav_path)
        if tasks.speaker:
            row.speaker_count = spk_res.get("speaker_count")
            row._speaker_local_items = spk_res.get("_speaker_local_items", [])
            all_local_speaker_items.extend(row._speaker_local_items)
        warning_msg = str(spk_res.get("_warning", "")).strip()
        if warning_msg:
            add_error(row, f"[speaker] {warning_msg}")
    except Exception as e:  # noqa: BLE001
        add_error(row, f"[speaker] {type(e).__name__}: {e}")
