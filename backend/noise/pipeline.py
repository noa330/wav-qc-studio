from __future__ import annotations

from pathlib import Path
from typing import Callable

from .models.resemble_runner import prepare_resemble, run_resemble
from .models.sidon_runner import prepare_sidon, run_sidon
from .models.voicefixer_runner import prepare_voicefixer, run_voicefixer
from .schema import NoiseInferenceSettings

LogFn = Callable[[str], None]
StageCallback = Callable[[str], None]
DetailCallback = Callable[[str], None]



def prepare_pipeline(settings: NoiseInferenceSettings, log: LogFn) -> None:
    settings = settings.normalize()
    if settings.use_voicefixer:
        prepare_voicefixer(settings.voicefixer_device_preference, log)
    if settings.use_resemble:
        prepare_resemble(settings.resemble_device_preference, log)
    if settings.use_sidon:
        prepare_sidon(settings.sidon_device_preference, log)


class PipelineStageError(RuntimeError):
    def __init__(self, stage: str, original: Exception):
        super().__init__(f"[{stage}] {type(original).__name__}: {original}")
        self.stage = stage
        self.original = original


def _record_stage_error(stage: str, exc: Exception, log: LogFn, stage_errors: list[str], error_messages: list[str]) -> None:
    wrapped = PipelineStageError(stage, exc)
    log(f"[단계 실패] {wrapped}")
    stage_errors.append(stage)
    error_messages.append(str(wrapped))


def run_pipeline(
    input_path: Path,
    output_dir: Path,
    settings: NoiseInferenceSettings,
    log: LogFn,
    on_stage_changed: StageCallback | None = None,
    on_detail_changed: DetailCallback | None = None,
) -> dict[str, object]:
    settings = settings.normalize()
    voice_dir = output_dir / "voicefixer"
    resemble_dir = output_dir / "resemble"
    sidon_dir = output_dir / "sidon"

    voice_output = ""
    resemble_output = ""
    sidon_output = ""
    stage_errors: list[str] = []
    error_messages: list[str] = []

    if settings.use_voicefixer:
        try:
            if on_stage_changed is not None:
                on_stage_changed("voicefixer")
            vf_path = run_voicefixer(
                input_path=input_path,
                output_dir=voice_dir,
                mode=settings.voicefixer_mode,
                device_preference=settings.voicefixer_device_preference,
                log=log,
                on_detail_changed=on_detail_changed,
            )
            voice_output = str(vf_path)
        except Exception as exc:  # noqa: BLE001
            _record_stage_error("voicefixer", exc, log, stage_errors, error_messages)

    if settings.use_resemble:
        try:
            if on_stage_changed is not None:
                on_stage_changed("resemble")
            re_path = run_resemble(
                input_path=input_path,
                output_dir=resemble_dir,
                task=settings.resemble_task,
                solver=settings.resemble_solver,
                nfe=settings.resemble_nfe,
                tau=settings.resemble_tau,
                lambd=settings.resemble_lambda,
                device_preference=settings.resemble_device_preference,
                log=log,
                on_detail_changed=on_detail_changed,
            )
            resemble_output = str(re_path)
        except Exception as exc:  # noqa: BLE001
            _record_stage_error("resemble", exc, log, stage_errors, error_messages)

    if settings.use_sidon:
        try:
            if on_stage_changed is not None:
                on_stage_changed("sidon")
            sidon_path = run_sidon(
                input_path=input_path,
                output_dir=sidon_dir,
                device_preference=settings.sidon_device_preference,
                settings=settings,
                log=log,
                on_detail_changed=on_detail_changed,
            )
            sidon_output = str(sidon_path)
        except Exception as exc:  # noqa: BLE001
            _record_stage_error("sidon", exc, log, stage_errors, error_messages)

    final_output = sidon_output or resemble_output or voice_output or str(input_path)

    return {
        "voicefixer_output_path": voice_output,
        "resemble_output_path": resemble_output,
        "sidon_output_path": sidon_output,
        "final_output_path": final_output,
        "failed_stages": stage_errors,
        "error": " | ".join(error_messages),
    }
