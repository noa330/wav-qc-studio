from __future__ import annotations

import fnmatch
import os
import re
from pathlib import Path
from typing import Any, Callable

from ..downloads import download_url_to_path, is_download_complete

LogFn = Callable[[str], None]

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_CACHE_ROOT = PROJECT_ROOT / ".model_cache"
BLOCKED_LOCAL_PROXY_PATTERN = re.compile(r"^https?://127\.0\.0\.1:9/?$", re.IGNORECASE)
PROXY_ENV_NAMES = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")
PROGRESS_DISABLE_ENV_NAMES = ("HF_HUB_DISABLE_PROGRESS_BARS", "TQDM_DISABLE")


def model_cache_root() -> Path:
    root = Path(os.environ.get("WQCS_MODEL_CACHE_DIR", "") or DEFAULT_MODEL_CACHE_ROOT).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def hf_cache_dir() -> Path:
    path = model_cache_root() / "huggingface"
    path.mkdir(parents=True, exist_ok=True)
    return path


def torch_cache_dir() -> Path:
    path = model_cache_root() / "torch"
    path.mkdir(parents=True, exist_ok=True)
    return path


def package_cache_dir(package_name: str) -> Path:
    path = model_cache_root() / "packages" / safe_cache_name(package_name)
    path.mkdir(parents=True, exist_ok=True)
    return path


def hf_repo_dir(repo_id: str, namespace: str = "repos") -> Path:
    path = hf_cache_dir() / namespace / safe_cache_name(repo_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def configure_model_cache_env() -> None:
    sanitize_dead_proxy_env()
    enable_download_progress_env()
    root = model_cache_root()
    hf_root = hf_cache_dir()
    torch_root = torch_cache_dir()
    os.environ["WQCS_MODEL_CACHE_DIR"] = str(root)
    os.environ["HF_HOME"] = str(hf_root)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(hf_root / "hub")
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    os.environ.pop("TRANSFORMERS_CACHE", None)
    os.environ["TORCH_HOME"] = str(torch_root)
    os.environ["NEMO_CACHE_DIR"] = str(package_cache_dir("nemo"))
    (hf_root / "hub").mkdir(parents=True, exist_ok=True)
    (hf_root / "transformers").mkdir(parents=True, exist_ok=True)


def sanitize_dead_proxy_env() -> None:
    for name in PROXY_ENV_NAMES:
        value = os.environ.get(name, "")
        if BLOCKED_LOCAL_PROXY_PATTERN.match(value):
            os.environ.pop(name, None)


def enable_download_progress_env() -> None:
    for name in PROGRESS_DISABLE_ENV_NAMES:
        value = os.environ.get(name, "")
        if value.strip().lower() in {"1", "true", "yes", "on"}:
            os.environ.pop(name, None)


def log_model_cache(log: LogFn, label: str, path: Path | str) -> None:
    log(f"[model cache] {label}: {Path(path).resolve()}")


def hf_snapshot_download(repo_id: str, *, local_dir: Path | str | None = None, log: LogFn | None = None, label: str | None = None, **kwargs: Any) -> str:
    configure_model_cache_env()
    from huggingface_hub import HfApi

    target_dir = Path(local_dir) if local_dir is not None else hf_repo_dir(repo_id)
    model_label = label or repo_id
    if log is not None:
        log_model_cache(log, model_label, target_dir)

    allow_patterns = _normalize_patterns(kwargs.pop("allow_patterns", None))
    ignore_patterns = _normalize_patterns(kwargs.pop("ignore_patterns", None))
    revision = kwargs.pop("revision", None)
    repo_type = kwargs.pop("repo_type", None)
    token = kwargs.pop("token", None)

    api = HfApi()
    files = api.list_repo_files(repo_id=repo_id, revision=revision, repo_type=repo_type, token=token)
    selected = [
        file_name
        for file_name in files
        if _matches_patterns(file_name, allow_patterns, default=True)
        and not _matches_patterns(file_name, ignore_patterns, default=False)
    ]
    if not selected:
        raise RuntimeError(f"No Hugging Face files matched for {repo_id}.")

    for file_name in selected:
        _download_hf_file(
            repo_id=repo_id,
            filename=file_name,
            target_dir=target_dir,
            log=log,
            label=model_label,
            revision=revision,
            repo_type=repo_type,
        )
    return str(target_dir)


def hf_hub_download(repo_id: str, *, filename: str, local_dir: Path | str | None = None, log: LogFn | None = None, label: str | None = None, **kwargs: Any) -> str:
    configure_model_cache_env()

    target_dir = Path(local_dir) if local_dir is not None else hf_repo_dir(repo_id)
    model_label = label or f"{repo_id}/{filename}"
    if log is not None:
        log_model_cache(log, model_label, target_dir)

    revision = kwargs.pop("revision", None)
    repo_type = kwargs.pop("repo_type", None)
    return _download_hf_file(
        repo_id=repo_id,
        filename=filename,
        target_dir=target_dir,
        log=log,
        label=model_label,
        revision=revision,
        repo_type=repo_type,
    )


def _download_hf_file(
    *,
    repo_id: str,
    filename: str,
    target_dir: Path,
    log: LogFn | None,
    label: str,
    revision: str | None = None,
    repo_type: str | None = None,
) -> str:
    from huggingface_hub import hf_hub_url

    target_path = target_dir / filename
    if is_download_complete(target_path):
        if log is not None:
            log(f"[model cache ready] {label}: {filename}")
        return str(target_path)

    url = hf_hub_url(repo_id=repo_id, filename=filename, revision=revision, repo_type=repo_type)
    if log is not None:
        log(f"[model download] {label}: {filename}")

    return str(download_url_to_path(
        url,
        target_path,
        label=f"{label} {Path(filename).name}",
        log=log,
        retry_label=f"{label}: {filename}",
    ))


def _normalize_patterns(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if str(item)]
    return [str(value)]


def _matches_patterns(file_name: str, patterns: list[str], *, default: bool) -> bool:
    if not patterns:
        return default
    return any(fnmatch.fnmatch(file_name, pattern) for pattern in patterns)


def transformer_cache_kwargs() -> dict[str, str]:
    configure_model_cache_env()
    return {"cache_dir": str(hf_cache_dir() / "transformers")}


def faster_whisper_download_root() -> str:
    configure_model_cache_env()
    path = package_cache_dir("faster-whisper")
    return str(path)


def safe_cache_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "--", value.strip()).strip(".-")
    return cleaned or "model"
