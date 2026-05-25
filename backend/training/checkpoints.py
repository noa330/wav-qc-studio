import glob as glob_module
import re
from pathlib import Path
from typing import Iterable, Optional


def checkpoints(patterns: Iterable[Path]) -> list[Path]:
    found: list[Path] = []
    for pattern in patterns:
        found.extend(Path(p) for p in glob_module.glob(str(pattern)))
    return sorted([p for p in found if p.is_file()], key=lambda p: p.stat().st_mtime)


def newest_file(patterns: Iterable[Path]) -> Optional[Path]:
    found = checkpoints(patterns)
    return found[-1] if found else None


def checkpoint_number(path: Path) -> int:
    match = re.search(r"checkpoint-(\d+)$", path.name)
    return int(match.group(1)) if match else -1
