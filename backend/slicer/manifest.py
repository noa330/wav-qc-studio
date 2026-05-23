from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from ..manifest_io import atomic_write_json
from .schema import SlicerSession


def iso_now() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")


def write_manifest(session: SlicerSession) -> None:
    manifest_path = Path(session.manifest_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    payload = session.build_manifest()
    payload["updatedAt"] = iso_now()
    if not manifest_path.exists():
        payload["createdAt"] = payload["updatedAt"]
    else:
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            payload["createdAt"] = previous.get("createdAt", payload["updatedAt"])
        except Exception:
            payload["createdAt"] = payload["updatedAt"]

    atomic_write_json(manifest_path, payload)
