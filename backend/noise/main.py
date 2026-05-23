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
    from backend.noise.session_runner import run_inference_session
else:
    from ..cli_logging import close_log_tee, has_active_log_tee, install_log_tee, try_install_log_tee_from_argv
    from ..console_ui import prepare_for_regular_output
    from .session_runner import run_inference_session


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Speaker-page inference runner")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("infer", help="Run VoiceFixer/Resemble/Sidon pipeline for a folder of WAV files")
    p.add_argument("--input", required=True, help="Input folder")
    p.add_argument("--output-dir", required=True, help="Output directory")
    p.add_argument("--manifest", required=True, help="Progress manifest JSON path")
    p.add_argument("--log", required=False, help="Log file path")
    p.add_argument("--cancel-file", required=False, default="", help="Cancel request file path")
    p.add_argument("--recursive", action="store_true", help="Search recursively")
    p.add_argument("--voicefixer", action="store_true", default=False)
    p.add_argument("--resemble", action="store_true", default=False)
    p.add_argument("--sidon", action="store_true", default=False)
    p.add_argument("--voicefixer-mode", type=int, default=0)
    p.add_argument("--resemble-task", choices=["enhance", "denoise_only"], default="enhance")
    p.add_argument("--resemble-solver", choices=["midpoint", "rk4", "euler"], default="midpoint")
    p.add_argument("--resemble-nfe", type=int, default=64)
    p.add_argument("--resemble-tau", type=float, default=0.5)
    p.add_argument("--resemble-lambda", type=float, default=0.9)
    p.add_argument("--voicefixer-device", choices=["auto", "cuda", "cpu"], default=None)
    p.add_argument("--resemble-device", choices=["auto", "cuda", "cpu"], default=None)
    p.add_argument("--sidon-device", choices=["auto", "cuda", "cpu"], default=None)
    p.add_argument("--sidon-input-peak", type=float, default=0.9)
    p.add_argument("--sidon-high-pass-hz", type=float, default=50.0)
    p.add_argument("--sidon-chunk-seconds", type=int, default=96)
    p.add_argument("--sidon-pre-padding", type=int, default=160)
    p.add_argument("--sidon-trailing-pad", type=int, default=24000)
    p.add_argument("--sidon-decoder-trim", type=int, default=960)
    p.add_argument("--sidon-stereo-mix-mode", choices=["average", "left", "right"], default="average")
    p.add_argument("--sidon-output-bit-depth", choices=["pcm16", "float32"], default="pcm16")
    p.add_argument("--sidon-audio-backend-preference", choices=["auto", "soundfile", "ffmpeg", "sox", "soundfile_direct"], default="auto")
    p.add_argument("--sidon-feature-cache-frames", type=int, default=1)
    p.add_argument("--device", choices=["auto", "cuda", "cpu"], default=None)
    return parser


def cmd_infer(args: argparse.Namespace) -> int:
    install_log_tee(args.log, prepare_output=prepare_for_regular_output)
    return run_inference_session(args)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.cmd == "infer":
        return cmd_infer(args)
    return 1


def run_cli() -> int:
    try:
        return main()
    except Exception:
        if not has_active_log_tee():
            try_install_log_tee_from_argv(sys.argv[1:], prepare_output=prepare_for_regular_output)
        print("[FATAL] Speaker inference runner crashed before completion.")
        traceback.print_exc()
        raise
    finally:
        close_log_tee()


if __name__ == "__main__":
    raise SystemExit(run_cli())
