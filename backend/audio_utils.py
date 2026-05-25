from __future__ import annotations

try:
    from backend.audio_conversion_cache import (
        AUDIO_CONVERT_STAGE,
        AUDIO_CONVERTING_PROGRESS_LABEL,
        AUDIO_CONVERTING_STAGE,
        AUDIO_COPY_WAV_STAGE,
        AudioCacheProgressCallback,
        AudioInputPreparationCancelled,
        PreparedAudioInput,
        _cache_target_for_relative,
        _cached_wav_is_current,
        _convert_audio_to_wav,
        _copy_audio_to_cache,
        _copy_source_mtime,
        _log_audio_converting,
        _log_audio_converting_kv,
        _prepare_selected_sources,
        _raise_if_cancelled,
        _read_any_audio,
        _safe_relative_audio_path,
        _unique_cache_target,
        prepare_audio_wav_cache,
        prepare_runtime_audio_input,
        prepare_selected_audio_input_cache,
    )
except ModuleNotFoundError:
    from audio_conversion_cache import (  # type: ignore[no-redef]
        AUDIO_CONVERT_STAGE,
        AUDIO_CONVERTING_PROGRESS_LABEL,
        AUDIO_CONVERTING_STAGE,
        AUDIO_COPY_WAV_STAGE,
        AudioCacheProgressCallback,
        AudioInputPreparationCancelled,
        PreparedAudioInput,
        _cache_target_for_relative,
        _cached_wav_is_current,
        _convert_audio_to_wav,
        _copy_audio_to_cache,
        _copy_source_mtime,
        _log_audio_converting,
        _log_audio_converting_kv,
        _prepare_selected_sources,
        _raise_if_cancelled,
        _read_any_audio,
        _safe_relative_audio_path,
        _unique_cache_target,
        prepare_audio_wav_cache,
        prepare_runtime_audio_input,
        prepare_selected_audio_input_cache,
    )

try:
    from backend.audio_conversion_cli import run_audio_converting_cli
except ModuleNotFoundError:
    from audio_conversion_cli import run_audio_converting_cli  # type: ignore[no-redef]

try:
    from backend.audio_discovery import (
        AUDIO_EXTS,
        AUDIO_INPUT_EXTS,
        AUDIO_SOURCE_MAP_FILE,
        GENERATED_AUDIO_FOLDERS,
        WAV_AUDIO_EXTS,
        _discover_audio_files_from_source_map,
        _discover_files,
        _is_generated_path,
        discover_audio_files,
        discover_input_audio_files,
    )
except ModuleNotFoundError:
    from audio_discovery import (  # type: ignore[no-redef]
        AUDIO_EXTS,
        AUDIO_INPUT_EXTS,
        AUDIO_SOURCE_MAP_FILE,
        GENERATED_AUDIO_FOLDERS,
        WAV_AUDIO_EXTS,
        _discover_audio_files_from_source_map,
        _discover_files,
        _is_generated_path,
        discover_audio_files,
        discover_input_audio_files,
    )

try:
    from backend.audio_reading import audio_info, concat_segments, iter_fixed_windows, read_audio, read_audio_native
except ModuleNotFoundError:
    from audio_reading import audio_info, concat_segments, iter_fixed_windows, read_audio, read_audio_native  # type: ignore[no-redef]
