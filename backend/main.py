from __future__ import annotations

import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "prepare-audio":
        if __package__ is None or __package__ == "":
            from backend.audio.conversion_cli import run_audio_converting_cli
        else:
            from .audio.conversion_cli import run_audio_converting_cli
        return run_audio_converting_cli(sys.argv[2:])

    if __package__ is None or __package__ == "":
        from backend.analysis.main import run_cli
    else:
        from .analysis.main import run_cli
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
