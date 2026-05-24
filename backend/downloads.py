from __future__ import annotations

import shutil
import time
import urllib.request
from pathlib import Path
from typing import Callable, TypeVar

from .console_ui import DownloadProgress

LogFn = Callable[[str], None]
T = TypeVar("T")


def download_url_to_path(
    url: str,
    target_path: Path | str,
    *,
    label: str,
    log: LogFn | None = None,
    retry_label: str | None = None,
    attempts: int = 3,
) -> Path:
    target = Path(target_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_suffix(target.suffix + ".part")
    active_progress: DownloadProgress | None = None

    def download_once() -> Path:
        nonlocal active_progress
        active_progress = DownloadProgress(label)
        return _download_url_once(url, temp_path, target, active_progress)

    try:
        return retry_download(download_once, log=log, label=retry_label or label, attempts=attempts)
    except Exception:
        if active_progress is not None:
            active_progress.finish(f"[download failed] {label}")
        if temp_path.exists():
            temp_path.unlink()
        raise


def is_download_complete(path: Path | str, *, reject_git_lfs_pointer: bool = False) -> bool:
    target = Path(path)
    if not target.exists() or target.stat().st_size <= 0:
        return False
    return not (reject_git_lfs_pointer and is_git_lfs_pointer(target))


def retry_download(download_fn: Callable[[], T], *, log: LogFn | None, label: str, attempts: int = 3) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return download_fn()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= attempts:
                break
            if log is not None:
                log(f"[model download retry] {label}: attempt {attempt}/{attempts} failed: {type(exc).__name__}: {exc}")
            time.sleep(float(attempt * 2))
    raise last_error  # type: ignore[misc]


def is_git_lfs_pointer(path: Path | str) -> bool:
    target = Path(path)
    try:
        if target.stat().st_size > 1024:
            return False
        return target.read_text(encoding="utf-8", errors="ignore").startswith("version https://git-lfs.github.com/spec/v1")
    except OSError:
        return False


def _download_url_once(url: str, temp_path: Path, target_path: Path, progress: DownloadProgress) -> Path:
    if temp_path.exists():
        temp_path.unlink()
    urllib.request.urlretrieve(url, temp_path, reporthook=progress)
    shutil.move(str(temp_path), str(target_path))
    size_mb = target_path.stat().st_size / (1024 * 1024)
    progress.finish(f"[download complete] {target_path.name} - {size_mb:.1f} MB")
    return target_path
