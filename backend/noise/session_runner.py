from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path


def import_runtime_modules():
    if __package__ is None or __package__ == "":
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from backend.audio_utils import discover_audio_files  # type: ignore
        from backend.noise.manifest import write_manifest  # type: ignore
        from backend.console_ui import LiveConsoleLine, format_finished_line, format_progress_line, print_banner, print_kv, print_section  # type: ignore
        from backend.noise.pipeline import prepare_pipeline, run_pipeline  # type: ignore
        from backend.noise.runtime import check_runtime  # type: ignore
        from backend.noise.schema import NoiseInferenceSettings, NoiseJob, NoiseSession  # type: ignore
        from backend.runtime import model_cache_root  # type: ignore
    else:
        from ..audio_utils import discover_audio_files  # type: ignore
        from .manifest import write_manifest  # type: ignore
        from ..console_ui import LiveConsoleLine, format_finished_line, format_progress_line, print_banner, print_kv, print_section  # type: ignore
        from .pipeline import prepare_pipeline, run_pipeline  # type: ignore
        from .runtime import check_runtime  # type: ignore
        from .schema import NoiseInferenceSettings, NoiseJob, NoiseSession  # type: ignore
        from ..runtime import model_cache_root  # type: ignore
    return discover_audio_files, write_manifest, prepare_pipeline, run_pipeline, check_runtime, NoiseInferenceSettings, NoiseJob, NoiseSession, LiveConsoleLine, print_banner, print_kv, print_section, format_finished_line, format_progress_line, model_cache_root


class CancelledRun(Exception):
    pass


def cancel_requested(args: argparse.Namespace) -> bool:
    cancel_file = str(getattr(args, "cancel_file", "") or "")
    return bool(cancel_file and Path(cancel_file).exists())


def raise_if_cancelled(args: argparse.Namespace) -> None:
    if cancel_requested(args):
        raise CancelledRun("Cancelled by user")


def run_inference_session(args: argparse.Namespace) -> int:
    (
        discover_audio_files,
        write_manifest,
        prepare_pipeline,
        run_pipeline,
        check_runtime,
        NoiseInferenceSettings,
        NoiseJob,
        NoiseSession,
        LiveConsoleLine,
        print_banner,
        print_kv,
        print_section,
        format_finished_line,
        format_progress_line,
        model_cache_root,
    ) = import_runtime_modules()

    print_banner("스피카 추론 실행")
    print_kv("Python", sys.executable)
    print_kv("작업 폴더", Path.cwd())
    print_kv("Model cache", model_cache_root())

    settings = NoiseInferenceSettings(
        use_voicefixer=bool(args.voicefixer),
        voicefixer_mode=int(args.voicefixer_mode),
        use_resemble=bool(args.resemble),
        resemble_task=args.resemble_task,
        resemble_solver=args.resemble_solver,
        resemble_nfe=int(args.resemble_nfe),
        resemble_tau=float(args.resemble_tau),
        resemble_lambda=float(args.resemble_lambda),
        voicefixer_device_preference=args.voicefixer_device or args.device or "auto",
        resemble_device_preference=args.resemble_device or args.device or "auto",
        use_sidon=bool(args.sidon),
        sidon_device_preference=args.sidon_device or args.device or "auto",
        sidon_input_peak=float(args.sidon_input_peak),
        sidon_high_pass_hz=float(args.sidon_high_pass_hz),
        sidon_chunk_seconds=int(args.sidon_chunk_seconds),
        sidon_pre_padding=int(args.sidon_pre_padding),
        sidon_trailing_pad=int(args.sidon_trailing_pad),
        sidon_decoder_trim=int(args.sidon_decoder_trim),
        sidon_stereo_mix_mode=args.sidon_stereo_mix_mode,
        sidon_output_bit_depth=args.sidon_output_bit_depth,
        sidon_audio_backend_preference=args.sidon_audio_backend_preference,
        sidon_feature_cache_frames=int(args.sidon_feature_cache_frames),
    ).normalize()

    if not settings.use_voicefixer and not settings.use_resemble and not settings.use_sidon:
        raise ValueError("최소 1개 이상의 모델을 선택해야 합니다.")

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    files = discover_audio_files(input_dir, recursive=bool(args.recursive))
    if not files:
        raise FileNotFoundError(f"No WAV files found in input folder: {input_dir}")

    pending_jobs = [NoiseJob.from_path(wav_path, settings) for wav_path in files]
    session = NoiseSession(
        input_folder=str(input_dir),
        output_dir=str(output_dir),
        manifest_path=str(Path(args.manifest).resolve()),
        settings=settings,
        jobs=[],
        session_status="running",
        total_files=len(files),
    )
    write_manifest(session)

    print_section("모델 추론")
    print_kv("입력 폴더", input_dir)
    print_kv("출력 폴더", output_dir)
    print_kv("매니페스트", session.manifest_path)
    print_kv("선택 모델", settings.target_label())
    print_kv("VoiceFixer", f"사용={settings.use_voicefixer}, mode={settings.voicefixer_mode}, device={settings.voicefixer_device_preference}")
    print_kv("Resemble", f"사용={settings.use_resemble}, task={settings.resemble_task}, solver={settings.resemble_solver}, nfe={settings.resemble_nfe}, tau={settings.resemble_tau}, lambda={settings.resemble_lambda}, device={settings.resemble_device_preference}")
    print_kv("Sidon", f"사용={settings.use_sidon}, device={settings.sidon_device_preference}")
    print_kv("Sidon detail", f"peak={settings.sidon_input_peak:.3f}, highPass={settings.sidon_high_pass_hz:.1f}Hz, chunk={settings.sidon_chunk_seconds}s, prePad={settings.sidon_pre_padding}, trailPad={settings.sidon_trailing_pad}, trim={settings.sidon_decoder_trim}")
    print_kv("Sidon IO", f"stereo={settings.sidon_stereo_mix_mode}, bitDepth={settings.sidon_output_bit_depth}, backend={settings.sidon_audio_backend_preference}, cacheFrames={settings.sidon_feature_cache_frames}")

    print_section("런타임 점검")
    try:
        check_runtime(print)
        print_section("모델 사전 준비")
        prepare_pipeline(settings, print)
    except Exception:
        session.session_status = "failed"
        write_manifest(session)
        raise

    any_failed = False
    cancelled = False
    progress_line = LiveConsoleLine()

    for index, (wav_path, job) in enumerate(zip(files, pending_jobs), start=1):
        if cancel_requested(args):
            cancelled = True
            break

        job.status = "running"
        job.active_stage = "queued"
        write_manifest(session)
        current_stage = "준비"
        current_detail = ""

        def render_status() -> None:
            progress_line.update(format_progress_line("running", index, len(files), wav_path.name, stage=current_stage, detail=current_detail, completed=index - 1))

        def on_stage_changed(stage: str) -> None:
            nonlocal current_stage, current_detail
            raise_if_cancelled(args)
            current_stage = stage
            current_detail = ""
            job.active_stage = stage
            write_manifest(session)
            render_status()

        def on_detail_changed(detail: str) -> None:
            nonlocal current_detail
            raise_if_cancelled(args)
            current_detail = detail
            render_status()

        on_stage_changed("준비")

        try:
            outputs = run_pipeline(
                input_path=wav_path,
                output_dir=output_dir,
                settings=settings,
                log=print,
                on_stage_changed=on_stage_changed,
                on_detail_changed=on_detail_changed,
            )
            job.voicefixer_output_path = str(outputs.get("voicefixer_output_path", ""))
            job.resemble_output_path = str(outputs.get("resemble_output_path", ""))
            job.sidon_output_path = str(outputs.get("sidon_output_path", ""))
            job.final_output_path = str(outputs.get("final_output_path", str(wav_path)))
            job.failed_stages = ",".join(str(stage) for stage in outputs.get("failed_stages", []))
            job.error = str(outputs.get("error", ""))

            has_any_result = any(
                value
                for value in (
                    job.voicefixer_output_path,
                    job.resemble_output_path,
                    job.sidon_output_path,
                )
            )
            has_stage_error = bool(job.failed_stages)

            if has_stage_error and has_any_result:
                any_failed = True
                job.active_stage = "done"
                job.status = "completed_with_errors"
                current_stage = "완료"
                current_detail = f"일부 단계 실패 · {job.failed_stages}"
                render_status()
            elif has_stage_error:
                any_failed = True
                failed_stage_list = [part.strip() for part in job.failed_stages.split(",") if part.strip()]
                job.active_stage = failed_stage_list[-1] if failed_stage_list else getattr(args, "stage", "failed")
                job.status = "failed"
                current_stage = "실패"
                current_detail = job.error or "오류 발생"
                render_status()
                print(f"[파일 실패] {wav_path.name} · {job.error}")
            else:
                job.active_stage = "done"
                job.status = "completed"
                current_stage = "완료"
                final_output_name = Path(str(outputs.get("final_output_path", wav_path.name))).name
                current_detail = final_output_name
                render_status()
        except CancelledRun:
            cancelled = True
            job.status = "failed"
            job.active_stage = "cancelled"
            job.error = "Cancelled by user"
            current_stage = "cancelled"
            current_detail = "cancelled"
            render_status()
        except Exception as exc:  # noqa: BLE001
            any_failed = True
            job.status = "failed"
            if not job.active_stage or job.active_stage == "queued":
                job.active_stage = getattr(exc, "stage", "failed")
            current_stage = job.active_stage
            current_detail = "실패"
            render_status()
            job.error = f"{type(exc).__name__}: {exc}"
            print(f"[파일 실패] {wav_path.name} · {job.error}")
            traceback.print_exc()
        finally:
            if job not in session.jobs:
                session.jobs.append(job)
            write_manifest(session)
        if cancelled:
            break

    progress_line.finish(format_finished_line(len(files), failed=sum(1 for job in session.jobs if job.status == "failed")))
    session.session_status = "failed" if cancelled else "completed_with_errors" if any_failed else "completed"
    write_manifest(session)
    print_section("스피카 추론 종료")
    print_kv("전체 파일 수", len(files))
    print_kv("실패 포함 여부", "예" if any_failed else "아니오")
    print_kv("세션 상태", session.session_status)
    return 130 if cancelled else 1 if any_failed else 0
