from __future__ import annotations

from typing import TextIO

try:
    from backend.console_ui import print_banner, print_kv, print_section, print_status
except ImportError:
    try:
        from ..console_ui import print_banner, print_kv, print_section, print_status
    except ImportError:
        from console_ui import print_banner, print_kv, print_section, print_status  # type: ignore[no-redef]


class VoiceConsole:
    def __init__(self, log_file: TextIO) -> None:
        self._log_file = log_file

    def banner(self, title: str) -> None:
        print_banner(title)
        self._write_block(f"===== {title} =====")

    def section(self, title: str) -> None:
        print_section(title)
        self._write_block(f"=== {title} ===")

    def kv(self, label: str, value: object) -> None:
        print_kv(label, value)
        self._write_block(f"- {label}: {value}")

    def status(self, prefix: str, message: object) -> None:
        text = str(message)
        print_status(prefix, text)
        self._write_block(f"[{prefix}] {text}")

    def error(self, message: object) -> None:
        text = str(message)
        print_status("failed", text)
        self._write_block(f"FAILED: {text}")

    def log(self, message: object) -> None:
        text = str(message)
        lines = text.splitlines() or [""]
        for line in lines:
            self._write_block(line)
            self._print_log_line(line)

    def _write_block(self, text: str) -> None:
        self._log_file.write(str(text) + "\n")

    def _print_log_line(self, line: str) -> None:
        text = line.strip()
        if not text:
            return
        if text.startswith("> "):
            print_status("command", text[2:])
            return
        prefix, detail = _split_bracket_prefix(text)
        if prefix:
            print_status(prefix, detail)
            return
        print_status("output", text)


def _split_bracket_prefix(text: str) -> tuple[str, str]:
    if not text.startswith("["):
        return "", text
    close = text.find("]")
    if close <= 1 or close > 42:
        return "", text
    prefix = text[1:close].strip()
    detail = text[close + 1 :].strip()
    return prefix or "output", detail or "-"
