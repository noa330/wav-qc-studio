from __future__ import annotations

from pathlib import Path

from ..analyzers import KoreanPronunciationAnalyzer, NoiseScorer, SpeakerAnalyzer
from ..audio_utils import discover_audio_files
from ..console_ui import LiveConsoleLine, format_finished_line, format_progress_line
from ..manifest_io import atomic_write_json
from ..runtime import ensure_runtime_ready, get_runtime_summary, load_config, merge_config_overrides
from .row_processors import (
    add_error,
    build_output_rows,
    populate_audio_info,
    process_noise,
    process_pronunciation,
    process_speaker,
)
from .schema import FileAnalysisResult, TaskSelection


PARTIAL_FLUSH_EVERY = 1


class AnalysisEngine:
    def __init__(self, tasks: TaskSelection, config_overrides: dict[str, dict[str, object]] | None = None) -> None:
        self.tasks = tasks.normalize()
        self.cfg = load_config()
        if config_overrides:
            merge_config_overrides(self.cfg, config_overrides)
        ensure_runtime_ready()
        self.init_warnings: list[str] = []
        self.runtime_summary = get_runtime_summary()

        self.pron = self._safe_init(
            enabled=self.tasks.pron,
            factory=lambda: KoreanPronunciationAnalyzer(self.cfg, language=self.tasks.transcription_language),
            name="pronunciation",
        )
        self.noise = self._safe_init(
            enabled=self.tasks.noise,
            factory=lambda: NoiseScorer(self.cfg),
            name="noise",
        )
        self.speaker = None

    def _safe_init(self, enabled: bool, factory, name: str):
        if not enabled:
            return None
        try:
            return factory()
        except Exception as exc:  # noqa: BLE001
            msg = f"[{name}] init failed: {type(exc).__name__}: {exc}"
            self.init_warnings.append(msg)
            print(f"[model init failed] {msg}")
            return None

    def _build_result_rows(
        self,
        results: list[FileAnalysisResult],
        all_local_speaker_items: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        return build_output_rows(self.cfg, self.tasks, results, all_local_speaker_items)

    def _get_speaker_analyzer(self):
        if not self.tasks.speaker:
            return None
        if self.speaker is None:
            self.speaker = self._safe_init(
                enabled=True,
                factory=lambda: SpeakerAnalyzer(self.cfg, method=self.tasks.speaker_method),
                name="speaker",
            )
        return self.speaker

    def analyze_folder(
        self,
        input_dir: str,
        recursive: bool = True,
        manifest_path: str | None = None,
        cancel_file: str | None = None,
    ) -> list[dict[str, object]]:
        files = discover_audio_files(input_dir, recursive=recursive)
        if not files:
            raise FileNotFoundError(f"No WAV files found in input folder: {input_dir}")

        results: list[FileAnalysisResult] = []
        all_local_speaker_items: list[dict[str, object]] = []
        total_files = len(files)
        failed_files = 0
        self._write_progress_manifest(manifest_path, input_dir, total_files, 0, 0, "running", [])

        progress_line = LiveConsoleLine()
        for index, wav_path in enumerate(files, start=1):
            if self._cancel_requested(cancel_file):
                rows = self._build_result_rows(results, all_local_speaker_items)
                self._write_progress_manifest(manifest_path, input_dir, total_files, len(results), failed_files, "failed", rows)
                raise KeyboardInterrupt("Cancelled by user")

            progress_line.update(format_progress_line("running", index, total_files, wav_path.name, stage="analysis", completed=index - 1))
            abs_wav_path = str(wav_path.resolve())
            row = FileAnalysisResult(file_name=wav_path.name, absolute_path=abs_wav_path)

            try:
                populate_audio_info(row, wav_path)
            except Exception as exc:  # noqa: BLE001
                add_error(row, f"[audio-info] {type(exc).__name__}: {exc}")
                failed_files += 1
                results.append(row)
                self._flush_progress_if_needed(
                    manifest_path,
                    input_dir,
                    total_files,
                    failed_files,
                    results,
                    all_local_speaker_items,
                    index,
                    wav_path.name,
                    progress_line,
                )
                continue

            process_pronunciation(row, self.tasks, self.pron, abs_wav_path)
            self._raise_if_cancelled(cancel_file, manifest_path, input_dir, total_files, failed_files, results, all_local_speaker_items)
            process_noise(row, self.tasks, self.noise, abs_wav_path)
            self._raise_if_cancelled(cancel_file, manifest_path, input_dir, total_files, failed_files, results, all_local_speaker_items)
            process_speaker(row, self.tasks, self._get_speaker_analyzer(), abs_wav_path, all_local_speaker_items)

            results.append(row)
            self._flush_progress_if_needed(
                manifest_path,
                input_dir,
                total_files,
                failed_files,
                results,
                all_local_speaker_items,
                index,
                wav_path.name,
                progress_line,
            )

        progress_line.finish(format_finished_line(total_files, failed=failed_files))
        rows = self._build_result_rows(results, all_local_speaker_items)
        self._write_progress_manifest(manifest_path, input_dir, total_files, len(results), failed_files, "completed", rows)
        return rows

    def _flush_progress_if_needed(
        self,
        manifest_path: str | None,
        input_dir: str,
        total_files: int,
        failed_files: int,
        results: list[FileAnalysisResult],
        all_local_speaker_items: list[dict[str, object]],
        index: int,
        file_name: str,
        progress_line: LiveConsoleLine,
    ) -> None:
        if len(results) != 1 and index % PARTIAL_FLUSH_EVERY != 0 and index != total_files:
            return

        rows = self._build_result_rows(results, all_local_speaker_items)
        self._write_progress_manifest(manifest_path, input_dir, total_files, len(results), failed_files, "running", rows)
        progress_line.update(format_progress_line("running", index, total_files, file_name, stage="analysis", detail=f"rows={len(results)}", completed=index))

    def _raise_if_cancelled(
        self,
        cancel_file: str | None,
        manifest_path: str | None,
        input_dir: str,
        total_files: int,
        failed_files: int,
        results: list[FileAnalysisResult],
        all_local_speaker_items: list[dict[str, object]],
    ) -> None:
        if not self._cancel_requested(cancel_file):
            return

        rows = self._build_result_rows(results, all_local_speaker_items)
        self._write_progress_manifest(manifest_path, input_dir, total_files, len(results), failed_files, "failed", rows)
        raise KeyboardInterrupt("Cancelled by user")

    def _write_progress_manifest(
        self,
        manifest_path: str | None,
        input_dir: str,
        total_files: int,
        completed_files: int,
        failed_files: int,
        session_status: str,
        rows: list[dict[str, object]],
    ) -> None:
        if not manifest_path:
            return

        finished = max(0, min(total_files, completed_files))
        payload = {
            "sessionStatus": session_status,
            "inputFolder": str(Path(input_dir).resolve()),
            "manifestPath": str(Path(manifest_path).resolve()),
            "summary": {
                "totalFiles": total_files,
                "queued": max(0, total_files - finished),
                "running": 1 if session_status == "running" and finished < total_files else 0,
                "completed": max(0, completed_files - failed_files),
                "failed": failed_files,
                "progress": (finished / total_files) if total_files else 0.0,
            },
            "rows": rows,
        }
        out_path = Path(manifest_path)
        atomic_write_json(out_path, payload)

    def _cancel_requested(self, cancel_file: str | None) -> bool:
        return bool(cancel_file and Path(cancel_file).exists())
