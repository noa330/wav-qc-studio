from __future__ import annotations

import io
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable

PrepareOutputFunc = Callable[[str], None]


class _Tee(io.TextIOBase):
    def __init__(self, *streams: io.TextIOBase, prepare_output: PrepareOutputFunc | None = None):
        self._streams = streams
        self._prepare_output = prepare_output

    def write(self, s: str) -> int:
        if not s:
            return 0

        try:
            if self._prepare_output is not None:
                self._prepare_output()
        except Exception:
            pass

        for stream in self._streams:
            try:
                stream.write(s)
                stream.flush()
            except Exception:
                pass
        return len(s)

    def flush(self) -> None:
        for stream in self._streams:
            try:
                stream.flush()
            except Exception:
                pass


_LOG_FH: io.TextIOWrapper | None = None
_INCLUDE_RUN_MARKERS = False


def install_log_tee(
    log_path: str | None,
    *,
    prepare_output: PrepareOutputFunc | None = None,
    include_run_markers: bool = False,
) -> None:
    global _LOG_FH, _INCLUDE_RUN_MARKERS

    if not log_path:
        return

    path = Path(log_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    _LOG_FH = open(path, "a", encoding="utf-8", buffering=1)
    _INCLUDE_RUN_MARKERS = include_run_markers

    if include_run_markers:
        _LOG_FH.write(
            f"\n===== run started {datetime.now().isoformat(sep=' ', timespec='seconds')} =====\n"
        )
        _LOG_FH.flush()

    sys.stdout = _Tee(sys.__stdout__, _LOG_FH, prepare_output=prepare_output)
    sys.stderr = _Tee(sys.__stderr__, _LOG_FH, prepare_output=prepare_output)


def try_install_log_tee_from_argv(
    argv: list[str],
    *,
    prepare_output: PrepareOutputFunc | None = None,
    include_run_markers: bool = False,
) -> None:
    for index, value in enumerate(argv):
        if value == "--log" and index + 1 < len(argv):
            try:
                install_log_tee(
                    argv[index + 1],
                    prepare_output=prepare_output,
                    include_run_markers=include_run_markers,
                )
            except Exception:
                pass
            return
        if value.startswith("--log="):
            try:
                install_log_tee(
                    value.split("=", 1)[1],
                    prepare_output=prepare_output,
                    include_run_markers=include_run_markers,
                )
            except Exception:
                pass
            return


def close_log_tee() -> None:
    global _LOG_FH
    if _LOG_FH is None:
        return

    try:
        if _INCLUDE_RUN_MARKERS:
            _LOG_FH.write(
                f"===== run ended {datetime.now().isoformat(sep=' ', timespec='seconds')} =====\n"
            )
        _LOG_FH.flush()
        _LOG_FH.close()
    except Exception:
        pass
    finally:
        _LOG_FH = None


def has_active_log_tee() -> bool:
    return _LOG_FH is not None
