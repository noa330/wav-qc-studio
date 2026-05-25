from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from backend.batch_qc.diarization import run_batch_speaker_diarization
    from backend.batch_qc.exporter import export_dataset
    from backend.batch_qc.manifest import write_manifest
    from backend.batch_qc.schema import BATCH_UNKNOWN_SPEAKER_LABEL, BatchQcExportJob, BatchQcExportSession, BatchQcExportSettings
    from backend.batch_qc.transcription import run_batch_transcription
    from backend.cli_logging import close_log_tee, install_log_tee
    from backend.console_ui import LiveConsoleLine, format_finished_line, format_progress_line, prepare_for_regular_output, print_banner, print_kv, print_section
    from backend.runtime import model_cache_root
else:
    from .diarization import run_batch_speaker_diarization
    from .exporter import export_dataset
    from .manifest import write_manifest
    from .schema import BATCH_UNKNOWN_SPEAKER_LABEL, BatchQcExportJob, BatchQcExportSession, BatchQcExportSettings
    from .transcription import run_batch_transcription
    from ..cli_logging import close_log_tee, install_log_tee
    from ..console_ui import LiveConsoleLine, format_finished_line, format_progress_line, prepare_for_regular_output, print_banner, print_kv, print_section
    from ..runtime import model_cache_root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Script dataset exporter")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("export", help="Export edited Script rows as a training dataset")
    p.add_argument("--request", required=True, help="Script export request JSON")
    p.add_argument("--output-dir", required=True, help="Output directory")
    p.add_argument("--manifest", required=True, help="Session manifest path")
    p.add_argument("--log", required=False, help="Log file path")

    d = sub.add_parser("diarize", help="Separate Script speakers with DiariZen")
    d.add_argument("--request", required=True, help="Script speaker diarization request JSON")
    d.add_argument("--manifest", required=True, help="Diarization manifest path")
    d.add_argument("--log", required=False, help="Log file path")
    d.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    add_batch_model_override_args(d)

    t = sub.add_parser("transcribe", help="Create Script rows with Whisper transcription and PyTorch torchaudio MMS_FA word alignment")
    t.add_argument("--input", required=True, help="Input WAV folder")
    t.add_argument("--manifest", required=True, help="Script manifest path")
    t.add_argument("--log", required=False, help="Log file path")
    t.add_argument("--language", default="auto", help="Whisper transcription language code, or auto")
    t.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    add_batch_model_override_args(t)

    r = sub.add_parser("run", help="Create Script rows with transcription and PyTorch torchaudio MMS_FA word alignment")
    r.add_argument("--input", required=True, help="Input WAV folder")
    r.add_argument("--manifest", required=True, help="Script manifest path")
    r.add_argument("--log", required=False, help="Log file path")
    r.add_argument("--language", default="auto", help="Whisper transcription language code, or auto")
    r.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    add_batch_model_override_args(r)
    return parser


def load_request(path: Path) -> tuple[str, BatchQcExportSettings, list[BatchQcExportJob]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    settings = BatchQcExportSettings(str(payload.get("exportFormat", "gsv"))).normalize()
    input_folder = str(payload.get("inputFolder", "") or "")
    rows = payload.get("jobs", [])
    jobs: list[BatchQcExportJob] = []
    for index, item in enumerate(rows, start=1):
        original_path = str(item.get("originalPath", "") or "")
        file_name = str(item.get("fileName", "") or Path(original_path).name)
        jobs.append(
            BatchQcExportJob(
                item_id=str(item.get("id", "") or f"{index:06d}"),
                file_name=file_name,
                original_path=original_path,
                transcript=str(item.get("transcript", "") or ""),
                language=str(item.get("language", "") or ""),
                speaker=str(item.get("speaker", "") or BATCH_UNKNOWN_SPEAKER_LABEL),
            )
        )
    return input_folder, settings, jobs


def cmd_export(args: argparse.Namespace) -> int:
    log_path = args.log or str(Path(args.output_dir) / f"batch_qc_export_{datetime.now():%Y%m%d_%H%M%S}.log")
    install_log_tee(
        log_path,
        prepare_output=prepare_for_regular_output,
        include_run_markers=True,
    )

    request_path = Path(args.request).resolve()
    output_root = Path(args.output_dir).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    input_folder, settings, jobs = load_request(request_path)
    if not jobs:
        raise ValueError("No Script rows were provided for export.")

    dataset_dir = output_root / f"{settings.export_format}_dataset_{datetime.now():%Y%m%d_%H%M%S}"
    dataset_dir.mkdir(parents=True, exist_ok=True)

    session = BatchQcExportSession(
        input_folder=input_folder,
        output_dir=str(output_root),
        dataset_dir=str(dataset_dir),
        manifest_path=str(Path(args.manifest).resolve()),
        settings=settings,
        jobs=jobs,
        session_status="running",
    )
    write_manifest(session)

    print_banner("스크립트 데이터셋 내보내기 실행")
    print_kv("Python", sys.executable)
    print_kv("작업 폴더", Path.cwd())
    print_kv("Model cache", model_cache_root())
    print_section("실행 정보")
    print_kv("요청 파일", request_path)
    print_kv("입력 폴더", input_folder)
    print_kv("출력 폴더", output_root)
    print_kv("산출물 폴더", dataset_dir)
    print_kv("매니페스트", session.manifest_path)
    print_kv("내보내기 양식", settings.format_label())
    print_kv("행 수", len(jobs))

    progress_line = LiveConsoleLine()
    any_failed = False

    for index, job in enumerate(jobs, start=1):
        try:
            progress_line.update(format_progress_line("running", index, len(jobs), job.file_name, stage=job.active_stage, completed=index - 1))
            write_manifest(session)
        except Exception:
            pass

    try:
        print_section("데이터셋 작성")
        completed = export_dataset(jobs, dataset_dir, settings, print)
        progress_line.finish(format_finished_line(len(jobs), failed=0 if completed == len(jobs) else len(jobs) - completed))
    except Exception as exc:  # noqa: BLE001
        any_failed = True
        for job in jobs:
            if job.status != "completed":
                job.status = "failed"
                job.active_stage = "failed"
                job.error = f"{type(exc).__name__}: {exc}"
        progress_line.finish(format_finished_line(len(jobs), failed=len([job for job in jobs if job.status == "failed"])))
        print(f"[내보내기 실패] {type(exc).__name__}: {exc}")
        traceback.print_exc()
    finally:
        session.session_status = "completed_with_errors" if any_failed else "completed"
        write_manifest(session)

    print_section("스크립트 데이터셋 내보내기 종료")
    print_kv("전체 파일 수", len(jobs))
    print_kv("실패 포함 여부", "예" if any_failed else "아니오")
    print_kv("세션 상태", session.session_status)
    print_kv("산출물 폴더", dataset_dir)
    return 1 if any_failed else 0


def cmd_diarize(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest).resolve()
    log_path = args.log or str(manifest_path.with_suffix(".log"))
    install_log_tee(
        log_path,
        prepare_output=prepare_for_regular_output,
        include_run_markers=True,
    )

    request_path = Path(args.request).resolve()
    cancel_file = Path(args.cancel_file).resolve() if args.cancel_file else None

    print_banner("Script DiariZen speaker separation")
    print_kv("Python", sys.executable)
    print_kv("Working directory", Path.cwd())
    print_kv("Model cache", model_cache_root())
    print_section("Run info")
    print_kv("Request file", request_path)
    print_kv("Manifest", manifest_path)
    print_kv("Log file", log_path)

    result = run_batch_speaker_diarization(request_path, manifest_path, cancel_file, config_overrides=batch_model_config_overrides(args))
    print_section("Script DiariZen speaker separation finished")
    print_kv("Exit code", result)
    return result


def cmd_transcribe(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest).resolve()
    log_path = args.log or str(manifest_path.with_suffix(".log"))
    install_log_tee(
        log_path,
        prepare_output=prepare_for_regular_output,
        include_run_markers=True,
    )

    input_dir = Path(args.input).resolve()
    cancel_file = Path(args.cancel_file).resolve() if args.cancel_file else None

    print_banner("Script transcription and word alignment")
    print_kv("Python", sys.executable)
    print_kv("Working directory", Path.cwd())
    print_kv("Model cache", model_cache_root())
    print_section("Run info")
    print_kv("Input folder", input_dir)
    print_kv("Manifest", manifest_path)
    print_kv("Log file", log_path)
    print_kv("Language", args.language)

    print_section("모델 추론")
    print_kv("Runtime input folder", input_dir)
    result = run_batch_transcription(input_dir, manifest_path, args.language, cancel_file, config_overrides=batch_model_config_overrides(args))
    print_section("Script transcription finished")
    print_kv("Exit code", result)
    return result


def cmd_run(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest).resolve()
    log_path = args.log or str(manifest_path.with_suffix(".log"))
    install_log_tee(
        log_path,
        prepare_output=prepare_for_regular_output,
        include_run_markers=True,
    )

    input_dir = Path(args.input).resolve()
    cancel_file = Path(args.cancel_file).resolve() if args.cancel_file else None

    print_banner("Script transcription and word alignment")
    print_kv("Python", sys.executable)
    print_kv("Working directory", Path.cwd())
    print_kv("Model cache", model_cache_root())
    print_section("Run info")
    print_kv("Input folder", input_dir)
    print_kv("Manifest", manifest_path)
    print_kv("Log file", log_path)
    print_kv("Language", args.language)

    print_section("모델 추론")
    print_kv("Runtime input folder", input_dir)
    result = run_batch_transcription(input_dir, manifest_path, args.language, cancel_file, config_overrides=batch_model_config_overrides(args))
    print_section("Script run finished")
    print_kv("Exit code", result)
    return result


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.cmd == "export":
        return cmd_export(args)
    if args.cmd == "diarize":
        return cmd_diarize(args)
    if args.cmd == "transcribe":
        return cmd_transcribe(args)
    if args.cmd == "run":
        return cmd_run(args)
    return 1


def add_batch_model_override_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--whisper-asr-model", default="")
    parser.add_argument("--whisper-beam-size", type=int, default=None)
    parser.add_argument("--whisper-vad-filter", default="")
    parser.add_argument("--whisper-compute-type-cpu", default="")
    parser.add_argument("--whisper-compute-type-cuda", default="")
    parser.add_argument("--whisper-suppress-numerals", default="")
    parser.add_argument("--whisper-initial-prompt", default="")
    parser.add_argument("--word-align-language-code", default="")
    parser.add_argument("--word-align-device", default="")
    parser.add_argument("--word-align-low-score-threshold", type=float, default=None)
    parser.add_argument("--word-align-missing-score-threshold", type=float, default=None)
    parser.add_argument("--diarizen-model-id", default="")
    parser.add_argument("--diarizen-embedding-model-id", default="")
    parser.add_argument("--batch-speaker-target-sample-rate", type=int, default=None)
    parser.add_argument("--batch-speaker-min-overlap-sec", type=float, default=None)


def batch_model_config_overrides(args: argparse.Namespace) -> dict[str, dict[str, object]]:
    return {
        "batch_transcription": {
            "asr_model": args.whisper_asr_model.strip() or None,
            "beam_size": args.whisper_beam_size,
            "vad_filter": parse_optional_bool(args.whisper_vad_filter),
            "compute_type_cpu": args.whisper_compute_type_cpu.strip() or None,
            "compute_type_cuda": args.whisper_compute_type_cuda.strip() or None,
            "suppress_numerals": parse_optional_bool(args.whisper_suppress_numerals),
            "initial_prompt": args.whisper_initial_prompt.strip() or None,
        },
        "word_alignment": {
            "language_code": args.word_align_language_code.strip() or None,
            "device": args.word_align_device.strip() or None,
            "low_score_threshold": args.word_align_low_score_threshold,
            "missing_score_threshold": args.word_align_missing_score_threshold,
        },
        "speaker": {
            "diarizen_model_id": args.diarizen_model_id.strip() or None,
            "diarizen_embedding_model_id": args.diarizen_embedding_model_id.strip() or None,
            "batch_qc_target_sample_rate": args.batch_speaker_target_sample_rate,
            "batch_qc_min_overlap_sec": args.batch_speaker_min_overlap_sec,
        },
    }


def parse_optional_bool(value: object) -> bool | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return None


def run_cli() -> int:
    try:
        return main()
    except Exception:
        traceback.print_exc()
        raise
    finally:
        close_log_tee()


if __name__ == "__main__":
    raise SystemExit(run_cli())
