from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import time
from pathlib import Path
from typing import Any, Callable

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from backend.voice_assets import DEFAULT_TOOL_ROOT, ensure_voice_assets, resolve_gpt_weights
from backend.voice_console import VoiceConsole
from backend.voice_manifests import InferenceManifestInput, InferenceManifestWriter

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WAV QC Studio voice inference bridge")
    sub = parser.add_subparsers(dest="command", required=True)
    infer = sub.add_parser("infer")
    infer.add_argument("--model", choices=["gpt-sovits", "omnivoice"], required=True)
    infer.add_argument("--tool-root", default=str(DEFAULT_TOOL_ROOT))
    infer.add_argument("--reference-audio", required=True)
    infer.add_argument("--reference-text", default="")
    infer.add_argument("--text", required=True)
    infer.add_argument("--output-dir", required=True)
    infer.add_argument("--manifest", required=True)
    infer.add_argument("--log", required=True)
    infer.add_argument("--model-name", default="voice_inference")
    infer.add_argument("--gpu", default="0")
    infer.add_argument("--idle-timeout", type=int, default=900)
    infer.add_argument("--cancel-file", default="")

    infer.add_argument("--gpt-version", default="v2")
    infer.add_argument("--gpt-mode", choices=["zero-shot", "checkpoint"], default="zero-shot")
    infer.add_argument("--gpt-sovits-path", default="")
    infer.add_argument("--gpt-gpt-path", default="")
    infer.add_argument("--gpt-text-language", default="ko")
    infer.add_argument("--gpt-prompt-language", default="ko")
    infer.add_argument("--gpt-top-k", type=int, default=15)
    infer.add_argument("--gpt-top-p", type=float, default=1.0)
    infer.add_argument("--gpt-temperature", type=float, default=1.0)
    infer.add_argument("--gpt-text-split-method", default="cut5")
    infer.add_argument("--gpt-batch-size", type=int, default=1)
    infer.add_argument("--gpt-batch-threshold", type=float, default=0.75)
    infer.add_argument("--gpt-split-bucket", default="true")
    infer.add_argument("--gpt-speed-factor", type=float, default=1.0)
    infer.add_argument("--gpt-fragment-interval", type=float, default=0.3)
    infer.add_argument("--gpt-seed", type=int, default=-1)
    infer.add_argument("--gpt-parallel-infer", default="true")
    infer.add_argument("--gpt-repetition-penalty", type=float, default=1.35)
    infer.add_argument("--gpt-sample-steps", type=int, default=32)
    infer.add_argument("--gpt-super-sampling", default="false")
    infer.add_argument("--gpt-overlap-length", type=int, default=2)
    infer.add_argument("--gpt-min-chunk-length", type=int, default=16)

    infer.add_argument("--omni-mode", choices=["zero-shot", "checkpoint"], default="zero-shot")
    infer.add_argument("--omni-checkpoint-path", default="")
    infer.add_argument("--omni-language", default="ko")
    infer.add_argument("--omni-instruct", default="")
    infer.add_argument("--omni-num-step", type=int, default=32)
    infer.add_argument("--omni-guidance-scale", type=float, default=2.0)
    infer.add_argument("--omni-speed", type=float, default=1.0)
    infer.add_argument("--omni-duration", type=float, default=None)
    infer.add_argument("--omni-t-shift", type=float, default=0.1)
    infer.add_argument("--omni-denoise", default="true")
    infer.add_argument("--omni-postprocess-output", default="true")
    infer.add_argument("--omni-layer-penalty-factor", type=float, default=5.0)
    infer.add_argument("--omni-position-temperature", type=float, default=5.0)
    infer.add_argument("--omni-class-temperature", type=float, default=0.0)

    args = parser.parse_args(argv)
    return run_inference(args)


def run_inference(args: argparse.Namespace) -> int:
    log_path = Path(args.log)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", buffering=1) as log_file:
        console = VoiceConsole(log_file)

        manifest = InferenceManifestWriter(
            Path(args.manifest),
            Path(args.output_dir),
            InferenceManifestInput(
                model=args.model,
                model_name=args.model_name,
                mode=infer_mode(args),
                reference_audio=Path(args.reference_audio),
                reference_text=args.reference_text,
                output_text=args.text,
            ),
        )
        try:
            console.banner("Voice inference")
            console.kv("Python", sys.executable)
            console.kv("Working directory", Path.cwd())
            console.kv("Model", args.model)
            console.kv("Mode", infer_mode(args))
            console.kv("Reference audio", Path(args.reference_audio))
            console.kv("Output folder", Path(args.output_dir))
            console.kv("Manifest", Path(args.manifest))
            console.kv("Log file", log_path)
            console.kv("GPU", args.gpu)
            console.kv("Idle timeout", f"{args.idle_timeout}s")
            check_cancel(args.cancel_file)
            output_dir = Path(args.output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            output_audio = output_dir / f"{safe_name(args.model_name)}_{int(time.time())}.wav"
            manifest.emit("prepare", "running", "Preparing official inference command")
            if args.model == "gpt-sovits":
                run_gpt_sovits(args, output_audio, console)
            else:
                run_omnivoice(args, output_audio, console)
            manifest.emit("infer", "completed", "Inference completed", output_audio=output_audio)
            console.section("Inference finished")
            console.kv("Output audio", output_audio)
            console.kv("Exit code", 0)
            console.status("completed", "Inference command completed")
            return 0
        except Exception as exc:
            console.error(exc)
            manifest.emit("infer", "failed", str(exc), failed=True)
            return 1


def run_gpt_sovits(args: argparse.Namespace, output_audio: Path, console: VoiceConsole) -> None:
    console.section("Runtime setup")
    assets = ensure_voice_assets("gpt-sovits", args.tool_root, log=console.log, install_deps=True, gpt_version=args.gpt_version)
    tool_root = assets.tool_root
    repo = assets.repo
    python = assets.python if assets.python.exists() else Path(sys.executable)
    weights = resolve_gpt_weights(assets.core, args.gpt_version, args.gpt_mode, args.gpt_gpt_path, args.gpt_sovits_path)
    console.kv("Tool root", tool_root)
    console.kv("Repository", repo)
    console.kv("Runtime Python", python)
    console.kv("GPT version", args.gpt_version)
    console.kv("GPT weights", weights["gpt"])
    console.kv("SoVITS weights", weights["sovits"])
    script = textwrap.dedent(
        """
        import json
        import os
        import sys
        from pathlib import Path

        import soundfile as sf
        import yaml

        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        repo = Path(payload["repo"])
        os.chdir(repo)
        sys.path.insert(0, str(repo / "GPT_SoVITS"))
        sys.path.insert(0, str(repo))
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

        config_path = Path(payload["config_path"])
        config = {
            "custom": {
                "bert_base_path": payload["bert_base_path"],
                "cnhuhbert_base_path": payload["cnhuhbert_base_path"],
                "device": payload["device"],
                "is_half": payload["is_half"],
                "version": payload["version"],
                "t2s_weights_path": payload["gpt_path"],
                "vits_weights_path": payload["sovits_path"],
            }
        }
        config_path.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
        tts = TTS(TTS_Config(str(config_path)))
        req = payload["request"]
        sr, audio = next(tts.run(req))
        sf.write(payload["output"], audio, sr)
        """
    )
    with tempfile.TemporaryDirectory(prefix="gsv_infer_") as tmp:
        tmp_path = Path(tmp)
        script_path = tmp_path / "run_gsv_infer.py"
        payload_path = tmp_path / "payload.json"
        config_path = tmp_path / "tts_infer.yaml"
        script_path.write_text(script, encoding="utf-8")
        payload = {
            "repo": str(repo),
            "config_path": str(config_path),
            "device": "cuda" if args.gpu.strip().lower() not in {"", "cpu", "-1"} else "cpu",
            "is_half": args.gpu.strip().lower() not in {"", "cpu", "-1"},
            "version": args.gpt_version,
            "gpt_path": str(weights["gpt"]),
            "sovits_path": str(weights["sovits"]),
            "bert_base_path": str(tool_root / "vendor" / "hf" / "GPT-SoVITS" / "chinese-roberta-wwm-ext-large"),
            "cnhuhbert_base_path": str(tool_root / "vendor" / "hf" / "GPT-SoVITS" / "chinese-hubert-base"),
            "output": str(output_audio.resolve()),
            "request": {
                "text": args.text,
                "text_lang": args.gpt_text_language,
                "ref_audio_path": str(Path(args.reference_audio).resolve()),
                "prompt_text": args.reference_text,
                "prompt_lang": args.gpt_prompt_language,
                "top_k": args.gpt_top_k,
                "top_p": args.gpt_top_p,
                "temperature": args.gpt_temperature,
                "text_split_method": args.gpt_text_split_method,
                "batch_size": args.gpt_batch_size,
                "batch_threshold": args.gpt_batch_threshold,
                "split_bucket": bool_arg(args.gpt_split_bucket),
                "speed_factor": args.gpt_speed_factor,
                "fragment_interval": args.gpt_fragment_interval,
                "seed": args.gpt_seed,
                "media_type": "wav",
                "streaming_mode": False,
                "parallel_infer": bool_arg(args.gpt_parallel_infer),
                "repetition_penalty": args.gpt_repetition_penalty,
                "sample_steps": args.gpt_sample_steps,
                "super_sampling": bool_arg(args.gpt_super_sampling),
                "overlap_length": args.gpt_overlap_length,
                "min_chunk_length": args.gpt_min_chunk_length,
            },
        }
        payload_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        console.section("Official GPT-SoVITS inference")
        run_subprocess([str(python), str(script_path), str(payload_path)], repo, console.log, args.idle_timeout)


def run_omnivoice(args: argparse.Namespace, output_audio: Path, console: VoiceConsole) -> None:
    console.section("Runtime setup")
    assets = ensure_voice_assets("omnivoice", args.tool_root, log=console.log, install_deps=True)
    tool_root = assets.tool_root
    repo = assets.repo
    python = assets.python if assets.python.exists() else Path(sys.executable)
    model_path = Path(args.omni_checkpoint_path).resolve() if args.omni_mode == "checkpoint" and args.omni_checkpoint_path else tool_root / "vendor" / "hf" / "OmniVoice"
    console.kv("Tool root", tool_root)
    console.kv("Repository", repo)
    console.kv("Runtime Python", python)
    console.kv("Model path", model_path)
    cmd = [
        str(python),
        "-m",
        "omnivoice.cli.infer",
        "--model",
        str(model_path),
        "--text",
        args.text,
        "--output",
        str(output_audio.resolve()),
        "--ref_audio",
        str(Path(args.reference_audio).resolve()),
        "--ref_text",
        args.reference_text,
        "--language",
        args.omni_language,
        "--num_step",
        str(args.omni_num_step),
        "--guidance_scale",
        str(args.omni_guidance_scale),
        "--speed",
        str(args.omni_speed),
        "--t_shift",
        str(args.omni_t_shift),
        "--denoise",
        str(bool_arg(args.omni_denoise)),
        "--postprocess_output",
        str(bool_arg(args.omni_postprocess_output)),
        "--layer_penalty_factor",
        str(args.omni_layer_penalty_factor),
        "--position_temperature",
        str(args.omni_position_temperature),
        "--class_temperature",
        str(args.omni_class_temperature),
    ]
    if args.omni_instruct:
        cmd.extend(["--instruct", args.omni_instruct])
    if args.omni_duration is not None:
        cmd.extend(["--duration", str(args.omni_duration)])
    if args.gpu.strip().lower() in {"cpu", "-1"}:
        cmd.extend(["--device", "cpu"])
    console.section("Official OmniVoice inference")
    run_subprocess(cmd, repo, console.log, args.idle_timeout)

def run_subprocess(cmd: list[str], cwd: Path, log: Callable[[str], None], timeout: int) -> None:
    log("> " + " ".join(quote(item) for item in cmd))
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONPATH"] = str(cwd) + os.pathsep + env.get("PYTHONPATH", "")
    completed = subprocess.run(cmd, cwd=str(cwd), env=env, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=timeout)
    if completed.stdout:
        log(completed.stdout.rstrip())
    if completed.stderr:
        log(completed.stderr.rstrip())
    if completed.returncode != 0:
        raise RuntimeError(f"Official inference command failed with exit code {completed.returncode}")


def infer_mode(args: argparse.Namespace) -> str:
    if args.model == "gpt-sovits":
        return args.gpt_mode
    return args.omni_mode


def check_cancel(cancel_file: str) -> None:
    if cancel_file and Path(cancel_file).exists():
        raise RuntimeError("Inference was cancelled before it started.")


def bool_arg(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def safe_name(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value.strip())
    return cleaned.strip("._")[:80] or "voice_inference"


def quote(value: str) -> str:
    return value if value and all(ch.isalnum() or ch in "._-:/\\" for ch in value) else '"' + value.replace('"', '""') + '"'


if __name__ == "__main__":
    raise SystemExit(main())
