from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any


WINDOWS_LOCK_ERRORS = {5, 32, 33}


def atomic_write_json(target_path: Path | str, payload: dict[str, Any], *, retries: int = 120, delay_sec: float = 0.05) -> bool:
    path = Path(target_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    last_error: BaseException | None = None
    for attempt in range(retries):
        try:
            tmp_path.replace(path)
            return True
        except OSError as exc:
            if not _is_transient_file_lock(exc):
                raise
            last_error = exc
            time.sleep(min(delay_sec * (1 + attempt / 20), 0.25))

    try:
        tmp_path.replace(path)
        return True
    except OSError as exc:
        if not _is_transient_file_lock(exc):
            raise
        last_error = exc

    print(f"[manifest warning] skipped locked manifest update: {path} ({last_error})")
    try:
        tmp_path.unlink(missing_ok=True)
    except OSError:
        pass
    return False


def _is_transient_file_lock(exc: OSError) -> bool:
    winerror = getattr(exc, "winerror", None)
    if winerror in WINDOWS_LOCK_ERRORS:
        return True
    return isinstance(exc, PermissionError)
