from __future__ import annotations

import shutil
import site
from pathlib import Path


def _targets() -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    patterns = (
        "onnxruntime",
        "onnxruntime.libs",
        "onnxruntime-*.dist-info",
        "onnxruntime_gpu-*.dist-info",
        "onnxruntime_gpu",
    )
    for site_dir in site.getsitepackages():
        base = Path(site_dir)
        for pattern in patterns:
            for p in base.glob(pattern):
                key = str(p).lower()
                if key in seen:
                    continue
                seen.add(key)
                out.append(p)
    return out


def main() -> int:
    print("== cleanup_onnxruntime_conflicts ==")
    targets = _targets()
    if not targets:
        print("No stale ONNX Runtime package paths found.")
        return 0

    removed = 0
    failed = 0
    for path in targets:
        try:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=False)
            else:
                path.unlink(missing_ok=True)
            print(f"removed: {path}")
            removed += 1
        except Exception as e:  # noqa: BLE001
            print(f"failed: {path} ({type(e).__name__}: {e})")
            failed += 1
    print(f"removed_count={removed} failed_count={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
