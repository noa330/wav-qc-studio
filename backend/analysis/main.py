from __future__ import annotations

import argparse
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from backend.analysis.engine import AnalysisEngine
    from backend.analysis.schema import TaskSelection
    from backend.cli_logging import close_log_tee, install_log_tee
    from backend.console_ui import prepare_for_regular_output, print_banner, print_kv, print_section
    from backend.runtime import get_runtime_summary, model_cache_root
else:
    from .engine import AnalysisEngine
    from .schema import TaskSelection
    from ..cli_logging import close_log_tee, install_log_tee
    from ..console_ui import prepare_for_regular_output, print_banner, print_kv, print_section
    from ..runtime import get_runtime_summary, model_cache_root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Score WAV QC analyzer")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("analyze", help="Analyze a folder of WAV files")
    p.add_argument("--input", required=True, help="Input folder")
    p.add_argument("--manifest", required=False, default="", help="Progress manifest JSON path")
    p.add_argument("--log", required=False, help="Log file path")
    p.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    p.add_argument("--recursive", action="store_true", help="Search recursively")
    p.add_argument("--pron", action="store_true")
    p.add_argument("--noise", action="store_true")
    p.add_argument("--speaker", action="store_true")
    p.add_argument("--speaker-method", choices=["msdd", "embedding_vad"], default="msdd")
    p.add_argument("--language", default="auto", help="Whisper transcription language code, or auto")
    p.add_argument("--noise-sample-rate", type=int, default=None)
    p.add_argument("--noise-personalized", default="")
    p.add_argument("--noise-num-threads", type=int, default=None)
    p.add_argument("--noise-require-cuda-provider", default="")
    p.add_argument("--noise-bak-bad-threshold", type=float, default=None)
    return parser


def default_log_path(input_dir: str) -> str:
    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(input_dir) / "_wav_qc_results"
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir / f"analysis_{now}.log")


def cmd_analyze(args: argparse.Namespace) -> int:
    log_path = args.log or default_log_path(args.input)
    install_log_tee(
        log_path,
        prepare_output=prepare_for_regular_output,
        include_run_markers=True,
    )

    tasks = TaskSelection(
        pron=args.pron,
        noise=args.noise,
        speaker=args.speaker,
        speaker_method=args.speaker_method,
        transcription_language=args.language,
    ).normalize()

    print_banner("Score analysis")
    print_kv("Python", sys.executable)
    print_kv("Working directory", Path.cwd())
    print_kv("Model cache", model_cache_root())
    print_kv("Log file", log_path)
    print_kv("Input folder", args.input)
    print_kv(
        "Tasks",
        f"pron={tasks.pron}, noise={tasks.noise}, speaker={tasks.speaker}, "
        f"speaker_method={tasks.speaker_method}, language={tasks.transcription_language}",
    )
    print_kv("Runtime", get_runtime_summary())
    sys.stdout.flush()

    print_section("모델 추론")
    print_kv("Runtime input folder", args.input)
    engine = AnalysisEngine(tasks, config_overrides=overview_config_overrides(args))
    if getattr(engine, "init_warnings", None):
        for warning in engine.init_warnings:
            print(f"[init warning] {warning}")

    print_section("Analyzing files")
    try:
        rows = engine.analyze_folder(
            args.input,
            recursive=args.recursive,
            manifest_path=args.manifest or None,
            cancel_file=args.cancel_file or None,
        )
    except KeyboardInterrupt:
        print("[cancelled] Analysis was cancelled.")
        return 130

    print_section("Score analysis finished")
    print_kv("Completed rows", len(rows))
    return 0


def overview_config_overrides(args: argparse.Namespace) -> dict[str, dict[str, object]]:
    return {
        "noise": {
            "sample_rate": args.noise_sample_rate,
            "personalized": parse_optional_bool(args.noise_personalized),
            "num_threads": args.noise_num_threads,
            "require_cuda_provider": parse_optional_bool(args.noise_require_cuda_provider),
            "bak_bad_threshold": args.noise_bak_bad_threshold,
        },
    }


def parse_optional_bool(value: object) -> bool | None:
    normalized = str(value or "").strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return None


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.cmd == "analyze":
        return cmd_analyze(args)
    return 1


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
