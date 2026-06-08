from __future__ import annotations

import math
import os
import shutil
import sys
import types
import zipfile
from dataclasses import dataclass
from importlib.machinery import ModuleSpec
from pathlib import Path
from typing import Callable

from ..downloads import download_url_to_path
from ..runtime import package_cache_dir
from .schema import SlicerDetectedEvent, SlicerFrameTag, SlicerFrameTagRow, SlicerSettings

LogFn = Callable[[str], None]

PRETRAINED_SED_REPO_URL = "https://github.com/fschmid56/PretrainedSED/archive/refs/heads/main.zip"
DEFAULT_PRETRAINED_SED_APP_DIR = package_cache_dir("pretrainedsed-tagger")
PRETRAINED_SED_APP_DIR = Path(os.environ.get("PRETRAINEDSED_TAGGER_DIR", str(DEFAULT_PRETRAINED_SED_APP_DIR))).resolve()
PRETRAINED_SED_REPO_DIR = PRETRAINED_SED_APP_DIR / "PretrainedSED"

MODEL_CONFIG = {
    "beats": ("BEATs Strong", "BEATs_strong_1"),
    "atst_f": ("ATST-F Strong", "ATST-F_strong_1"),
    "fpasst": ("fPaSST Strong", "fpasst_strong_1"),
}


@dataclass(slots=True)
class FrameTaggingResult:
    duration_sec: float
    model_label: str
    checkpoint: str
    device: str
    top_tags: list[SlicerFrameTag]
    frames: list[SlicerFrameTagRow]
    events: list[SlicerDetectedEvent]


class PretrainedSedFrameTagger:
    def __init__(self) -> None:
        self.modules: dict[str, object] | None = None
        self.model = None
        self.model_key = ""
        self.model_label = ""
        self.checkpoint = ""
        self.device = None

    def ensure_model(self, settings: SlicerSettings, log: LogFn) -> None:
        modules = self._ensure_modules(log)
        torch = modules["torch"]
        device = torch.device("cuda") if settings.device_preference != "cpu" and torch.cuda.is_available() else torch.device("cpu")
        model_key = settings.pretrained_sed_model_key

        if self.model is not None and self.model_key == model_key and str(self.device) == str(device):
            log(f"[model ready] PretrainedSED {self.model_label} device={device}")
            return

        previous_cwd = Path.cwd()
        os.chdir(PRETRAINED_SED_REPO_DIR)
        try:
            model_label, checkpoint, model = self._build_model(model_key, modules)
        finally:
            os.chdir(previous_cwd)
        model.eval()
        model.to(device)
        self.model = model
        self.model_key = model_key
        self.model_label = model_label
        self.checkpoint = checkpoint
        self.device = device
        log(f"[model loaded] PretrainedSED {model_label} checkpoint={checkpoint} device={device}")

    def predict_file(self, audio_path: Path, settings: SlicerSettings, log: LogFn) -> FrameTaggingResult:
        if self.model is None or self.device is None:
            raise RuntimeError("PretrainedSED frame tagger is not loaded.")

        modules = self._ensure_modules(log)
        torch = modules["torch"]
        librosa = modules["librosa"]
        np = modules["np"]

        sample_rate = 16_000
        segment_duration = 10
        segment_samples = segment_duration * sample_rate

        waveform_np, _ = librosa.core.load(str(audio_path), sr=sample_rate, mono=True)
        waveform = torch.from_numpy(waveform_np[None, :]).to(self.device)
        waveform_len = int(waveform.shape[1])
        audio_len = waveform_len / sample_rate
        log(f"[tag] {audio_path.name}: {audio_len:.2f}s, model={self.model_label}, device={self.device}")

        labels = list(modules["audioset_classes"].as_strong_train_classes)
        num_chunks = max(1, waveform_len // segment_samples + int(waveform_len % segment_samples != 0))

        predictions = []
        for chunk_idx in range(num_chunks):
            start_idx = chunk_idx * segment_samples
            end_idx = min((chunk_idx + 1) * segment_samples, waveform_len)
            waveform_chunk = waveform[:, start_idx:end_idx]
            if waveform_chunk.shape[1] < segment_samples:
                pad_size = segment_samples - waveform_chunk.shape[1]
                waveform_chunk = torch.nn.functional.pad(waveform_chunk, (0, pad_size))

            log(f"[tag] inference chunk {chunk_idx + 1}/{num_chunks}")
            with torch.no_grad():
                mel = self.model.mel_forward(waveform_chunk)
                y_strong, _ = self.model(mel)
            predictions.append(y_strong)

        y_strong = torch.cat(predictions, dim=2)
        frames_per_second = y_strong.shape[2] / max(1.0, num_chunks * segment_duration)
        true_frames = max(1, min(y_strong.shape[2], int(math.ceil(audio_len * frames_per_second))))
        y_strong = y_strong[:, :, :true_frames]
        probabilities = torch.sigmoid(y_strong).float()
        scores = probabilities[0].transpose(0, 1).detach().cpu().numpy()

        if settings.pretrained_sed_median_window > 0:
            scores = modules["scipy_ndimage"].median_filter(scores, size=(settings.pretrained_sed_median_window, 1))

        timestamps = np.linspace(0.0, audio_len, scores.shape[0] + 1)
        events = self._decode_events(scores, timestamps, labels, audio_path, settings)
        frames = self._build_frame_rows(scores, timestamps, labels, settings)
        top_tags = self._build_summary_tags(scores, labels, settings.pretrained_sed_top_k)

        return FrameTaggingResult(
            duration_sec=audio_len,
            model_label=self.model_label,
            checkpoint=self.checkpoint,
            device=str(self.device),
            top_tags=top_tags,
            frames=frames,
            events=events,
        )

    def format_top_tag(self, tags: list[SlicerFrameTag]) -> str:
        if not tags:
            return "-"
        top = tags[0]
        return f"{top.label} {top.score:.3f}"

    @staticmethod
    def _decode_events(scores, timestamps, labels: list[str], audio_path: Path, settings: SlicerSettings) -> list[SlicerDetectedEvent]:
        events: list[SlicerDetectedEvent] = []
        for threshold in settings.pretrained_sed_thresholds:
            for label_idx, label in enumerate(labels):
                active = scores[:, label_idx] >= threshold
                start_idx: int | None = None
                for frame_idx, is_active in enumerate(active):
                    if is_active and start_idx is None:
                        start_idx = frame_idx
                    if start_idx is not None and (not is_active or frame_idx == len(active) - 1):
                        end_idx = frame_idx + 1 if is_active and frame_idx == len(active) - 1 else frame_idx
                        onset = float(timestamps[start_idx])
                        offset = float(timestamps[end_idx])
                        if offset > onset:
                            events.append(
                                SlicerDetectedEvent(
                                    threshold=float(threshold),
                                    label=label,
                                    onset=onset,
                                    offset=offset,
                                    duration=offset - onset,
                                    filename=str(audio_path),
                                )
                            )
                        start_idx = None
        events.sort(key=lambda event: (event.threshold, event.onset, event.offset, event.label))
        return events

    @staticmethod
    def _build_frame_rows(scores, timestamps, labels: list[str], settings: SlicerSettings) -> list[SlicerFrameTagRow]:
        if len(scores) == 0:
            return []

        frame_seconds = max(1e-9, float(timestamps[min(1, len(timestamps) - 1)] - timestamps[0]))
        frames_per_row = max(1, int(round(settings.pretrained_sed_frame_interval / frame_seconds)))
        rows: list[SlicerFrameTagRow] = []

        for start_idx in range(0, len(scores), frames_per_row):
            end_idx = min(start_idx + frames_per_row, len(scores))
            if end_idx <= start_idx:
                continue
            window_scores = scores[start_idx:end_idx].max(axis=0)
            top_indices = window_scores.argsort()[::-1][: settings.pretrained_sed_top_k]
            tags = [
                SlicerFrameTag(rank=rank, label=labels[int(label_idx)], score=float(window_scores[int(label_idx)]), logit=0.0)
                for rank, label_idx in enumerate(top_indices, start=1)
                if float(window_scores[int(label_idx)]) >= settings.pretrained_sed_min_score
            ]
            if not tags and len(top_indices) > 0:
                best_idx = int(top_indices[0])
                tags = [SlicerFrameTag(rank=1, label=labels[best_idx], score=float(window_scores[best_idx]), logit=0.0)]
            rows.append(
                SlicerFrameTagRow(
                    start_sec=float(timestamps[start_idx]),
                    end_sec=float(timestamps[end_idx]),
                    tags=tags,
                )
            )
        return rows

    @staticmethod
    def _build_summary_tags(scores, labels: list[str], top_k: int) -> list[SlicerFrameTag]:
        if len(scores) == 0:
            return []
        max_scores = scores.max(axis=0)
        top_indices = max_scores.argsort()[::-1][: max(1, top_k)]
        return [
            SlicerFrameTag(rank=rank, label=labels[int(label_idx)], score=float(max_scores[int(label_idx)]), logit=0.0)
            for rank, label_idx in enumerate(top_indices, start=1)
        ]

    def _ensure_modules(self, log: LogFn | None = None) -> dict[str, object]:
        if self.modules is not None:
            return self.modules

        _ensure_pretrained_sed_repository(log or _noop_log)

        if str(PRETRAINED_SED_REPO_DIR) not in sys.path:
            sys.path.insert(0, str(PRETRAINED_SED_REPO_DIR))
        self._install_pretrained_namespace("models")

        previous_cwd = Path.cwd()
        os.chdir(PRETRAINED_SED_REPO_DIR)
        try:
            import librosa
            import numpy as np
            import scipy.ndimage
            import torch
            from data_util import audioset_classes
            from models.prediction_wrapper import PredictionsWrapper
        finally:
            os.chdir(previous_cwd)

        self.modules = {
            "librosa": librosa,
            "np": np,
            "scipy_ndimage": scipy.ndimage,
            "torch": torch,
            "audioset_classes": audioset_classes,
            "PredictionsWrapper": PredictionsWrapper,
        }
        return self.modules

    @staticmethod
    def _install_pretrained_namespace(module_name: str) -> None:
        package_path = PRETRAINED_SED_REPO_DIR / module_name
        if not package_path.is_dir():
            return

        package_path_text = str(package_path)
        for loaded_name in list(sys.modules):
            if loaded_name == module_name or loaded_name.startswith(f"{module_name}."):
                loaded_module = sys.modules[loaded_name]
                loaded_file = getattr(loaded_module, "__file__", None)
                loaded_paths = [str(path) for path in getattr(loaded_module, "__path__", [])]
                if loaded_file and _is_path_under(Path(loaded_file), package_path):
                    continue
                if package_path_text in loaded_paths:
                    continue
                del sys.modules[loaded_name]

        module = types.ModuleType(module_name)
        module.__path__ = [package_path_text]  # type: ignore[attr-defined]
        module.__package__ = module_name
        spec = ModuleSpec(module_name, loader=None, is_package=True)
        spec.submodule_search_locations = [package_path_text]
        module.__spec__ = spec
        sys.modules[module_name] = module

    @staticmethod
    def _build_model(model_key: str, modules: dict[str, object]):
        model_label, checkpoint = MODEL_CONFIG[model_key]
        if model_key == "beats":
            from models.beats.BEATs_wrapper import BEATsWrapper

            base_model = BEATsWrapper()
        elif model_key == "atst_f":
            from models.atstframe.ATSTF_wrapper import ATSTWrapper

            base_model = ATSTWrapper()
        elif model_key == "fpasst":
            from models.frame_passt.fpasst_wrapper import FPaSSTWrapper

            base_model = FPaSSTWrapper()
        else:
            raise ValueError(f"Unsupported PretrainedSED model: {model_key}")
        return model_label, checkpoint, modules["PredictionsWrapper"](base_model, checkpoint=checkpoint)



def _ensure_pretrained_sed_repository(log: LogFn) -> None:
    if (PRETRAINED_SED_REPO_DIR / "inference.py").exists():
        return

    PRETRAINED_SED_APP_DIR.mkdir(parents=True, exist_ok=True)
    if PRETRAINED_SED_REPO_DIR.exists():
        log(f"[model cache reset] Removing incomplete PretrainedSED repository: {PRETRAINED_SED_REPO_DIR}")
        shutil.rmtree(PRETRAINED_SED_REPO_DIR)

    zip_path = PRETRAINED_SED_APP_DIR / "PretrainedSED-main.zip"
    extract_dir = PRETRAINED_SED_APP_DIR / "_extract"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)

    log(f"[model download] PretrainedSED source: {PRETRAINED_SED_REPO_URL}")
    download_url_to_path(
        PRETRAINED_SED_REPO_URL,
        zip_path,
        label="PretrainedSED source",
        log=log,
        retry_label="PretrainedSED source",
    )

    try:
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extract_dir)
        extracted_repo = extract_dir / "PretrainedSED-main"
        if not (extracted_repo / "inference.py").exists():
            raise FileNotFoundError(f"Downloaded PretrainedSED archive did not contain inference.py: {extracted_repo}")
        shutil.move(str(extracted_repo), str(PRETRAINED_SED_REPO_DIR))
        log(f"[model cache ready] PretrainedSED source: {PRETRAINED_SED_REPO_DIR}")
    finally:
        try:
            zip_path.unlink()
        except FileNotFoundError:
            pass
        if extract_dir.exists():
            shutil.rmtree(extract_dir, ignore_errors=True)


def _noop_log(_message: str) -> None:
    return
def _is_path_under(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True




