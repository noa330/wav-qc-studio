from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


def default_omnivoice_train_options(omni_hf: Path) -> dict[str, object]:
    return {
        "llm_name_or_path": "Qwen/Qwen3-0.6B",
        "init_from_checkpoint": str(omni_hf),
        "audio_vocab_size": 1025,
        "audio_mask_id": 1024,
        "num_audio_codebook": 8,
        "audio_codebook_weights": [8, 8, 6, 6, 4, 4, 2, 2],
        "drop_cond_ratio": 0.1,
        "prompt_ratio_range": [0.0, 0.3],
        "mask_ratio_range": [0.0, 1.0],
        "language_ratio": 0.8,
        "use_pinyin_ratio": 0.0,
        "instruct_ratio": 0.0,
        "only_instruct_ratio": 0.0,
        "resume_from_checkpoint": None,
        "learning_rate": 1e-5,
        "weight_decay": 0.01,
        "max_grad_norm": 1.0,
        "steps": 5000,
        "seed": 42,
        "lr_scheduler_type": "cosine",
        "warmup_type": "ratio",
        "warmup_ratio": 0.01,
        "warmup_steps": 0,
        "batch_tokens": 8192,
        "gradient_accumulation_steps": 1,
        "num_workers": 2,
        "mixed_precision": "bf16",
        "allow_tf32": True,
        "use_deepspeed": False,
        "deepspeed_config": None,
        "attn_implementation": "sdpa",
        "max_sample_tokens": 2000,
        "min_sample_tokens": 1,
        "max_batch_size": 4,
        "logging_steps": 50,
        "eval_steps": 500,
        "save_steps": 500,
        "keep_last_n_checkpoints": -1,
    }


def write_omnivoice_train_configs_file(
    *,
    manifest: Path,
    exp_name: str,
    work_dir: Path,
    omni_hf: Path,
    default_options: dict[str, object],
    train_options: Optional[dict] = None,
) -> tuple[Path, Path, Path]:
    cfg_dir = work_dir / "omnivoice" / exp_name / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    data_cfg = cfg_dir / "data_config.json"
    train_cfg = cfg_dir / "train_config.json"
    out_dir = work_dir / "omnivoice" / exp_name / "exp"
    options = dict(default_options)
    if train_options:
        options.update({k: v for k, v in train_options.items() if v != "" and k != "model_only_checkpoint"})
    if not options.get("llm_name_or_path"):
        options["llm_name_or_path"] = "Qwen/Qwen3-0.6B"
    if not options.get("init_from_checkpoint"):
        options["init_from_checkpoint"] = str(omni_hf)
    data_cfg.write_text(
        json.dumps({"train": [{"manifest_path": [str(manifest)]}], "dev": []}, indent=2),
        encoding="utf-8",
    )
    train_cfg.write_text(
        json.dumps(options, indent=2),
        encoding="utf-8",
    )
    return train_cfg, data_cfg, out_dir
