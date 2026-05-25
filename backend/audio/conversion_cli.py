from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Sequence


def run_audio_converting_cli(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare a stable converted WAV folder for an input audio folder")
    parser.add_argument("--input", required=True, help="Original input folder")
    parser.add_argument("--cache-dir", required=True, help="Stable converted WAV directory")
    parser.add_argument("--source-map", required=False, default="", help="JSON map from source audio to cached WAV")
    parser.add_argument("--manifest", required=False, default="", help="Progress manifest JSON path")
    parser.add_argument("--log", required=False, default="", help="Log file path")
    parser.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    parser.add_argument("--recursive", action="store_true", help="Search recursively")
    args = parser.parse_args(list(argv) if argv is not None else None)

    from .conversion_cache import AudioInputPreparationCancelled, prepare_selected_audio_input_cache

    log_path = args.log or str(Path(args.cache_dir).resolve() / f"audio_converting_{datetime.now():%Y%m%d_%H%M%S}.log")
    try:
        from backend.cli_logging import close_log_tee, install_log_tee
        from backend.console_ui import prepare_for_regular_output, print_banner, print_kv, print_section
    except Exception:  # noqa: BLE001
        try:
            from ..cli_logging import close_log_tee, install_log_tee  # type: ignore
            from ..console_ui import prepare_for_regular_output, print_banner, print_kv, print_section  # type: ignore
        except Exception:  # noqa: BLE001
            from cli_logging import close_log_tee, install_log_tee  # type: ignore
            from console_ui import prepare_for_regular_output, print_banner, print_kv, print_section  # type: ignore

    install_log_tee(log_path, prepare_output=prepare_for_regular_output, include_run_markers=True)
    try:
        print_banner("오디오 컨버팅")
        print_kv("Python", sys.executable)
        print_kv("Working directory", Path.cwd())
        print_kv("Input folder", Path(args.input).resolve())
        print_kv("Converted WAV folder", Path(args.cache_dir).resolve())
        print_kv("Manifest", args.manifest or "-")
        print_kv("Source map", args.source_map or "-")
        print_section("오디오 컨버팅")
        prepared = prepare_selected_audio_input_cache(
            args.input,
            cache_folder=args.cache_dir,
            source_map_path=args.source_map or None,
            recursive=bool(args.recursive),
            manifest_path=args.manifest or None,
            cancel_file=args.cancel_file or None,
            progress_title="오디오 컨버팅",
            log=print,
        )
        print_section("오디오 컨버팅 완료")
        print_kv("Runtime input folder", prepared.input_folder)
        print_kv("Original input folder", prepared.original_input_folder)
        print_kv("Mapped files", len(prepared.mappings))
        return 0
    except AudioInputPreparationCancelled:
        print("[cancelled] Audio converting was cancelled.")
        return 130
    finally:
        close_log_tee()
