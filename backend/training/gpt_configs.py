from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .io import to_simple_yaml


def gpt_model_path_for(gpt_hf: Path, gpt_pretrained: dict[str, dict[str, str]], version: str, key: str) -> Path:
    rel = gpt_pretrained[version][key]
    return gpt_hf / rel


def write_sovits_config_file(
    *,
    gpt_repo: Path,
    gpt_hf: Path,
    work_dir: Path,
    gpt_pretrained: dict[str, dict[str, str]],
    exp_name: str,
    version: str,
    batch_size: int,
    epochs: int,
    gpu: str,
    text_low_lr_rate: float = 0.4,
    if_save_latest: bool = False,
    if_save_every_weights: bool = True,
    save_every_epoch: int = 1,
    grad_ckpt: bool = False,
    lora_rank: int = 16,
    pretrained_s2g: Optional[str] = None,
    pretrained_s2d: Optional[str] = None,
) -> Path:
    source = gpt_repo / gpt_pretrained[version]["s2_config"]
    data = json.loads(source.read_text(encoding="utf-8"))
    exp_dir = gpt_repo / "logs" / exp_name
    (exp_dir / f"logs_s2_{version}").mkdir(parents=True, exist_ok=True)
    data["train"]["batch_size"] = max(1, int(batch_size))
    data["train"]["epochs"] = max(1, int(epochs))
    data["train"]["text_low_lr_rate"] = float(text_low_lr_rate)
    data["train"]["pretrained_s2G"] = pretrained_s2g or str(gpt_model_path_for(gpt_hf, gpt_pretrained, version, "s2g"))
    data["train"]["pretrained_s2D"] = pretrained_s2d or str(gpt_model_path_for(gpt_hf, gpt_pretrained, version, "s2d"))
    data["train"]["if_save_latest"] = bool(if_save_latest)
    data["train"]["if_save_every_weights"] = bool(if_save_every_weights)
    data["train"]["save_every_epoch"] = max(1, int(save_every_epoch))
    data["train"]["gpu_numbers"] = gpu
    data["train"]["grad_ckpt"] = bool(grad_ckpt)
    data["train"]["lora_rank"] = max(1, int(lora_rank))
    data["model"]["version"] = version
    data["data"]["exp_dir"] = str(exp_dir)
    data["s2_ckpt_dir"] = str(exp_dir)
    save_weight_dir = gpt_repo / (f"SoVITS_weights_{version}" if version != "v1" else "SoVITS_weights")
    save_weight_dir.mkdir(parents=True, exist_ok=True)
    data["save_weight_dir"] = str(save_weight_dir)
    data["name"] = exp_name
    data["version"] = version
    out = work_dir / "gpt_sovits" / exp_name / f"tmp_s2_{version}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def write_gpt_config_file(
    *,
    gpt_repo: Path,
    work_dir: Path,
    exp_name: str,
    version: str,
    batch_size: int,
    epochs: int,
) -> Path:
    data = {
        "train": {
            "seed": 1234,
            "epochs": 20,
            "batch_size": 8,
            "save_every_n_epoch": 1,
            "precision": "16-mixed",
            "gradient_clip": 1.0,
        },
        "optimizer": {
            "lr": 0.01,
            "lr_init": 0.00001,
            "lr_end": 0.0001,
            "warmup_steps": 2000,
            "decay_steps": 40000,
        },
        "data": {
            "max_eval_sample": 8,
            "max_sec": 54,
            "num_workers": 4,
            "pad_val": 1024,
        },
        "model": {
            "vocab_size": 1025,
            "phoneme_vocab_size": 512 if version == "v1" else 732,
            "embedding_dim": 512,
            "hidden_dim": 512,
            "head": 16,
            "linear_units": 2048,
            "n_layer": 24,
            "dropout": 0,
            "EOS": 1024,
            "random_bert": 0,
        },
        "inference": {"top_k": 5 if version == "v1" else 15},
    }
    exp_dir = gpt_repo / "logs" / exp_name
    (exp_dir / f"logs_s1_{version}").mkdir(parents=True, exist_ok=True)
    data["train"]["batch_size"] = max(1, int(batch_size))
    data["train"]["epochs"] = max(1, int(epochs))
    half_weights_dir = gpt_repo / (f"GPT_weights_{version}" if version != "v1" else "GPT_weights")
    half_weights_dir.mkdir(parents=True, exist_ok=True)
    data["train"]["half_weights_save_dir"] = str(half_weights_dir)
    data["train"]["exp_name"] = exp_name
    data["train_semantic_path"] = str(exp_dir / "6-name2semantic.tsv")
    data["train_phoneme_path"] = str(exp_dir / "2-name2text.txt")
    data["output_dir"] = str(exp_dir / f"logs_s1_{version}")
    out = work_dir / "gpt_sovits" / exp_name / f"tmp_s1_{version}.yaml"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(to_simple_yaml(data), encoding="utf-8")
    return out


def apply_gpt_train_options_config(
    *,
    config_path: Path,
    gpt_repo: Path,
    gpt_hf: Path,
    work_dir: Path,
    gpt_pretrained: dict[str, dict[str, str]],
    version: str,
    exp_name: str,
    batch_size: int,
    epochs: int,
    save_every_epoch: int = 1,
    if_save_latest: bool = False,
    if_save_every_weights: bool = True,
    if_dpo: bool = False,
    pretrained_s1: Optional[str] = None,
) -> Path:
    exp_dir = gpt_repo / "logs" / exp_name
    half_weights_dir = gpt_repo / (f"GPT_weights_{version}" if version != "v1" else "GPT_weights")
    half_weights_dir.mkdir(parents=True, exist_ok=True)
    write_gpt_config_file(
        gpt_repo=gpt_repo,
        work_dir=work_dir,
        exp_name=exp_name,
        version=version,
        batch_size=batch_size,
        epochs=epochs,
    )
    data = {
        "train": {
            "seed": 1234,
            "epochs": max(1, int(epochs)),
            "batch_size": max(1, int(batch_size)),
            "save_every_n_epoch": max(1, int(save_every_epoch)),
            "precision": "16-mixed",
            "gradient_clip": 1.0,
            "if_save_every_weights": bool(if_save_every_weights),
            "if_save_latest": bool(if_save_latest),
            "if_dpo": bool(if_dpo),
            "half_weights_save_dir": str(half_weights_dir),
            "exp_name": exp_name,
        },
        "optimizer": {
            "lr": 0.01,
            "lr_init": 0.00001,
            "lr_end": 0.0001,
            "warmup_steps": 2000,
            "decay_steps": 40000,
        },
        "data": {"max_eval_sample": 8, "max_sec": 54, "num_workers": 4, "pad_val": 1024},
        "model": {
            "vocab_size": 1025,
            "phoneme_vocab_size": 512 if version == "v1" else 732,
            "embedding_dim": 512,
            "hidden_dim": 512,
            "head": 16,
            "linear_units": 2048,
            "n_layer": 24,
            "dropout": 0,
            "EOS": 1024,
            "random_bert": 0,
        },
        "inference": {"top_k": 5 if version == "v1" else 15},
        "pretrained_s1": pretrained_s1 or str(gpt_model_path_for(gpt_hf, gpt_pretrained, version, "gpt")),
        "train_semantic_path": str(exp_dir / "6-name2semantic.tsv"),
        "train_phoneme_path": str(exp_dir / "2-name2text.txt"),
        "output_dir": str(exp_dir / f"logs_s1_{version}"),
    }
    config_path.write_text(to_simple_yaml(data), encoding="utf-8")
    return config_path
