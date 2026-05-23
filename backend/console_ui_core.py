from __future__ import annotations

import os
import sys
import threading
import unicodedata
from typing import Protocol


class _StreamLike(Protocol):
    def write(self, s: str) -> int: ...
    def flush(self) -> None: ...


_LOCK = threading.RLock()
_ACTIVE_LINE: "LiveConsoleLine | None" = None


def clean_text(text: object) -> str:
    return " ".join(str(text).split())


def _char_width(ch: str) -> int:
    if not ch or unicodedata.combining(ch):
        return 0
    if unicodedata.east_asian_width(ch) in {"F", "W"}:
        return 2
    return 1


def _display_width(text: str) -> int:
    return sum(_char_width(ch) for ch in text)


def _truncate_display(text: str, max_width: int) -> str:
    if max_width <= 0:
        return ""
    width = 0
    chars: list[str] = []
    for ch in text:
        ch_width = _char_width(ch)
        if width + ch_width > max_width:
            break
        chars.append(ch)
        width += ch_width
    return "".join(chars)


def fit_text(text: str, max_width: int) -> str:
    clean = clean_text(text)
    if max_width <= 0:
        return ""
    if _display_width(clean) <= max_width:
        return clean
    if max_width <= 3:
        return _truncate_display(clean, max_width)
    return _truncate_display(clean, max_width - 3) + "..."


def _console_stream() -> _StreamLike:
    return getattr(sys, "__stdout__", None) or sys.stdout


def _safe_write(stream: _StreamLike, text: str) -> int:
    try:
        return stream.write(text)
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or sys.getdefaultencoding() or "utf-8"
        safe_text = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
        return stream.write(safe_text)


def _terminal_width(default: int = 120) -> int:
    try:
        return max(1, int(os.get_terminal_size().columns) - 1)
    except Exception:
        return default


def render_progress_bar(current: int, total: int, width: int = 24) -> str:
    total = max(int(total), 1)
    current = min(max(int(current), 0), total)
    filled = min(max(int(round(width * current / total)), 0), width)
    return "#" * filled + "-" * (width - filled)


class LiveConsoleLine:
    def __init__(self) -> None:
        self._active = False
        self._last_width = 0

    def update(self, message: str) -> None:
        global _ACTIVE_LINE
        with _LOCK:
            if _ACTIVE_LINE is not None and _ACTIVE_LINE is not self:
                _ACTIVE_LINE._break_line_locked()

            text = fit_text(message, _terminal_width())
            width = _display_width(text)
            padding = " " * max(0, self._last_width - width)
            stream = _console_stream()
            _safe_write(stream, "\r" + text + padding)
            stream.flush()

            self._active = True
            self._last_width = max(width, self._last_width)
            _ACTIVE_LINE = self

    def _break_line_locked(self) -> None:
        global _ACTIVE_LINE
        if not self._active:
            if _ACTIVE_LINE is self:
                _ACTIVE_LINE = None
            return

        stream = _console_stream()
        _safe_write(stream, "\n")
        stream.flush()
        self._active = False
        self._last_width = 0
        if _ACTIVE_LINE is self:
            _ACTIVE_LINE = None

    def finish(self, message: str | None = None) -> None:
        with _LOCK:
            if message is not None:
                self.update(message)
            self._break_line_locked()


def prepare_for_regular_output(text: str | None = None) -> None:
    global _ACTIVE_LINE
    with _LOCK:
        if _ACTIVE_LINE is not None:
            _ACTIVE_LINE.finish(text)
        elif text is not None:
            stream = _console_stream()
            _safe_write(stream, text + "\n")
            stream.flush()
