from __future__ import annotations

from datetime import datetime

try:
    from .console_ui_core import (
        LiveConsoleLine,
        clean_text,
        fit_text,
        prepare_for_regular_output,
        render_progress_bar,
    )
except ImportError:
    from console_ui_core import (  # type: ignore[no-redef]
        LiveConsoleLine,
        clean_text,
        fit_text,
        prepare_for_regular_output,
        render_progress_bar,
    )


def format_progress_line(
    status: str,
    index: int,
    total: int,
    file_name: str,
    *,
    stage: str = "",
    detail: str = "",
    completed: int | None = None,
) -> str:
    current = index if completed is None else completed
    suffix = f" - stage={clean_text(stage)}" if stage else ""
    if detail:
        suffix += f" - {clean_text(detail)}"
    return f"[{clean_text(status)}] {index}/{total} {render_progress_bar(current, total)} - {clean_text(file_name)}{suffix}"


def format_finished_line(total: int, *, failed: int = 0) -> str:
    status = "finished" if failed <= 0 else "finished-with-errors"
    detail = f" - failed={failed}" if failed > 0 else ""
    return f"[{status}] {total}/{total} {render_progress_bar(total, total)}{detail}"


class DownloadProgress:
    def __init__(self, label: str) -> None:
        self.label = clean_text(label)
        self.line = LiveConsoleLine()
        self._last_percent = -1

    def __call__(self, block_num: int, block_size: int, total_size: int) -> None:
        if total_size <= 0:
            self.line.update(f"[download] {self.label} - receiving...")
            return

        downloaded = max(0, block_num * block_size)
        percent = min(100, int(downloaded * 100 / total_size))
        if percent == self._last_percent and percent not in {0, 100}:
            return
        self._last_percent = percent
        bar = render_progress_bar(percent, 100, width=18)
        mb_done = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        self.line.update(f"[download] {self.label} - {percent:3d}% {bar} - {mb_done:,.1f}/{mb_total:,.1f} MB")

    def finish(self, success_message: str | None = None) -> None:
        self.line.finish(success_message or f"[download complete] {self.label}")


def print_section(title: str) -> None:
    prepare_for_regular_output()
    print(f"\n=== {clean_text(title)} ===")


def print_kv(label: str, value: object) -> None:
    prepare_for_regular_output()
    fitted_label = fit_text(clean_text(label), 24)
    print(f"- {fitted_label:<24} : {value}")


def print_status(prefix: str, message: str) -> None:
    prepare_for_regular_output()
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {clean_text(prefix)} {clean_text(message)}")


def print_banner(title: str) -> None:
    prepare_for_regular_output()
    clean = clean_text(title)
    line = "=" * max(len(clean) + 8, 24)
    print(f"\n{line}\n=== {clean} ===\n{line}")
