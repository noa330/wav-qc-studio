from __future__ import annotations

import io
import logging
import os
import warnings
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from typing import Any

_NOISY_WARNING_PATTERNS = (
    "Couldn't find ffmpeg or avconv",
    "Megatron num_microbatches_calculator not found",
    "OneLogger:",
    "No exporters were provided.",
    "Xet Storage is enabled",
    "resume_download is deprecated",
    "local_dir_use_symlinks",
    "TRANSFORMERS_CACHE",
    "pkg_resources is deprecated",
)


def _silence_known_runtime_warnings() -> None:
    for pattern in _NOISY_WARNING_PATTERNS:
        warnings.filterwarnings("ignore", message=f".*{pattern}.*")

@contextmanager
def suppress_external_console() -> Any:
    _silence_known_runtime_warnings()

    sink = io.StringIO()
    logger_names = [
        None,
        "nemo",
        "nemo_logger",
        "nemo.collections.asr",
        "pytorch_lightning",
        "numba",
        "pydub",
        "urllib3",
        "transformers",
        "huggingface_hub",
        "tqdm",
    ]
    logger_states: list[tuple[logging.Logger, int, bool]] = []
    previous_disable = logging.root.manager.disable
    env_states = {
        "TQDM_DISABLE": os.environ.get("TQDM_DISABLE"),
        "HF_HUB_DISABLE_PROGRESS_BARS": os.environ.get("HF_HUB_DISABLE_PROGRESS_BARS"),
    }

    try:
        os.environ["TQDM_DISABLE"] = "1"
        os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
        logging.disable(logging.ERROR)
        for name in logger_names:
            logger = logging.getLogger(name)
            logger_states.append((logger, logger.level, logger.propagate))
            logger.setLevel(logging.ERROR)
            logger.propagate = False
        with warnings.catch_warnings():
            _silence_known_runtime_warnings()
            with redirect_stdout(sink), redirect_stderr(sink):
                yield sink
    finally:
        logging.disable(previous_disable)
        for logger, level, propagate in logger_states:
            logger.setLevel(level)
            logger.propagate = propagate
        for name, value in env_states.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
