from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class InferenceManifestInput:
    model: str
    model_name: str
    mode: str
    reference_audio: Path
    reference_text: str
    output_text: str


class TrainingManifestWriter:
    def __init__(self, manifest_path: Path, output_dir: Path, dataset_path: Path, model_type: str, model_name: str, total_units: int) -> None:
        self.manifest_path = manifest_path
        self.output_dir = output_dir
        self.dataset_path = dataset_path
        self.model_type = model_type
        self.model_name = model_name
        self.total_units = max(1, total_units)
        self.completed_units = 0
        self.failed_units = 0
        self.started_at = time.monotonic()
        self.jobs: list[dict[str, Any]] = []
        self.write()

    def emit(
        self,
        stage: str,
        status: str,
        message: str = "",
        checkpoint_path: Path | None = None,
        epoch: str = "",
        step: str = "",
        complete_unit: bool = False,
        failed: bool = False,
    ) -> None:
        if complete_unit:
            self.completed_units = min(self.total_units, self.completed_units + 1)
        if failed:
            self.failed_units += 1
        checkpoint_text = str(checkpoint_path) if checkpoint_path else ""
        self.jobs.append(
            {
                "id": str(len(self.jobs) + 1),
                "modelType": self.model_type,
                "modelName": self.model_name,
                "datasetPath": str(self.dataset_path),
                "outputPath": str(self.output_dir),
                "stage": stage,
                "epoch": epoch,
                "step": step,
                "elapsedSec": round(time.monotonic() - self.started_at, 3),
                "checkpoint": Path(checkpoint_text).name if checkpoint_text else "",
                "checkpointPath": checkpoint_text,
                "status": status,
                "message": message,
            }
        )
        self.write()

    def write(self) -> None:
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        finished = min(self.total_units, self.completed_units + self.failed_units)
        progress = finished / self.total_units if self.total_units else 0
        payload = {
            "workspaceId": "training",
            "summary": {
                "totalFiles": self.total_units,
                "completed": self.completed_units,
                "failed": self.failed_units,
                "progress": progress,
            },
            "modelType": self.model_type,
            "modelName": self.model_name,
            "datasetPath": str(self.dataset_path),
            "outputPath": str(self.output_dir),
            "jobs": self.jobs,
        }
        self.manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class InferenceManifestWriter:
    def __init__(self, manifest_path: Path, output_dir: Path, inputs: InferenceManifestInput) -> None:
        self.manifest_path = manifest_path
        self.output_dir = output_dir
        self.inputs = inputs
        self.started_at = time.monotonic()
        self.jobs: list[dict[str, Any]] = []
        self.write(0, 0, 0)

    def emit(self, stage: str, status: str, message: str = "", output_audio: Path | None = None, failed: bool = False) -> None:
        elapsed = round(time.monotonic() - self.started_at, 3)
        self.jobs.append(
            {
                "id": str(len(self.jobs) + 1),
                "modelType": self.inputs.model,
                "modelName": self.inputs.model_name,
                "mode": self.inputs.mode,
                "stage": stage,
                "status": status,
                "message": message,
                "referenceAudioPath": str(self.inputs.reference_audio),
                "referenceText": self.inputs.reference_text,
                "outputText": self.inputs.output_text,
                "outputAudioPath": str(output_audio or ""),
                "outputPath": str(self.output_dir),
                "elapsedSec": elapsed,
            }
        )
        self.write(1 if status == "completed" else 0, 1 if failed else 0, 100 if status == "completed" or failed else 15)

    def write(self, completed: int, failed: int, percent: int) -> None:
        payload = {
            "workspaceId": "inference",
            "summary": {
                "totalFiles": 1,
                "completed": completed,
                "failed": failed,
                "progress": max(0, min(100, percent)) / 100,
            },
            "modelType": self.inputs.model,
            "modelName": self.inputs.model_name,
            "referenceAudioPath": str(self.inputs.reference_audio),
            "outputPath": str(self.output_dir),
            "jobs": self.jobs,
        }
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        self.manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
