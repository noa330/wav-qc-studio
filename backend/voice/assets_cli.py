from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[2]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from backend.voice.assets import (
    DEFAULT_TOOL_ROOT,
    ensure_voice_assets,
    load_training_core,
)
from backend.voice.console import VoiceConsole

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WAV QC Studio voice model runtime setup")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check")
    add_common_args(check)

    prepare = sub.add_parser("prepare")
    add_common_args(prepare)
    prepare.add_argument("--log", required=True)

    args = parser.parse_args(argv)
    if args.command == "check":
        return check_assets(args)
    if args.command == "prepare":
        return prepare_assets(args)
    return 2


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--model", choices=["gpt-sovits", "omnivoice"], required=True)
    parser.add_argument("--tool-root", default=str(DEFAULT_TOOL_ROOT))
    parser.add_argument("--gpt-version", default="v2")
    parser.add_argument("--skip-deps", action="store_true")


def check_assets(args: argparse.Namespace) -> int:
    try:
        print(json.dumps(inspect_assets(args), ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        payload = {
            "ok": False,
            "model": normalize_model(args.model),
            "label": model_label(args.model),
            "path": str(Path(args.tool_root).resolve()),
            "error": str(exc),
        }
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        return 1


def prepare_assets(args: argparse.Namespace) -> int:
    log_path = Path(args.log)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", buffering=1) as log_file:
        console = VoiceConsole(log_file)
        try:
            console.banner("Voice model setup")
            console.kv("Python", sys.executable)
            console.kv("Working directory", Path.cwd())
            console.kv("Tool root", Path(args.tool_root).resolve())
            console.kv("Model", model_label(args.model))
            if normalize_model(args.model) == "gpt-sovits":
                console.kv("GPT version", args.gpt_version)
            console.section("Runtime setup")
            assets = ensure_voice_assets(
                normalize_model(args.model),
                args.tool_root,
                log=console.log,
                install_deps=not args.skip_deps,
                gpt_version=args.gpt_version,
            )
            console.section("Voice model ready")
            console.kv("Repository", assets.repo)
            console.kv("Model cache", assets.hf_root)
            console.kv("Runtime Python", assets.python)
            console.status("completed", f"{model_label(args.model)} setup completed")
            return 0
        except Exception as exc:
            console.error(exc)
            return 1


def inspect_assets(args: argparse.Namespace) -> dict[str, Any]:
    model = normalize_model(args.model)
    tool_root = Path(args.tool_root).resolve()
    core = load_training_core(tool_root)
    install_deps = not args.skip_deps

    if model == "gpt-sovits":
        missing = gpt_missing_items(core, args.gpt_version, install_deps)
        return {
            "ok": len(missing) == 0,
            "model": model,
            "label": model_label(model),
            "toolRoot": str(tool_root),
            "path": str(Path(core.GPT_REPO)),
            "runtimePython": str(core.gpt_conda_python_path()),
            "gptVersion": args.gpt_version,
            "missing": missing,
        }

    missing = omni_missing_items(core, install_deps)
    return {
        "ok": len(missing) == 0,
        "model": model,
        "label": model_label(model),
        "toolRoot": str(tool_root),
        "path": str(Path(core.OMNI_REPO)),
        "runtimePython": str(core.omnivoice_uv_python()),
        "missing": missing,
    }


def gpt_missing_items(core: Any, version: str, install_deps: bool) -> list[str]:
    missing: list[str] = []
    if not (Path(core.GPT_REPO) / ".git").exists():
        missing.append("GPT-SoVITS repository")
    if not Path(core.GPT_HF).exists():
        missing.append("GPT-SoVITS model cache")
    pretrained = getattr(core, "GPT_PRETRAINED", {}).get(version, getattr(core, "GPT_PRETRAINED", {}).get("v2", {}))
    for file_name in [pretrained.get("gpt"), pretrained.get("s2g"), pretrained.get("s2d")]:
        if file_name and not core.is_download_complete(Path(core.GPT_HF) / str(file_name), reject_git_lfs_pointer=True):
            missing.append(str(file_name))
    if install_deps:
        if not gpt_runtime_marker_quick_ready(core):
            missing.append("GPT-SoVITS runtime environment")
    return missing


def omni_missing_items(core: Any, install_deps: bool) -> list[str]:
    missing: list[str] = []
    if not (Path(core.OMNI_REPO) / ".git").exists():
        missing.append("OmniVoice repository")
    for path in [
        Path(core.OMNI_HF) / "config.json",
        Path(core.OMNI_HF) / "model.safetensors",
        Path(core.OMNI_HF) / "tokenizer.json",
        Path(core.OMNI_HF) / "audio_tokenizer",
    ]:
        if not path.exists():
            missing.append(str(path.relative_to(core.OMNI_HF) if Path(core.OMNI_HF).exists() else path))
    if install_deps:
        py = Path(core.omnivoice_uv_python())
        marker = Path(core.OMNI_REPO) / ".venv" / ".omnivoice_uv_sync_ok"
        if not py.exists() or not core.deps_marker_ready(marker, core.OMNI_OFFICIAL_DEPS_STAMP, "uv"):
            missing.append("OmniVoice uv environment")
    return missing


def gpt_runtime_marker_quick_ready(core: Any) -> bool:
    marker = Path(core.GPT_RUNTIME_MARKER)
    expected_python = Path(core.gpt_conda_python_path())
    if not expected_python.exists() or not core.deps_marker_ready(marker, core.GPT_REQUIREMENTS_STAMP, core.gpt_sovits_device()):
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return False
    return Path(str(data.get("python", ""))) == expected_python


def normalize_model(value: str) -> str:
    return "omnivoice" if value == "omnivoice" else "gpt-sovits"


def model_label(value: str) -> str:
    return "OmniVoice" if normalize_model(value) == "omnivoice" else "GPT-SoVITS"


if __name__ == "__main__":
    raise SystemExit(main())
