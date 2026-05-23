from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from ..manifest_io import atomic_write_json
from .schema import BatchQcExportSession


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_manifest(session: BatchQcExportSession) -> None:
    manifest_path = Path(session.manifest_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    payload = session.build_manifest()
    payload["updatedAt"] = iso_now()
    if manifest_path.exists():
        try:
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            payload["createdAt"] = previous.get("createdAt", payload["updatedAt"])
        except Exception:
            payload["createdAt"] = payload["updatedAt"]
    else:
        payload["createdAt"] = payload["updatedAt"]

    atomic_write_json(manifest_path, payload)
