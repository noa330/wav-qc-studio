import { useEffect, useState, useMemo } from "react";
import { Music, Play, Pause, Rewind, FastForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { useWorkspaceAudioSync, requestWorkspaceAudioSeek, requestWorkspaceAudioPlay, requestWorkspaceAudioVolume } from "./workspace-audio-sync";
import { AudioProgressSlider } from "./AudioProgressSlider";

type WorkspaceFloatingAudioPlayerProps = {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
};

export function WorkspaceFloatingAudioPlayer({ workspaceId, runtime }: WorkspaceFloatingAudioPlayerProps) {
  // 1. Fetch the workspace state and sync snapshot
  const state = runtime.getState(workspaceId);
  const sync = useWorkspaceAudioSync(workspaceId);

  // 2. Find the selected audio file path
  const audioPath = state.selectedAudioPath ?? sync.audioPath;

  // 3. The tab host publishes this only for a tab group that contains playback.
  const isVisible = Boolean(audioPath) && sync.activeTabIsPlayback === false;

  // 4. Handle play/pause, seek, volume
  const isPlaying = sync.isPlaying ?? false;
  const currentTime = sync.currentTime ?? 0;
  const duration = sync.duration ?? 0;
  const volume = sync.volume ?? 1.0;

  const handlePlayPause = () => {
    requestWorkspaceAudioPlay(workspaceId, !isPlaying);
  };

  const handleSeek = (time: number) => {
    requestWorkspaceAudioSeek(workspaceId, time);
  };

  const handleVolumeChange = (newVolume: number) => {
    requestWorkspaceAudioVolume(workspaceId, newVolume);
  };

  // 7. Resolve Metadata (File name, Format, Sample Rate, Channels)
  const filename = useMemo(() => {
    if (!audioPath) return "";
    const parts = audioPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? "";
  }, [audioPath]);

  const metadata = useMemo(() => {
    if (!state.table.rows || !state.selectedRowId) {
      return { format: "WAV", sampleRate: "22,050 Hz", channels: "Mono" };
    }
    const row = state.table.rows.find((r) => r.id === state.selectedRowId);
    if (!row) {
      return { format: "WAV", sampleRate: "22,050 Hz", channels: "Mono" };
    }

    let srText = "22,050 Hz";
    const srCell = row.cells.sample_rate || row.cells.sampleRate || row.cells["샘플레이트"] || row.raw?.sample_rate || row.raw?.sampleRate;
    if (srCell) {
      const parsed = parseInt(String(srCell).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(parsed) && parsed > 0) {
        srText = parsed.toLocaleString() + " Hz";
      }
    }

    let chText = "Mono";
    const chCell = row.cells.channels || row.cells["채널"] || row.raw?.channels;
    if (chCell) {
      const valStr = String(chCell).trim().toLowerCase();
      if (valStr === "2" || valStr.includes("stereo") || valStr.includes("스테레오")) {
        chText = "Stereo";
      } else if (valStr === "1" || valStr.includes("mono") || valStr.includes("모노")) {
        chText = "Mono";
      } else {
        const parsed = parseInt(valStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          chText = parsed === 2 ? "Stereo" : parsed === 1 ? "Mono" : `${parsed} Ch`;
        }
      }
    }

    let formatText = "WAV";
    if (audioPath) {
      const ext = audioPath.substring(audioPath.lastIndexOf(".")).toLowerCase();
      if (ext) {
        formatText = ext.replace(".", "").toUpperCase();
      }
    }

    return {
      format: formatText,
      sampleRate: srText,
      channels: chText,
    };
  }, [state.table.rows, state.selectedRowId, audioPath]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 72, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative shrink-0 bg-[var(--panel-bg)] border-t border-[var(--panel-stroke)] shadow-[0_-3px_12px_rgba(0,0,0,0.045)] z-[1000] grid grid-cols-[1fr_auto_1fr] items-center px-6 select-none overflow-hidden"
        >
          {/* Left Column (1fr): Music icon and file details */}
          <div className="flex items-center gap-4 min-w-0 justify-start pr-4">
            <div className="flex items-center justify-center size-10 rounded-[5px] bg-[var(--music-icon-box-bg)] text-[var(--accent-blue)] shrink-0">
              <Music className="size-5" />
            </div>
            <div className="flex flex-col min-w-0 text-left justify-center">
              <span className="text-sm font-semibold text-[var(--primary-text)] truncate font-sans" title={filename}>
                {filename}
              </span>
              <span className="text-xs text-[var(--secondary-text)] mt-0.5 font-sans">
                {metadata.format} • {metadata.sampleRate} • {metadata.channels}
              </span>
            </div>
          </div>

          {/* Center Column (auto): Playback controls - Guaranteed mathematically centered & zero-overlap! */}
          <div className="flex items-center gap-5 justify-center px-6 shrink-0">
            <button
              type="button"
              onClick={() => handleSeek(currentTime - 5)}
              disabled={duration <= 0}
              className="flex items-center justify-center size-9 text-[var(--secondary-text)] hover:text-[var(--accent-blue)] transition-colors focus:outline-none disabled:opacity-35"
              title="5초 뒤로"
            >
              <Rewind className="size-4" fill="currentColor" />
            </button>

            <button
              type="button"
              onClick={handlePlayPause}
              disabled={duration <= 0}
              className="flex items-center justify-center size-10 rounded-full bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity focus:outline-none shrink-0"
            >
              {isPlaying ? <Pause className="size-4 fill-white" /> : <Play className="size-4 fill-white ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => handleSeek(currentTime + 5)}
              disabled={duration <= 0}
              className="flex items-center justify-center size-9 text-[var(--secondary-text)] hover:text-[var(--accent-blue)] transition-colors focus:outline-none disabled:opacity-35"
              title="5초 앞으로"
            >
              <FastForward className="size-4" fill="currentColor" />
            </button>
          </div>

          {/* Right Column (1fr): Progress bar slider, Time display, and Volume control */}
          <div className="flex items-center gap-4 justify-end min-w-0 pl-4">
            {/* Time display & Progress bar */}
            <AudioProgressSlider
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              disabled={duration <= 0}
              railHeightClassName="h-[4px]"
              className="min-w-[200px]"
            />

            {/* Separator line */}
            <span className="h-4 w-px bg-[var(--panel-stroke)] opacity-85 shrink-0" />

            {/* Volume control */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleVolumeChange(volume > 0 ? 0 : 0.8)}
                className="text-[var(--secondary-text)] hover:text-[var(--accent-blue)] transition-colors focus:outline-none shrink-0"
              >
                {volume === 0 ? (
                  <VolumeX className="size-4.5" />
                ) : volume < 0.5 ? (
                  <Volume1 className="size-4.5" />
                ) : (
                  <Volume2 className="size-4.5" />
                )}
              </button>
              <div className="relative h-8 w-[72px] flex items-center shrink-0">
                <div className="absolute left-0 right-0 h-[3px] rounded bg-[var(--slider-rail)]" />
                <div
                  className="absolute h-[3px] rounded bg-[var(--accent-blue)]"
                  style={{ left: 0, width: `${volume * 100}%` }}
                />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-20"
                  aria-label="볼륨 조절"
                />
                <div
                  className="pointer-events-none absolute wpf-slider-thumb bg-[var(--accent-blue)] -translate-x-1/2 z-10"
                  style={{ left: `${volume * 100}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
