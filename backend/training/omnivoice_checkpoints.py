from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Callable

from .checkpoints import checkpoint_number


LogFn = Callable[[str], None]


def omnivoice_checkpoint_dirs_for(out_dir: Path, omni_hf: Path) -> list[Path]:
    candidates: list[Path] = []
    for path in out_dir.glob("checkpoint-*"):
        if not path.is_dir():
            continue
        has_weights = any(
            valid_omnivoice_weight_file_for(weight, omni_hf) for weight in path.glob("model*.safetensors")
        ) or valid_omnivoice_weight_file_for(path / "pytorch_model.bin", omni_hf)
        if has_weights:
            candidates.append(path)
    return sorted(candidates, key=checkpoint_number)


def valid_omnivoice_weight_file_for(path: Path, omni_hf: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False
    if path.suffix.lower() == ".safetensors":
        reference = omni_hf / "model.safetensors"
        if reference.exists():
            return path.stat().st_size >= int(reference.stat().st_size * 0.95)
    return path.stat().st_size > 0


def finalize_omnivoice_model_checkpoint_for(checkpoint_dir: Path, train_cfg: Path, omni_hf: Path, log: LogFn) -> None:
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "chat_template.jinja"):
        src = omni_hf / name
        dst = checkpoint_dir / name
        if src.exists() and not dst.exists():
            shutil.copy2(src, dst)
    train_dst = checkpoint_dir / "train_config.json"
    if train_cfg.exists() and not train_dst.exists():
        shutil.copy2(train_cfg, train_dst)

    optimizer = checkpoint_dir / "optimizer.bin"
    scheduler = checkpoint_dir / "scheduler.bin"
    if optimizer.exists() and not scheduler.exists():
        try:
            optimizer.unlink()
            log(f"[OmniVoice checkpoint] Removed incomplete optimizer state: {optimizer}")
        except OSError:
            pass


def omnivoice_checkpoint_written_after_for(checkpoint_dir: Path, timestamp: float, omni_hf: Path) -> bool:
    candidates = list(checkpoint_dir.glob("model*.safetensors")) + [checkpoint_dir / "pytorch_model.bin"]
    for path in candidates:
        if valid_omnivoice_weight_file_for(path, omni_hf) and path.stat().st_mtime >= timestamp:
            return True
    return False


def relative_arg(path: Path, cwd: Path) -> str:
    return os.path.relpath(str(path), str(cwd))


def relative_posix_arg(path: Path, cwd: Path) -> str:
    return os.path.relpath(str(path.resolve()), str(cwd.resolve())).replace(os.sep, "/")


def rewrite_webdataset_manifest_for_windows_file(manifest: Path, omni_repo: Path, log: LogFn) -> None:
    if not manifest.exists():
        return
    rewritten: list[str] = []
    changed = False
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 4:
            rewritten.append(raw)
            continue
        tar_path, label_path, count, duration = parts
        if re.match(r"^[A-Za-z]:[\\/]", tar_path):
            tar_rel = relative_posix_arg(Path(tar_path), omni_repo)
            label_rel = relative_posix_arg(Path(label_path), omni_repo)
            rewritten.append(f"{tar_rel} {label_rel} {count} {duration}")
            changed = True
        else:
            rewritten.append(raw)
    if changed:
        manifest.write_text("\n".join(rewritten) + "\n", encoding="utf-8")
        log(f"Rewrote OmniVoice WebDataset manifest for Windows file URLs: {manifest}")


def count_webdataset_manifest_shards(manifest: Path) -> int:
    if not manifest.exists():
        return 0
    return sum(1 for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip())
