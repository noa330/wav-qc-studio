from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from backend.cli_logging import close_log_tee, has_active_log_tee, install_log_tee, try_install_log_tee_from_argv
    from backend.console_ui import prepare_for_regular_output
    from backend.slicer.session_runner import run_slicer_session
else:
    from ..cli_logging import close_log_tee, has_active_log_tee, install_log_tee, try_install_log_tee_from_argv
    from ..console_ui import prepare_for_regular_output
    from .session_runner import run_slicer_session


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Slice-page slicer runner")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("slice", help="Run the slice or tagging workflow")
    p.add_argument("--workflow-mode", choices=["slice", "tag", "export"], default="slice", help="slice=detect markers, tag=PretrainedSED frame tagging only, export=write edited slices")
    p.add_argument("--markers-json", required=False, default="", help="Edited marker JSON path for export workflow")
    p.add_argument("--input", required=True, help="Input folder")
    p.add_argument("--output-dir", required=True, help="Output directory")
    p.add_argument("--manifest", required=True, help="Progress manifest JSON path")
    p.add_argument("--log", required=False, help="Log file path")
    p.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    p.add_argument("--recursive", action="store_true", help="Search recursively")
    p.add_argument("--split-gap-sec", type=float, default=1.0, help="Split when the marker gap is this many seconds or longer")
    p.add_argument("--normalize-max", type=float, default=0.9, help="Per-slice target peak after normalization")
    p.add_argument("--normalize-alpha", type=float, default=0.25, help="Blend ratio for normalized audio")
    p.add_argument("--speech-threshold", type=float, default=0.40, help="FireRed speech threshold")
    p.add_argument("--smooth-window-size", type=int, default=5, help="FireRed smoothing window size")
    p.add_argument("--min-event-frame", type=int, default=20, help="FireRed minimum event frame")
    p.add_argument("--max-event-frame", type=int, default=2000, help="FireRed maximum event frame")
    p.add_argument("--min-silence-frame", type=int, default=20, help="FireRed minimum silence frame")
    p.add_argument("--merge-silence-frame", type=int, default=0, help="FireRed merge silence frame")
    p.add_argument("--extend-speech-frame", type=int, default=0, help="FireRed speech extension frame")
    p.add_argument("--chunk-max-frame", type=int, default=30000, help="FireRed maximum chunk frame")
    p.add_argument("--speech-pad-ms", type=float, default=10.0, help="Speech padding before/after detected ranges")
    p.add_argument("--zero-cross-search-ms", type=float, default=6.0, help="Boundary zero-crossing search window")
    p.add_argument("--quiet-boundary-search-ms", type=float, default=500.0, help="Quiet boundary search window")
    p.add_argument("--monitor-merge-gap-ms", type=float, default=24.0, help="Merge nearby speech monitor ranges")
    p.add_argument("--monitor-merge-max-ms", type=float, default=15000.0, help="Maximum merged marker duration")
    p.add_argument("--splice-ms", type=float, default=35.0, help="Mute boundary splice/fade length")
    p.add_argument("--floor-gain-db", type=float, default=-120.0, help="Muted floor gain in dB")
    p.add_argument("--pretrained-sed-model-key", choices=["beats", "atst_f", "fpasst"], default="beats", help="PretrainedSED strong checkpoint")
    p.add_argument("--pretrained-sed-thresholds", default="0.1,0.2,0.5", help="Comma, semicolon, or newline separated event decode thresholds")
    p.add_argument("--pretrained-sed-median-window", type=int, default=9, help="Median filter window for frame scores")
    p.add_argument("--pretrained-sed-frame-interval", type=float, default=0.04, help="Displayed frame tag row interval in seconds")
    p.add_argument("--pretrained-sed-top-k", type=int, default=10, help="Number of frame tags to retain per row")
    p.add_argument("--pretrained-sed-min-score", type=float, default=0.0, help="Minimum frame tag score to display")
    p.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    return parser


def cmd_slice(args: argparse.Namespace) -> int:
    install_log_tee(args.log, prepare_output=prepare_for_regular_output)
    return run_slicer_session(args)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.cmd == "slice":
        return cmd_slice(args)
    return 1


def run_cli() -> int:
    try:
        return main()
    except Exception:
        if not has_active_log_tee():
            try_install_log_tee_from_argv(sys.argv[1:], prepare_output=prepare_for_regular_output)
        print("[FATAL] Slicer runner crashed before completion.")
        traceback.print_exc()
        raise
    finally:
        close_log_tee()


if __name__ == "__main__":
    raise SystemExit(run_cli())
