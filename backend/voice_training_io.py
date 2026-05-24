import json
from pathlib import Path


def read_text_any(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "mbcs"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def to_simple_yaml(data: dict, indent: int = 0) -> str:
    lines: list[str] = []
    pad = " " * indent
    for key, value in data.items():
        if isinstance(value, dict):
            lines.append(f"{pad}{key}:")
            lines.append(to_simple_yaml(value, indent + 2).rstrip())
        else:
            lines.append(f"{pad}{key}: {yaml_scalar(value)}")
    return "\n".join(lines) + "\n"


def yaml_scalar(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        text = f"{value:.10f}".rstrip("0").rstrip(".")
        return text if text else "0"
    return json.dumps(str(value), ensure_ascii=False)
