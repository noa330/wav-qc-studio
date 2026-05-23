from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path


def import_runtime_modules():
    if __package__ is None or __package__ == "":
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from backend.audio_utils import discover_audio_files  # type: ignore
        from backend.console_ui import LiveConsoleLine, format_finished_line, format_progress_line, print_banner, print_kv, print_section  # type: ignore
        from backend.slicer.manifest import write_manifest  # type: ignore
        from backend.slicer.pipeline import prepare_pipeline, run_export_pipeline, run_pipeline, run_tagging_pipeline  # type: ignore
        from backend.slicer.schema import SlicerJob, SlicerSession, SlicerSettings  # type: ignore
        from backend.runtime import model_cache_root  # type: ignore
    else:
        from ..audio_utils import discover_audio_files  # type: ignore
        from ..console_ui import LiveConsoleLine, format_finished_line, format_progress_line, print_banner, print_kv, print_section  # type: ignore
        from .manifest import write_manifest  # type: ignore
        from .pipeline import prepare_pipeline, run_export_pipeline, run_pipeline, run_tagging_pipeline  # type: ignore
        from .schema import SlicerJob, SlicerSession, SlicerSettings  # type: ignore
        from ..runtime import model_cache_root  # type: ignore
    return (
        discover_audio_files,
        LiveConsoleLine,
        print_banner,
        print_kv,
        print_section,
        format_finished_line,
        format_progress_line,
        write_manifest,
        prepare_pipeline,
        run_export_pipeline,
        run_pipeline,
        run_tagging_pipeline,
        SlicerJob,
        SlicerSession,
        SlicerSettings,
        model_cache_root,
    )


class CancelledRun(Exception):
    pass


def cancel_requested(args: argparse.Namespace) -> bool:
    cancel_file = str(getattr(args, "cancel_file", "") or "")
    return bool(cancel_file and Path(cancel_file).exists())


def raise_if_cancelled(args: argparse.Namespace) -> None:
    if cancel_requested(args):
        raise CancelledRun("Cancelled by user")


def run_slicer_session(args: argparse.Namespace) -> int:
    (
        discover_audio_files,
        LiveConsoleLine,
        print_banner,
        print_kv,
        print_section,
        format_finished_line,
        format_progress_line,
        write_manifest,
        prepare_pipeline,
        run_export_pipeline,
        run_pipeline,
        run_tagging_pipeline,
        SlicerJob,
        SlicerSession,
        SlicerSettings,
        model_cache_root,
    ) = import_runtime_modules()

    workflow_mode = str(getattr(args, "workflow_mode", "slice") or "slice").strip().lower()
    is_tagging = workflow_mode == "tag"
    is_export = workflow_mode == "export"
    workflow_title = "Tagging" if is_tagging else "Slice"

    print_banner(f"{workflow_title} runner")
    print_kv("Python", sys.executable)
    print_kv("Working directory", Path.cwd())
    print_kv("Model cache", model_cache_root())

    settings = SlicerSettings(
        split_gap_sec=float(args.split_gap_sec),
        device_preference=args.device or "auto",
        speech_threshold=float(args.speech_threshold),
        smooth_window_size=int(args.smooth_window_size),
        min_event_frame=int(args.min_event_frame),
        max_event_frame=int(args.max_event_frame),
        min_silence_frame=int(args.min_silence_frame),
        merge_silence_frame=int(args.merge_silence_frame),
        extend_speech_frame=int(args.extend_speech_frame),
        chunk_max_frame=int(args.chunk_max_frame),
        speech_pad_ms=float(args.speech_pad_ms),
        zero_cross_search_ms=float(args.zero_cross_search_ms),
        quiet_boundary_search_ms=float(args.quiet_boundary_search_ms),
        monitor_merge_gap_ms=float(args.monitor_merge_gap_ms),
        monitor_merge_max_ms=float(args.monitor_merge_max_ms),
        splice_ms=float(args.splice_ms),
        floor_gain_db=float(args.floor_gain_db),
        normalize_max=float(args.normalize_max),
        normalize_alpha=float(args.normalize_alpha),
        pretrained_sed_model_key=str(args.pretrained_sed_model_key),
        pretrained_sed_thresholds=str(args.pretrained_sed_thresholds),
        pretrained_sed_median_window=int(args.pretrained_sed_median_window),
        pretrained_sed_frame_interval=float(args.pretrained_sed_frame_interval),
        pretrained_sed_top_k=int(args.pretrained_sed_top_k),
        pretrained_sed_min_score=float(args.pretrained_sed_min_score),
    ).normalize()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    files = discover_audio_files(input_dir, recursive=bool(args.recursive))
    if not files:
        raise FileNotFoundError(f"No WAV files found in input folder: {input_dir}")

    session = SlicerSession(
        input_folder=str(input_dir),
        output_dir=str(output_dir),
        manifest_path=str(Path(args.manifest).resolve()),
        settings=settings,
        jobs=[SlicerJob.from_path(wav_path) for wav_path in files],
        session_status="running",
    )
    write_manifest(session)

    print_section("모델 추론")
    print_kv("Workflow", workflow_mode)
    print_kv("Input folder", input_dir)
    print_kv("Output folder", output_dir)
    print_kv("Manifest", session.manifest_path)
    print_kv("WAV files", len(files))
    print_kv("Split gap", f"{settings.split_gap_sec:.2f}s")
    print_kv("Normalize max", f"{settings.normalize_max:.2f}")
    print_kv("Normalize alpha", f"{settings.normalize_alpha:.2f}")
    print_kv("Device", settings.device_preference)
    print_kv("FireRed speech threshold", f"{settings.speech_threshold:.3f}")
    print_kv("FireRed frames", f"smooth={settings.smooth_window_size}, min={settings.min_event_frame}, max={settings.max_event_frame}, minSilence={settings.min_silence_frame}, merge={settings.merge_silence_frame}, extend={settings.extend_speech_frame}, chunkMax={settings.chunk_max_frame}")
    print_kv("Postprocess", f"pad={settings.speech_pad_ms:.1f}ms, zeroCross={settings.zero_cross_search_ms:.1f}ms, quiet={settings.quiet_boundary_search_ms:.1f}ms, monitorMerge={settings.monitor_merge_gap_ms:.1f}ms, mergeMax={settings.monitor_merge_max_ms:.1f}ms, splice={settings.splice_ms:.1f}ms, floor={settings.floor_gain_db:.1f}dB")
    print_kv(
        "PretrainedSED",
        (
            f"model={settings.pretrained_sed_model_key}, thresholds={','.join(f'{value:.2f}' for value in settings.pretrained_sed_thresholds)}, "
            f"median={settings.pretrained_sed_median_window}, frameInterval={settings.pretrained_sed_frame_interval:.2f}s, "
            f"topK={settings.pretrained_sed_top_k}, minScore={settings.pretrained_sed_min_score:.2f}"
        ),
    )

    print_section("Preparing models")
    try:
        detector, tagger = prepare_pipeline(
            settings,
            print,
            include_detector=not is_tagging and not is_export,
            include_tagger=is_tagging,
        )
    except Exception as exc:  # noqa: BLE001
        session.session_status = "failed"
        for job in session.jobs:
            job.status = "failed"
            job.active_stage = "model-prepare"
            job.error = f"{type(exc).__name__}: {exc}"
        write_manifest(session)
        print(f"[model prepare failed] {type(exc).__name__}: {exc}")
        traceback.print_exc()
        print_section(f"{workflow_title} finished")
        print_kv("Total files", len(files))
        print_kv("Result rows", len(session.slices))
        print_kv("Failed", "yes")
        print_kv("Session status", session.session_status)
        return 1

    any_failed = False
    cancelled = False
    progress_line = LiveConsoleLine()

    for index, (wav_path, job) in enumerate(zip(files, session.jobs), start=1):
        if cancel_requested(args):
            cancelled = True
            break

        job.status = "running"
        job.active_stage = "queued"
        write_manifest(session)
        current_stage = "prepare"
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

        def on_slice_ready(row) -> None:
            raise_if_cancelled(args)
            row.index = len(session.slices) + 1
            session.slices.append(row)
            write_manifest(session)

        on_stage_changed("prepare")

        try:
            if is_export:
                outputs = run_export_pipeline(
                    input_path=wav_path,
                    output_dir=output_dir,
                    job_index=index,
                    settings=settings,
                    markers_json=Path(str(getattr(args, "markers_json", ""))).resolve(),
                    log=print,
                    on_stage_changed=on_stage_changed,
                    on_detail_changed=on_detail_changed,
                    on_slice_ready=on_slice_ready,
                )
            elif is_tagging:
                outputs = run_tagging_pipeline(
                    input_path=wav_path,
                    job_index=index,
                    settings=settings,
                    tagger=tagger,
                    log=print,
                    on_stage_changed=on_stage_changed,
                    on_detail_changed=on_detail_changed,
                    on_slice_ready=on_slice_ready,
                )
            else:
                outputs = run_pipeline(
                    input_path=wav_path,
                    output_dir=output_dir,
                    job_index=index,
                    settings=settings,
                    detector=detector,
                    log=print,
                    on_stage_changed=on_stage_changed,
                    on_detail_changed=on_detail_changed,
                    on_slice_ready=on_slice_ready,
                )

            job.detected_speech_count = int(outputs.get("detected_speech_count", 0))
            job.slice_count = int(outputs.get("slice_count", 0))
            job.muted_output_path = str(outputs.get("muted_output_path", ""))
            job.active_stage = "done"
            job.status = "completed"
            current_stage = "done"
            current_detail = f"{job.slice_count} row(s)"
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
                job.active_stage = "failed"
            current_stage = job.active_stage
            current_detail = "failed"
            render_status()
            job.error = f"{type(exc).__name__}: {exc}"
            print(f"[file failed] {wav_path.name} - {job.error}")
            traceback.print_exc()
        finally:
            write_manifest(session)
        if cancelled:
            break

    progress_line.finish(format_finished_line(len(files), failed=sum(1 for job in session.jobs if job.status == "failed")))
    session.session_status = "failed" if cancelled else "completed_with_errors" if any_failed else "completed"
    write_manifest(session)
    print_section(f"{workflow_title} finished")
    print_kv("Total files", len(files))
    print_kv("Result rows", len(session.slices))
    print_kv("Failed", "yes" if any_failed else "no")
    print_kv("Session status", session.session_status)
    return 130 if cancelled else 1 if any_failed else 0
