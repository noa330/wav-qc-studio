from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable

def model_name_exists(core: Any, model_type: str, name: str) -> bool:
    if model_type == "gpt-sovits":
        paths = [
            core.GPT_REPO / "logs" / name,
            core.WORK_DIR / "gpt_sovits" / name,
        ]
    else:
        paths = [
            core.WORK_DIR / "omnivoice" / name,
        ]
    return any(Path(path).exists() for path in paths)


def resume_checkpoint_exists(
    core: Any,
    model_type: str,
    name: str,
    gpt_version: str = "v2",
    gpt_resume_sovits_path: str | None = None,
    gpt_resume_gpt_path: str | None = None,
    gpt_resume_sovits_d_path: str | None = None,
    omni_resume_from_checkpoint: str | None = None,
) -> bool:
    if model_type == "gpt-sovits":
        return gpt_resume_checkpoint_exists(core, name, gpt_version, gpt_resume_sovits_path, gpt_resume_gpt_path, gpt_resume_sovits_d_path)
    return omni_resume_checkpoint_exists(core, name, omni_resume_from_checkpoint)


def gpt_resume_checkpoint_exists(
    core: Any,
    name: str,
    version: str,
    selected_sovits_path: str | None = None,
    selected_gpt_path: str | None = None,
    selected_sovits_d_path: str | None = None,
) -> bool:
    exp_dir = Path(core.GPT_REPO) / "logs" / name
    s2_dir = exp_dir / f"logs_s2_{version}"
    s1_dir = exp_dir / f"logs_s1_{version}" / "ckpt"
    selected_paths: list[Path] = []
    if selected_sovits_path:
        selected_sovits = Path(selected_sovits_path)
        selected_paths.append(selected_sovits)
        selected_discriminator = selected_sovits_discriminator_path(selected_sovits, selected_sovits_d_path, version)
        if selected_discriminator is not None:
            selected_paths.append(selected_discriminator)
    if selected_gpt_path:
        selected_paths.append(Path(selected_gpt_path))
    if selected_paths:
        selected_files_exist = all(path.exists() and path.is_file() for path in selected_paths)
        has_selected_sovits_resume_state = bool(selected_sovits_path and sovits_path_is_resume_state(Path(selected_sovits_path), version))
        has_sovits_resume_state = has_selected_sovits_resume_state or (any(s2_dir.glob("G_*.pth")) and any(s2_dir.glob("D_*.pth")))
        has_selected_gpt_resume_state = bool(selected_gpt_path and gpt_path_is_resume_state(Path(selected_gpt_path), version))
        has_gpt_resume_state = has_selected_gpt_resume_state or any(s1_dir.glob("*.ckpt"))
        return selected_files_exist and has_sovits_resume_state and has_gpt_resume_state

    return (
        any(s2_dir.glob("G_*.pth"))
        and any(s2_dir.glob("D_*.pth"))
        and any(s1_dir.glob("*.ckpt"))
    )


def selected_sovits_discriminator_path(selected_sovits: Path, selected_sovits_d_path: str | None, version: str) -> Path | None:
    if not sovits_path_is_resume_state(selected_sovits, version):
        return None
    if selected_sovits_d_path:
        candidate = Path(selected_sovits_d_path)
        if candidate.name.lower().startswith("d_"):
            return candidate
    return selected_sovits.with_name("D_" + selected_sovits.name[2:])


def sovits_path_is_resume_state(path: Path, version: str) -> bool:
    normalized = path.as_posix().lower()
    return f"/logs_s2_{version.lower()}/" in normalized and path.name.lower().startswith("g_")


def gpt_path_is_resume_state(path: Path, version: str) -> bool:
    normalized = path.as_posix().lower()
    return f"/logs_s1_{version.lower()}/ckpt/" in normalized and path.suffix.lower() == ".ckpt"


def omni_checkpoint_is_complete(checkpoint: Path) -> bool:
    return checkpoint.is_dir() and (checkpoint / "config.json").exists() and (
        any(checkpoint.glob("model*.safetensors")) or (checkpoint / "pytorch_model.bin").exists()
    )


def omni_resume_checkpoint_exists(core: Any, name: str, selected_checkpoint: str | None = None) -> bool:
    if selected_checkpoint:
        return omni_checkpoint_is_complete(Path(selected_checkpoint))
    out_dir = Path(core.WORK_DIR) / "omnivoice" / name / "exp"
    return any(omni_checkpoint_is_complete(path) for path in out_dir.glob("checkpoint-*"))


def emit_checkpoints(manifest: TrainingManifestWriter, stage: str, checkpoints: Iterable[Path], model_name: str) -> None:
    seen: set[str] = set()
    for checkpoint in select_display_checkpoints(stage, checkpoints):
        path = Path(checkpoint)
        if not checkpoint_belongs_to_model(path, model_name):
            continue
        epoch, step = checkpoint_training_unit(stage, path)
        key = checkpoint_display_key(stage, path, epoch, step)
        if key in seen:
            continue
        seen.add(key)
        manifest.emit(stage, "completed", "Checkpoint saved", checkpoint_path=path, epoch=epoch, step=step)


def select_display_checkpoints(stage: str, checkpoints: Iterable[Path]) -> list[Path]:
    paths = [Path(checkpoint) for checkpoint in checkpoints]
    lower_stage = stage.lower()
    real_paths = [path for path in paths if is_real_checkpoint_path(path)]
    if not real_paths:
        return []

    if lower_stage == "omnivoice":
        dirs = [path for path in real_paths if path.is_dir()]
        if dirs:
            return sorted(dirs, key=lambda path: checkpoint_sort_key(stage, path))
        return sorted(real_paths, key=lambda path: checkpoint_sort_key(stage, path))

    if lower_stage == "sovits":
        return sorted(real_paths, key=lambda path: checkpoint_sort_key(stage, path))

    if lower_stage == "gpt":
        return sorted(real_paths, key=lambda path: checkpoint_sort_key(stage, path))

    return group_checkpoints_by_save_unit(stage, real_paths)


def is_real_checkpoint_path(path: Path) -> bool:
    if path.is_dir():
        return path.name.lower().startswith("checkpoint-")
    suffix = path.suffix.lower()
    if suffix not in {".pth", ".ckpt", ".safetensors", ".bin"}:
        return False
    return path.name.lower() not in {"config.json", "train_config.json", "tokenizer.json", "tokenizer_config.json"}


def group_checkpoints_by_save_unit(stage: str, checkpoints: Iterable[Path]) -> list[Path]:
    grouped: dict[str, Path] = {}
    for path in sorted((Path(checkpoint) for checkpoint in checkpoints), key=lambda path: checkpoint_sort_key(stage, path)):
        epoch, step = checkpoint_training_unit(stage, path)
        key = checkpoint_display_key(stage, path, epoch, step)
        grouped[key] = prefer_checkpoint(grouped.get(key), path)
    return sorted(grouped.values(), key=lambda path: checkpoint_sort_key(stage, path))


def checkpoint_display_key(stage: str, path: Path, epoch: str, step: str) -> str:
    lower_stage = stage.lower()
    if lower_stage == "omnivoice":
        return f"step:{step}" if step else path.stem.lower()
    if lower_stage in {"sovits", "gpt"}:
        return f"epoch:{epoch}" if epoch else path.stem.lower()
    if step:
        return f"step:{step}"
    if epoch:
        return f"epoch:{epoch}"
    return path.stem.lower()


def prefer_checkpoint(current: Path | None, candidate: Path) -> Path:
    if current is None:
        return candidate
    current_score = checkpoint_preference_score(current)
    candidate_score = checkpoint_preference_score(candidate)
    if candidate_score != current_score:
        return candidate if candidate_score > current_score else current
    return candidate if checkpoint_sort_key("", candidate) >= checkpoint_sort_key("", current) else current


def checkpoint_preference_score(path: Path) -> int:
    text = path.as_posix().lower()
    name = path.name.lower()
    if path.is_dir():
        return 100
    if "sovits_weights" in text or "gpt_weights" in text:
        return 90
    if name.startswith("g_"):
        return 70
    if name.endswith(".safetensors") or name.endswith(".ckpt") or name.endswith(".pth"):
        return 60
    return 10


def checkpoint_sort_key(stage: str, path: Path) -> tuple[int, int, float, str]:
    epoch, step = checkpoint_training_unit(stage, path)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0.0
    return (safe_int(epoch), safe_int(step), mtime, path.as_posix().lower())


def safe_int(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return -1


def checkpoint_belongs_to_model(path: Path, model_name: str) -> bool:
    normalized_model = model_name.replace("\\", "/").lower()
    normalized_path = path.as_posix().lower()
    return f"/{normalized_model}/" in normalized_path or path.name.lower().startswith(normalized_model.lower())


def checkpoint_training_unit(stage: str, path: Path) -> tuple[str, str]:
    lower_stage = stage.lower()
    if lower_stage == "omnivoice":
        return "", checkpoint_step(path)
    if lower_stage in {"sovits", "gpt"}:
        return checkpoint_epoch(path), ""
    return checkpoint_epoch(path), checkpoint_step(path)


def checkpoint_epoch(path: Path) -> str:
    text = path.as_posix()
    epoch_match = re.search(r"epoch[=_-]?(\d+)|(?:^|[/_-])e(\d+)(?:[/_.-]|$)", text, re.IGNORECASE)
    return next((group for group in (epoch_match.groups() if epoch_match else ()) if group), "")


def checkpoint_step(path: Path) -> str:
    text = path.as_posix()
    step_match = re.search(r"checkpoint-(\d+)|step[=_-]?(\d+)|(?:^|[/_-])s(\d+)(?:[/_.-]|$)", text, re.IGNORECASE)
    return next((group for group in (step_match.groups() if step_match else ()) if group), "")
