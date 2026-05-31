from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from backend.voice import training_core


LogFn = Callable[[str], None]
DEFAULT_TOOL_ROOT = Path(__file__).resolve().parents[2] / "training"


@dataclass(frozen=True)
class VoiceAssetState:
    core: Any
    tool_root: Path
    repo: Path
    hf_root: Path
    python: Path


def load_training_core(tool_root: Path | str) -> Any:
    root = Path(tool_root).resolve()
    training_core.configure_tool_root(root)
    return training_core


def ensure_voice_assets(model: str, tool_root: Path | str, log: LogFn, install_deps: bool = True, gpt_version: str = "v2") -> VoiceAssetState:
    root = Path(tool_root).resolve()
    core = load_training_core(root)
    if model == "gpt-sovits":
        if gpt_assets_ready(core, gpt_version, install_deps):
            python = Path(core.gpt_sovits_python())
            log(f"[voice assets] GPT-SoVITS assets ready: {Path(core.GPT_REPO)}")
        else:
            python = Path(core.ensure_gpt_sovits_assets(log=log, install_deps=install_deps))
        ensure_gpt_sovits_repo_layout(core, log)
        return VoiceAssetState(core=core, tool_root=root, repo=Path(core.GPT_REPO), hf_root=Path(core.GPT_HF), python=python)
    if model == "omnivoice":
        if omni_assets_ready(core, install_deps):
            python = Path(core.omnivoice_uv_python())
            log(f"[voice assets] OmniVoice assets ready: {Path(core.OMNI_REPO)}")
        else:
            python = Path(core.ensure_omnivoice_assets(log=log, install_deps=install_deps))
        return VoiceAssetState(core=core, tool_root=root, repo=Path(core.OMNI_REPO), hf_root=Path(core.OMNI_HF), python=python)
    raise RuntimeError(f"Unsupported voice model: {model}")


def resolve_gpt_weights(core: Any, version: str, mode: str, gpt_path: str = "", sovits_path: str = "") -> dict[str, Path]:
    gpt = Path(gpt_path).resolve() if mode == "checkpoint" and gpt_path else Path(core.gpt_model_path(version, "gpt"))
    sovits = Path(sovits_path).resolve() if mode == "checkpoint" and sovits_path else Path(core.gpt_model_path(version, "s2g"))
    for label, path in {"GPT": gpt, "SoVITS": sovits}.items():
        if not path.exists():
            raise RuntimeError(f"{label} weights not found: {path}")
    return {"gpt": gpt, "sovits": sovits}


def gpt_assets_ready(core: Any, version: str, install_deps: bool) -> bool:
    if not (Path(core.GPT_REPO) / ".git").exists() or not Path(core.GPT_HF).exists():
        return False
    pretrained = getattr(core, "GPT_PRETRAINED", {}).get(version, getattr(core, "GPT_PRETRAINED", {}).get("v2", {}))
    required_files = [pretrained.get(key) for key in ("gpt", "s2g", "s2d", "vocoder", "vocoder_config")]
    if any(not (Path(core.GPT_HF) / str(file_name)).exists() for file_name in required_files if file_name):
        return False
    if not install_deps:
        return True
    try:
        return bool(core.gpt_runtime_marker_ready(core.GPT_RUNTIME_MARKER, core.GPT_REQUIREMENTS_STAMP, core.gpt_sovits_device(), py=core.gpt_conda_python_path()))
    except Exception:
        return False


def omni_assets_ready(core: Any, install_deps: bool) -> bool:
    if not (Path(core.OMNI_REPO) / ".git").exists() or not Path(core.OMNI_HF).exists():
        return False
    if not install_deps:
        return True
    py = Path(core.omnivoice_uv_python())
    marker = Path(core.OMNI_REPO) / ".venv" / ".omnivoice_uv_sync_ok"
    ready_modules = ["torch", "torchaudio", "omnivoice", "accelerate", "webdataset"]
    try:
        return py.exists() and core.deps_marker_ready(marker, core.OMNI_OFFICIAL_DEPS_STAMP, "uv") and core.python_modules_ready(py, ready_modules)
    except Exception:
        return False


def ensure_gpt_sovits_repo_layout(core: Any, log: LogFn) -> None:
    repo = Path(core.GPT_REPO)
    hf = Path(core.GPT_HF)
    official_dir = repo / "GPT_SoVITS" / "pretrained_models"
    expected_files = [
        ("s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt", "s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt"),
        ("s1v3.ckpt", "s1v3.ckpt"),
        ("s2G488k.pth", "s2G488k.pth"),
        ("s2D488k.pth", "s2D488k.pth"),
        ("s2Gv3.pth", "s2Gv3.pth"),
        ("sv/pretrained_eres2netv2w24s4ep4.ckpt", "sv/pretrained_eres2netv2w24s4ep4.ckpt"),
    ]
    expected_dirs = [
        "chinese-hubert-base",
        "chinese-roberta-wwm-ext-large",
        "gsv-v2final-pretrained",
        "gsv-v4-pretrained",
        "models--nvidia--bigvgan_v2_24khz_100band_256x",
        "v2Pro",
    ]
    for relative_target, relative_source in expected_files:
        target = official_dir / relative_target
        source = hf / relative_source
        if target.exists() or not source.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        link_or_copy_file(source, target, log)
    for relative_dir in expected_dirs:
        target_dir = official_dir / relative_dir
        source_dir = hf / relative_dir
        if target_dir.exists() or not source_dir.exists():
            continue
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        link_or_copy_dir(source_dir, target_dir, log)
    fast_langdetect = official_dir / "fast_langdetect"
    if not fast_langdetect.exists():
        fast_langdetect.mkdir(parents=True, exist_ok=True)
        log(f"[voice assets] prepared GPT-SoVITS cache directory: {fast_langdetect}")


def link_or_copy_file(source: Path, target: Path, log: LogFn) -> None:
    try:
        os.link(source, target)
        log(f"[voice assets] linked GPT-SoVITS pretrained file: {target}")
        return
    except Exception:
        shutil.copy2(source, target)
        log(f"[voice assets] copied GPT-SoVITS pretrained file: {target}")


def link_or_copy_dir(source: Path, target: Path, log: LogFn) -> None:
    if os.name == "nt":
        completed = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(target), str(source)],
            cwd=str(target.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if completed.returncode == 0 and target.exists():
            log(f"[voice assets] linked GPT-SoVITS pretrained directory: {target}")
            return
    try:
        os.symlink(source, target, target_is_directory=True)
        log(f"[voice assets] linked GPT-SoVITS pretrained directory: {target}")
        return
    except Exception:
        shutil.copytree(source, target)
        log(f"[voice assets] copied GPT-SoVITS pretrained directory: {target}")
