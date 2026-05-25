from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from backend.voice_assets import DEFAULT_TOOL_ROOT, ensure_voice_assets
from backend.voice_console import VoiceConsole
from backend.voice_manifests import TrainingManifestWriter
from backend.training.checkpoint_selection import (
    emit_checkpoints,
    gpt_resume_checkpoint_exists,
    model_name_exists,
    omni_resume_checkpoint_exists,
    resume_checkpoint_exists,
)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WAV QC Studio voice training bridge")
    sub = parser.add_subparsers(dest="command", required=True)
    train = sub.add_parser("train")
    train.add_argument("--model", choices=["gpt-sovits", "omnivoice"], required=True)
    train.add_argument("--tool-root", default=str(DEFAULT_TOOL_ROOT))
    train.add_argument("--input", required=True)
    train.add_argument("--output-dir", required=True)
    train.add_argument("--manifest", required=True)
    train.add_argument("--log", required=True)
    train.add_argument("--model-name", required=True)
    train.add_argument("--run-mode", choices=["auto", "new", "resume"], default="auto")
    train.add_argument("--gpu", default="0")
    train.add_argument("--idle-timeout", type=int, default=900)
    train.add_argument("--cancel-file", default="")

    train.add_argument("--gpt-version", default="v2")
    train.add_argument("--gpt-sovits-batch-size", type=int, default=4)
    train.add_argument("--gpt-sovits-epochs", type=int, default=8)
    train.add_argument("--gpt-sovits-save-every-epoch", type=int, default=4)
    train.add_argument("--gpt-text-low-lr-rate", type=float, default=0.4)
    train.add_argument("--gpt-sovits-save-latest", default="true")
    train.add_argument("--gpt-sovits-save-every-weights", default="true")
    train.add_argument("--gpt-grad-checkpoint", default="false")
    train.add_argument("--gpt-lora-rank", type=int, default=32)
    train.add_argument("--gpt-pretrained-s2g", default=None)
    train.add_argument("--gpt-pretrained-s2d", default=None)
    train.add_argument("--gpt-resume-sovits-path", default=None)
    train.add_argument("--gpt-resume-gpt-path", default=None)
    train.add_argument("--gpt-batch-size", type=int, default=4)
    train.add_argument("--gpt-epochs", type=int, default=15)
    train.add_argument("--gpt-save-every-epoch", type=int, default=5)
    train.add_argument("--gpt-save-latest", default="true")
    train.add_argument("--gpt-save-every-weights", default="true")
    train.add_argument("--gpt-dpo", default="false")
    train.add_argument("--gpt-pretrained-s1", default=None)

    train.add_argument("--omni-steps", type=int, default=5000)
    train.add_argument("--omni-save-steps", type=int, default=500)
    train.add_argument("--omni-logging-steps", type=int, default=50)
    train.add_argument("--omni-learning-rate", type=float, default=1e-5)
    train.add_argument("--omni-batch-tokens", type=int, default=8192)
    train.add_argument("--omni-gradient-accumulation-steps", type=int, default=1)
    train.add_argument("--omni-num-workers", type=int, default=2)
    train.add_argument("--omni-mixed-precision", default="bf16")
    train.add_argument("--omni-seed", type=int, default=42)
    train.add_argument("--omni-max-batch-size", type=int, default=4)
    train.add_argument("--omni-max-sample-tokens", type=int, default=2000)
    train.add_argument("--omni-min-sample-tokens", type=int, default=1)
    train.add_argument("--omni-llm-name-or-path", default=None)
    train.add_argument("--omni-init-from-checkpoint", default=None)
    train.add_argument("--omni-resume-from-checkpoint", default=None)
    train.add_argument("--omni-use-deepspeed", default="false")
    train.add_argument("--omni-deepspeed-config", default=None)
    train.add_argument("--omni-model-only-checkpoint", default="false")

    args = parser.parse_args(argv)
    if args.command != "train":
        return 2
    return run_training(args)


def run_training(args: argparse.Namespace) -> int:
    log_path = Path(args.log)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", buffering=1) as log_file:
        console = VoiceConsole(log_file)
        log = console.log
        manifest: TrainingManifestWriter | None = None

        try:
            console.banner("Voice training")
            console.kv("Python", sys.executable)
            console.kv("Working directory", Path.cwd())
            console.kv("Dataset", Path(args.input))
            console.kv("Output folder", Path(args.output_dir))
            console.kv("Manifest", Path(args.manifest))
            console.kv("Log file", log_path)
            console.kv("Model", args.model)
            console.kv("GPU", args.gpu)
            console.kv("Idle timeout", f"{args.idle_timeout}s")
            console.section("Runtime setup")
            tool_root = Path(args.tool_root)
            assets = ensure_voice_assets(args.model, tool_root, log=log, install_deps=True, gpt_version=args.gpt_version)
            core = assets.core
            requested_run_mode = args.run_mode
            model_name, resolved_run_mode = resolve_training_target(
                core,
                args.model,
                args.model_name,
                args.run_mode,
                gpt_version=args.gpt_version,
                gpt_resume_sovits_path=args.gpt_resume_sovits_path or None,
                gpt_resume_sovits_d_path=args.gpt_pretrained_s2d or None,
                gpt_resume_gpt_path=args.gpt_resume_gpt_path or None,
                omni_resume_from_checkpoint=args.omni_resume_from_checkpoint or None,
            )
            args.run_mode = resolved_run_mode
            total_units = 3 if args.model == "gpt-sovits" else 2
            manifest = TrainingManifestWriter(Path(args.manifest), Path(args.output_dir), Path(args.input), args.model, model_name, total_units)
            console.section("Training target")
            console.kv("Tool root", assets.tool_root)
            console.kv("Repository", assets.repo)
            console.kv("Runtime Python", assets.python)
            console.kv("Requested mode", requested_run_mode)
            console.kv("Resolved mode", args.run_mode)
            console.kv("Model name", model_name)
            check_cancel(args.cancel_file)

            if args.model == "gpt-sovits":
                run_gpt_training(args, core, manifest, model_name, console)
            else:
                run_omni_training(args, core, manifest, model_name, console)

            console.section("Training finished")
            console.kv("Exit code", 0)
            console.status("completed", "Training command completed")
            return 0
        except Exception as exc:
            console.error(exc)
            if manifest is not None:
                try:
                    manifest.emit("failed", "failed", str(exc), failed=True)
                except Exception:
                    pass
            return 1


def run_gpt_training(args: argparse.Namespace, core: Any, manifest: TrainingManifestWriter, model_name: str, console: VoiceConsole) -> None:
    log = console.log
    version = args.gpt_version
    sovits_options = {
        "batch_size": args.gpt_sovits_batch_size,
        "epochs": args.gpt_sovits_epochs,
        "text_low_lr_rate": args.gpt_text_low_lr_rate,
        "if_save_latest": bool_arg(args.gpt_sovits_save_latest),
        "if_save_every_weights": bool_arg(args.gpt_sovits_save_every_weights),
        "save_every_epoch": args.gpt_sovits_save_every_epoch,
        "grad_ckpt": bool_arg(args.gpt_grad_checkpoint),
        "lora_rank": args.gpt_lora_rank,
        "pretrained_s2g": args.gpt_pretrained_s2g or None,
        "pretrained_s2d": args.gpt_pretrained_s2d or None,
    }
    gpt_options = {
        "batch_size": args.gpt_batch_size,
        "epochs": args.gpt_epochs,
        "save_every_epoch": args.gpt_save_every_epoch,
        "if_save_latest": bool_arg(args.gpt_save_latest),
        "if_save_every_weights": bool_arg(args.gpt_save_every_weights),
        "if_dpo": bool_arg(args.gpt_dpo),
        "pretrained_s1": args.gpt_pretrained_s1 or None,
    }

    resume_sovits_path = args.gpt_resume_sovits_path or None
    resume_sovits_d_path = args.gpt_pretrained_s2d or None
    resume_gpt_path = args.gpt_resume_gpt_path or None

    if args.run_mode == "resume" and not gpt_resume_checkpoint_exists(core, model_name, version, resume_sovits_path, resume_gpt_path, resume_sovits_d_path):
        console.status("resume", f"No GPT-SoVITS resume checkpoint found for {model_name}; starting a new training run with the same model name.")
        args.run_mode = "new"

    if args.run_mode == "resume":
        if resume_sovits_path:
            sovits_options["pretrained_s2g"] = resume_sovits_path
        if resume_gpt_path:
            gpt_options["pretrained_s1"] = resume_gpt_path
        console.section("GPT-SoVITS resume")
        console.kv("Version", version)
        console.kv("Target epoch", max(int(args.gpt_sovits_epochs), int(args.gpt_epochs)))
        manifest.emit("resume", "running", "Resuming GPT-SoVITS training")
        result = core.resume_gpt_to_epoch(
            exp_name=model_name,
            version=version,
            target_epoch=max(int(args.gpt_sovits_epochs), int(args.gpt_epochs)),
            gpu=args.gpu,
            sovits_options=sovits_options,
            gpt_options=gpt_options,
            resume_sovits_path=resume_sovits_path,
            resume_gpt_path=resume_gpt_path,
            log=log,
            idle_timeout=args.idle_timeout,
        )
        manifest.emit("resume", "completed", "Resume command completed", complete_unit=True)
        emit_checkpoints(manifest, "SoVITS", result.sovits_checkpoints, model_name)
        emit_checkpoints(manifest, "GPT", result.gpt_checkpoints, model_name)
        console.kv("SoVITS checkpoints", len(result.sovits_checkpoints))
        console.kv("GPT checkpoints", len(result.gpt_checkpoints))
        return

    console.section("GPT-SoVITS preprocess")
    console.kv("Version", version)
    manifest.emit("preprocess", "running", "Preparing text, SSL, Hubert and semantic tokens")
    exp_dir, _name2text, _semantic = core.run_gpt_preprocess(
        Path(args.input),
        exp_name=model_name,
        version=version,
        gpu=args.gpu,
        log=log,
        idle_timeout=args.idle_timeout,
    )
    manifest.emit("preprocess", "completed", str(exp_dir), complete_unit=True)
    console.kv("Experiment folder", exp_dir)

    console.section("SoVITS training")
    console.kv("Epochs", args.gpt_sovits_epochs)
    console.kv("Batch size", args.gpt_sovits_batch_size)
    console.kv("Save every epoch", args.gpt_sovits_save_every_epoch)
    manifest.emit("sovits", "running", f"SoVITS training for {args.gpt_sovits_epochs} epoch(s)")
    sovits_ckpts = core.train_sovits(
        exp_name=model_name,
        version=version,
        gpu=args.gpu,
        log=log,
        idle_timeout=args.idle_timeout,
        **sovits_options,
    )
    manifest.emit("sovits", "completed", "SoVITS training completed", complete_unit=True)
    emit_checkpoints(manifest, "SoVITS", sovits_ckpts, model_name)
    console.kv("Saved checkpoints", len(sovits_ckpts))

    console.section("GPT training")
    console.kv("Epochs", args.gpt_epochs)
    console.kv("Batch size", args.gpt_batch_size)
    console.kv("Save every epoch", args.gpt_save_every_epoch)
    manifest.emit("gpt", "running", f"GPT training for {args.gpt_epochs} epoch(s)")
    gpt_ckpts = core.train_gpt(
        exp_name=model_name,
        version=version,
        gpu=args.gpu,
        log=log,
        idle_timeout=args.idle_timeout,
        **gpt_options,
    )
    manifest.emit("gpt", "completed", "GPT training completed", complete_unit=True)
    emit_checkpoints(manifest, "GPT", gpt_ckpts, model_name)
    console.kv("Saved checkpoints", len(gpt_ckpts))


def run_omni_training(args: argparse.Namespace, core: Any, manifest: TrainingManifestWriter, model_name: str, console: VoiceConsole) -> None:
    log = console.log
    train_options = {
        "steps": args.omni_steps,
        "save_steps": args.omni_save_steps,
        "logging_steps": args.omni_logging_steps,
        "learning_rate": args.omni_learning_rate,
        "batch_tokens": args.omni_batch_tokens,
        "gradient_accumulation_steps": args.omni_gradient_accumulation_steps,
        "num_workers": args.omni_num_workers,
        "mixed_precision": args.omni_mixed_precision,
        "seed": args.omni_seed,
        "max_batch_size": args.omni_max_batch_size,
        "max_sample_tokens": args.omni_max_sample_tokens,
        "min_sample_tokens": args.omni_min_sample_tokens,
        "llm_name_or_path": args.omni_llm_name_or_path or None,
        "init_from_checkpoint": args.omni_init_from_checkpoint or None,
        "resume_from_checkpoint": args.omni_resume_from_checkpoint or None,
        "use_deepspeed": bool_arg(args.omni_use_deepspeed),
        "deepspeed_config": args.omni_deepspeed_config or None,
    }

    if args.run_mode == "resume" and not omni_resume_checkpoint_exists(core, model_name, args.omni_resume_from_checkpoint or None):
        console.status("resume", f"No OmniVoice resume checkpoint found for {model_name}; starting a new training run with the same model name.")
        args.run_mode = "new"
        train_options["resume_from_checkpoint"] = None

    if args.run_mode == "resume":
        console.section("OmniVoice resume")
        console.kv("Target steps", args.omni_steps)
        console.kv("Resume checkpoint", args.omni_resume_from_checkpoint or "-")
        manifest.emit("resume", "running", "Resuming OmniVoice training")
        ckpts = core.resume_omnivoice_to_step(
            Path(args.input),
            exp_name=model_name,
            target_step=args.omni_steps,
            gpu=args.gpu,
            train_options=train_options,
            log=log,
            idle_timeout=args.idle_timeout,
            model_only_checkpoint=bool_arg(args.omni_model_only_checkpoint),
        )
        manifest.emit("resume", "completed", "Resume command completed", complete_unit=True)
        emit_checkpoints(manifest, "OmniVoice", ckpts, model_name)
        console.kv("Saved checkpoints", len(ckpts))
        return

    console.section("OmniVoice token extraction")
    console.kv("Dataset", Path(args.input))
    manifest.emit("tokens", "running", "Extracting OmniVoice audio tokens")
    manifest_path = core.prepare_omnivoice_tokens(
        Path(args.input),
        exp_name=model_name,
        gpu=args.gpu,
        log=log,
        idle_timeout=args.idle_timeout,
    )
    manifest.emit("tokens", "completed", str(manifest_path), complete_unit=True)
    console.kv("Token manifest", manifest_path)

    console.section("OmniVoice training")
    console.kv("Steps", args.omni_steps)
    console.kv("Save steps", args.omni_save_steps)
    console.kv("Batch tokens", args.omni_batch_tokens)
    manifest.emit("train", "running", f"OmniVoice training for {args.omni_steps} step(s)")
    ckpts = core.train_omnivoice(
        manifest_path,
        exp_name=model_name,
        steps=args.omni_steps,
        gpu=args.gpu,
        train_options=train_options,
        log=log,
        idle_timeout=args.idle_timeout,
        model_only_checkpoint=bool_arg(args.omni_model_only_checkpoint),
    )
    manifest.emit("train", "completed", "OmniVoice training completed", complete_unit=True)
    emit_checkpoints(manifest, "OmniVoice", ckpts, model_name)
    console.kv("Saved checkpoints", len(ckpts))

def resolve_training_target(
    core: Any,
    model_type: str,
    requested_name: str,
    run_mode: str,
    gpt_version: str = "v2",
    gpt_resume_sovits_path: str | None = None,
    gpt_resume_sovits_d_path: str | None = None,
    gpt_resume_gpt_path: str | None = None,
    omni_resume_from_checkpoint: str | None = None,
) -> tuple[str, str]:
    base = sanitize_model_name(requested_name)
    if run_mode == "auto":
        return base, "resume" if resume_checkpoint_exists(core, model_type, base, gpt_version, gpt_resume_sovits_path, gpt_resume_gpt_path, gpt_resume_sovits_d_path, omni_resume_from_checkpoint) else "new"
    if run_mode == "resume":
        return base, "resume"

    counter = 1
    candidate = base
    while model_name_exists(core, model_type, candidate):
        counter += 1
        candidate = f"{base}_{counter}"
    return candidate, "new"


def check_cancel(cancel_file: str) -> None:
    if cancel_file and Path(cancel_file).exists():
        raise RuntimeError("Training was cancelled before it started.")


def bool_arg(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def sanitize_model_name(value: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", value.strip())
    cleaned = re.sub(r"\s+", "_", cleaned).strip("._")
    return cleaned[:80] or "training"


if __name__ == "__main__":
    raise SystemExit(main())
