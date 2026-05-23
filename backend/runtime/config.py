from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "models.json"


def load_config() -> dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def merge_config_overrides(cfg: dict[str, Any], overrides: dict[str, dict[str, Any]]) -> dict[str, Any]:
    for section, values in overrides.items():
        target = cfg.setdefault(section, {})
        if not isinstance(target, dict):
            continue
        for key, value in values.items():
            if value is not None:
                target[key] = value
    return cfg
