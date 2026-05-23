from __future__ import annotations

import os
import shutil
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from ..console_ui import DownloadProgress
from ..runtime import package_cache_dir

LogFn = Callable[[str], None]


@dataclass(frozen=True)
class AssetSpec:
    label: str
    url: str
    target: Path


def get_voicefixer_run_dir() -> Path:
    return package_cache_dir("voicefixer-home") / ".cache" / "voicefixer"


def get_legacy_voicefixer_run_dir() -> Path:
    return package_cache_dir("voicefixer")


VOICEFIXER_ASSETS = [
    AssetSpec(
        label="VoiceFixer vf.ckpt",
        url="https://zenodo.org/record/5600188/files/vf.ckpt?download=1",
        target=get_voicefixer_run_dir() / "analysis_module" / "checkpoints" / "vf.ckpt",
    ),
    AssetSpec(
        label="VoiceFixer synthesis checkpoint",
        url="https://zenodo.org/record/5600188/files/model.ckpt-1490000_trimed.pt?download=1",
        target=get_voicefixer_run_dir() / "synthesis_module" / "44100" / "model.ckpt-1490000_trimed.pt",
    ),
]

RESEMBLE_RELFILES = [
    "hparams.yaml",
    "ds/G/latest",
    "ds/G/default/mp_rank_00_model_states.pt",
]
RESEMBLE_BASE_URL = "https://huggingface.co/ResembleAI/resemble-enhance/resolve/main/enhancer_stage2"



def get_resemble_run_dir() -> Path:
    return package_cache_dir("resemble-enhance") / "enhancer_stage2"


def get_resemble_assets() -> list[AssetSpec]:
    run_dir = get_resemble_run_dir()
    return [
        AssetSpec(
            label=f"Resemble {relpath}",
            url=f"{RESEMBLE_BASE_URL}/{relpath}?download=true",
            target=run_dir / relpath,
        )
        for relpath in RESEMBLE_RELFILES
    ]


def bind_voicefixer_local_cache(log: LogFn) -> Path:
    run_dir = get_voicefixer_run_dir()
    cache_root = package_cache_dir("voicefixer-home")
    cache_root_str = str(cache_root)
    previous_home = os.environ.get("HOME", "")
    previous_userprofile = os.environ.get("USERPROFILE", "")
    os.environ["HOME"] = cache_root_str
    os.environ["USERPROFILE"] = cache_root_str
    if previous_home != cache_root_str or previous_userprofile != cache_root_str:
        log(f"[FIX] VoiceFixer 캐시 경로를 가상환경으로 고정: {run_dir}")
    return run_dir


def _patch_resemble_hparams(path: Path, log: LogFn) -> None:
    text = path.read_text(encoding="utf-8")
    patched = text.replace("pathlib.PosixPath", "pathlib.Path")
    if patched != text:
        path.write_text(patched, encoding="utf-8")
        log("[FIX] Resemble hparams.yaml Windows 경로 수정 적용")


def _download(asset: AssetSpec, log: LogFn) -> None:
    asset.target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = asset.target.with_suffix(asset.target.suffix + ".part")
    if temp_path.exists():
        temp_path.unlink()

    progress = DownloadProgress(asset.label)
    log(f"[모델 다운로드] {asset.label}")
    try:
        urllib.request.urlretrieve(asset.url, temp_path, reporthook=progress)
        shutil.move(str(temp_path), str(asset.target))
        size_mb = asset.target.stat().st_size / (1024 * 1024)
        progress.finish(f"[모델 다운로드 완료] {asset.label} · {size_mb:.1f} MB")
        log(f"[모델 저장] {asset.target}")
    except Exception:
        progress.finish(f"[모델 다운로드 실패] {asset.label}")
        raise


def inspect_assets(assets: Iterable[AssetSpec], log: LogFn) -> list[AssetSpec]:
    missing: list[AssetSpec] = []
    for asset in assets:
        if asset.target.exists() and asset.target.stat().st_size > 0:
            size_mb = asset.target.stat().st_size / (1024 * 1024)
            if _is_valid_asset(asset, log):
                log(f"[모델 캐시] 있음: {asset.label} ({size_mb:.1f} MB)")
                continue

            log(f"[모델 캐시] 손상됨: {asset.label} ({size_mb:.1f} MB) · 재다운로드")
            try:
                asset.target.unlink()
            except FileNotFoundError:
                pass
            missing.append(asset)
        else:
            log(f"[모델 캐시] 없음: {asset.label}")
            missing.append(asset)
    return missing


def _is_valid_asset(asset: AssetSpec, log: LogFn) -> bool:
    if asset.target.suffix not in {".ckpt", ".pt"}:
        return True

    try:
        import torch

        torch.load(asset.target, map_location="cpu")
        return True
    except Exception as exc:  # noqa: BLE001
        log(f"[모델 캐시] 검증 실패: {asset.label} · {type(exc).__name__}: {exc}")
        return False


def _resolve_assets(model_key: str, log: LogFn) -> tuple[str, list[AssetSpec]]:
    if model_key == "voicefixer":
        bind_voicefixer_local_cache(log)
        _migrate_legacy_voicefixer_cache(log)
        return "VoiceFixer", VOICEFIXER_ASSETS

    if model_key == "resemble":
        return "Resemble Enhance", get_resemble_assets()

    raise ValueError(f"Unknown model key: {model_key}")


def _migrate_legacy_voicefixer_cache(log: LogFn) -> None:
    current_root = get_voicefixer_run_dir()
    legacy_root = get_legacy_voicefixer_run_dir()
    if current_root == legacy_root or not legacy_root.exists():
        return

    for asset in VOICEFIXER_ASSETS:
        try:
            relative_path = asset.target.relative_to(current_root)
        except ValueError:
            continue

        legacy_target = legacy_root / relative_path
        if not legacy_target.exists() or legacy_target.stat().st_size <= 0:
            continue

        if asset.target.exists() and asset.target.stat().st_size > 0 and _is_valid_asset(asset, log):
            continue

        legacy_asset = AssetSpec(asset.label, asset.url, legacy_target)
        if not _is_valid_asset(legacy_asset, log):
            continue

        asset.target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy_target, asset.target)
        log(f"[모델 캐시] VoiceFixer 기존 캐시 이관: {legacy_target} -> {asset.target}")


def log_model_status(model_key: str, log: LogFn) -> list[AssetSpec]:
    title, assets = _resolve_assets(model_key, log)
    log(f"[모델 확인] {title} 필수 파일 점검")
    missing = inspect_assets(assets, log)

    if model_key == "resemble":
        hparams = get_resemble_run_dir() / "hparams.yaml"
        if hparams.exists():
            _patch_resemble_hparams(hparams, log)

    return missing


def download_model_assets(model_key: str, log: LogFn) -> None:
    title, assets = _resolve_assets(model_key, log)

    log(f"[모델 준비] {title} 다운로드/패치 점검 시작")
    missing = inspect_assets(assets, log)
    if not missing:
        log(f"[모델 준비 완료] {title} 필수 파일이 이미 모두 있습니다.")
    else:
        for asset in missing:
            _download(asset, log)

    if model_key == "resemble":
        hparams = get_resemble_run_dir() / "hparams.yaml"
        if hparams.exists():
            _patch_resemble_hparams(hparams, log)

    log(f"[모델 준비 완료] {title}")


def ensure_model_available(model_key: str, log: LogFn) -> None:
    title, _ = _resolve_assets(model_key, log)
    missing = log_model_status(model_key, log)
    if missing:
        log(f"[모델 다운로드] {title}에 필요한 파일이 부족하여 이어서 받습니다.")
        download_model_assets(model_key, log)
    else:
        log(f"[모델 확인 완료] {title} 준비 완료 · 다운로드 생략")
