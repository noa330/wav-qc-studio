import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, Crop, Scissors, Trash2, X, Play as PlayIcon, Pause as PauseIcon, Volume1, Volume2, VolumeX, Rewind, FastForward } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { AudioEditOperation, DataTableRow, WaveformData } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { WaveformSurface, type WaveformMarker } from "@/shared/components/waveform";
import { useAudioTransport } from "@/shared/hooks/use-audio-transport";
import { fadeSlideUpMotion, menuMotion, softPressTap } from "@/shared/motion";
import { EmptyPanel, TransportButtons } from "./workspace-panel-primitives";
import { clamp, formatTime } from "./workspace-ui-utils";
import { publishWorkspaceAudioPosition, useWorkspaceAudioSync } from "./workspace-audio-sync";
import {
  createAudioRangeMarker,
  removeAudioRangeMarker,
  runAudioEditOperation,
  selectAudioRangeMarker,
  setAudioEditDuration,
  updateAudioRangeMarkerBounds,
  useAudioEditClipboard,
  useAudioEditEntry,
  zoomAudioEditView,
} from "../../state/audio-edit-session";

const PREVIEW_END_EPSILON_SECONDS = 0.008;

type AudioMarkerMenuState = {
  x: number;
  y: number;
  markerId: string;
};

export function WorkspaceEditableAudioPane({
  row,
  audioPath,
  editable = true,
  emptyText = "오디오 행을 선택하세요.",
  syncKey,
  muteIntervals = [],
  muteIntervalsEnabled = false,
  audioEditScopeId,
  showRuler = false,
  rulerPosition = "top",
  layout = "simple",
  compareTitle,
  compareBadge,
  compareBadgeColor = "purple",
  customFooter,
}: {
  row?: DataTableRow;
  audioPath?: string;
  editable?: boolean;
  emptyText?: string;
  syncKey?: string;
  muteIntervals?: Array<{ start: number; end: number }>;
  muteIntervalsEnabled?: boolean;
  audioEditScopeId?: string;
  showRuler?: boolean;
  rulerPosition?: "top" | "bottom";
  layout?: "simple" | "playback" | "compare";
  compareTitle?: string;
  compareBadge?: string;
  compareBadgeColor?: "purple" | "green";
  customFooter?: ReactNode;
}) {
  const active = Boolean(row || audioPath);
  const editEntry = useAudioEditEntry(editable ? audioPath : undefined, audioEditScopeId);
  const editClipboard = useAudioEditClipboard();
  const effectiveAudioPath = editable && audioPath ? editEntry.effectivePath : audioPath;
  const transport = useAudioTransport(effectiveAudioPath, 0, undefined, editable ? editEntry.revision : 0);
  const audioSync = useWorkspaceAudioSync(syncKey);
  const handledSeekRequestRef = useRef<number | undefined>(undefined);
  const handledPreviewRequestRef = useRef<number | undefined>(undefined);
  const handledPlayRequestRef = useRef<number | undefined>(undefined);
  const handledVolumeRequestRef = useRef<number | undefined>(undefined);
  const publishedAudioPathRef = useRef<string | undefined>(undefined);
  const [previewSegment, setPreviewSegment] = useState<{ id: number; start: number; end: number } | undefined>();
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [menu, setMenu] = useState<AudioMarkerMenuState | undefined>();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [localVolume, setLocalVolume] = useState(1.0);
  const durationSeconds = Math.max(0, editEntry.durationSeconds ?? waveform?.durationSeconds ?? transport.duration ?? 0);
  const activeMarker = editable ? editEntry.markers.find((marker) => marker.id === editEntry.activeMarkerId) : undefined;
  const markerMenuEnabled = editable && active && Boolean(audioPath) && Boolean(activeMarker) && !editEntry.busy;
  const markers = useMemo<WaveformMarker[]>(() => {
    if (!editable || durationSeconds <= 0) {
      return [];
    }

    return editEntry.markers.flatMap((marker) => {
      const start = clamp(marker.startSec / durationSeconds, 0, 1);
      const end = clamp(marker.endSec / durationSeconds, start, 1);
      if (end <= start) {
        return [];
      }
      return [
        {
          id: marker.id,
          start,
          end,
          selected: marker.id === editEntry.activeMarkerId,
        },
      ];
    });
  }, [durationSeconds, editEntry.activeMarkerId, editEntry.markers, editable]);

  useEffect(() => {
    setPreviewSegment(undefined);
    setMenu(undefined);
  }, [audioEditScopeId, audioPath]);

  useEffect(() => {
    if (!editable || !audioPath || !waveform || waveform.path !== effectiveAudioPath) {
      return;
    }
    setAudioEditDuration(audioPath, waveform.durationSeconds, audioEditScopeId);
  }, [audioEditScopeId, audioPath, editable, effectiveAudioPath, waveform]);

  useEffect(() => {
    if (publishedAudioPathRef.current !== audioPath) {
      publishedAudioPathRef.current = audioPath;
      publishWorkspaceAudioPosition(syncKey, {
        audioPath,
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        volume: localVolume,
      });
      return;
    }

    publishWorkspaceAudioPosition(syncKey, {
      audioPath,
      currentTime: transport.currentTime,
      duration: transport.duration,
      isPlaying: transport.isPlaying,
      volume: localVolume,
    });
  }, [audioPath, syncKey, transport.currentTime, transport.duration, transport.isPlaying, localVolume]);

  useEffect(() => {
    const request = audioSync.playRequest;
    if (!request || handledPlayRequestRef.current === request.id) {
      return;
    }
    handledPlayRequestRef.current = request.id;
    if (request.play) {
      transport.play();
    } else {
      transport.pause();
    }
  }, [audioSync.playRequest, transport]);

  useEffect(() => {
    const request = audioSync.volumeRequest;
    if (!request || handledVolumeRequestRef.current === request.id) {
      return;
    }
    handledVolumeRequestRef.current = request.id;
    setLocalVolume(request.volume);
    transport.setVolume(request.volume);
  }, [audioSync.volumeRequest, transport]);

  useEffect(() => {
    const request = audioSync.seekRequest;
    if (!request || handledSeekRequestRef.current === request.id) {
      return;
    }

    handledSeekRequestRef.current = request.id;
    setPreviewSegment(undefined);
    transport.seek(request.time);
  }, [audioSync.seekRequest, transport]);

  useEffect(() => {
    const request = audioSync.previewRequest;
    if (!request || handledPreviewRequestRef.current === request.id) {
      return;
    }

    handledPreviewRequestRef.current = request.id;
    setPreviewSegment({ id: request.id, start: request.start, end: request.end });
    transport.setMuted(false);
    transport.setVolume(1);
    transport.seek(request.start);
    transport.play();
  }, [audioSync.previewRequest, transport]);

  useEffect(() => {
    if (!previewSegment) {
      return;
    }

    if (transport.currentTime < previewSegment.end - PREVIEW_END_EPSILON_SECONDS) {
      return;
    }

    transport.pause();
    transport.seek(previewSegment.end);
    transport.setMuted(false);
    transport.setVolume(1);
    setPreviewSegment(undefined);
  }, [previewSegment, transport]);

  useEffect(() => {
    if (previewSegment) {
      transport.setMuted(false);
      transport.setVolume(1);
      return;
    }

    if (!muteIntervalsEnabled || muteIntervals.length === 0 || !transport.isPlaying) {
      transport.setMuted(false);
      transport.setVolume(1);
      return;
    }

    transport.setMuted(false);
    transport.setVolume(isInsideMuteInterval(transport.currentTime, muteIntervals) ? 0 : 1);
  }, [muteIntervals, muteIntervalsEnabled, previewSegment, transport]);

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      setMenu(undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(undefined);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  const createMarkerFromRange = (start: number, end: number) => {
    if (!editable || !audioPath || durationSeconds <= 0) {
      return;
    }

    createAudioRangeMarker(audioPath, start * durationSeconds, end * durationSeconds, audioEditScopeId);
  };

  const openMarkerMenu = (markerId: string, event: ReactMouseEvent<Element>) => {
    if (!editable || !audioPath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectAudioRangeMarker(audioPath, markerId, audioEditScopeId);
    setMenu({ x: event.clientX, y: event.clientY, markerId });
  };

  const updateMarkerRange = (markerId: string, start: number, end: number) => {
    if (!editable || !audioPath || durationSeconds <= 0) {
      return;
    }

    updateAudioRangeMarkerBounds(audioPath, markerId, start * durationSeconds, end * durationSeconds, audioEditScopeId);
  };

  const runMenuAction = async (operation: AudioEditOperation) => {
    if (!audioPath || !menu) {
      return;
    }

    setMenu(undefined);
    transport.release();
    await runAudioEditOperation(audioPath, operation, menu.markerId, audioEditScopeId);
  };

  const removeMenuMarker = () => {
    if (!audioPath || !menu) {
      return;
    }

    setMenu(undefined);
    removeAudioRangeMarker(audioPath, menu.markerId, audioEditScopeId);
  };

  const handleVolumeChange = (newVolume: number) => {
    setLocalVolume(newVolume);
    transport.setVolume(newVolume);
  };

  const handlePlayPause = () => {
    if (transport.isPlaying) {
      transport.pause();
    } else {
      transport.play();
    }
  };

  const resolveMetadata = () => {
    const durationText = durationSeconds > 0 ? `${durationSeconds.toFixed(2)}s` : "-";
    
    let srVal = 22050;
    let srText = "22,050 Hz";
    const srCell = row?.cells?.sample_rate || row?.cells?.sampleRate || row?.cells?.["샘플레이트"] || row?.raw?.sample_rate || row?.raw?.sampleRate;
    if (srCell) {
      const parsed = parseInt(String(srCell).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(parsed) && parsed > 0) {
        srVal = parsed;
        srText = parsed.toLocaleString() + " Hz";
      }
    }
    
    let chVal = 1;
    let chText = "Mono";
    const chCell = row?.cells?.channels || row?.cells?.["채널"] || row?.raw?.channels;
    if (chCell) {
      const valStr = String(chCell).trim().toLowerCase();
      if (valStr === "2" || valStr.includes("stereo") || valStr.includes("스테레오")) {
        chVal = 2;
        chText = "Stereo";
      } else if (valStr === "1" || valStr.includes("mono") || valStr.includes("모노")) {
        chVal = 1;
        chText = "Mono";
      } else {
        const parsed = parseInt(valStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          chVal = parsed;
          chText = parsed === 2 ? "Stereo" : parsed === 1 ? "Mono" : `${parsed} Ch`;
        }
      }
    }

    let bdVal = 16;
    let bdText = "16-bit";
    const bdCell = row?.cells?.bit_depth || row?.cells?.bitDepth || row?.raw?.bitDepth || row?.raw?.bit_depth;
    if (bdCell) {
      const parsed = parseInt(String(bdCell).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(parsed) && parsed > 0) {
        bdVal = parsed;
        bdText = `${parsed}-bit`;
      }
    }

    let formatText = "WAV";
    if (effectiveAudioPath) {
      const ext = effectiveAudioPath.substring(effectiveAudioPath.lastIndexOf(".")).toLowerCase();
      if (ext) {
        formatText = ext.replace(".", "").toUpperCase();
      }
    }

    let sizeText = "-";
    const sizeCell = row?.cells?.fileSize || row?.cells?.file_size || row?.cells?.["파일크기"] || row?.cells?.["파일 크기"] || row?.raw?.fileSize || row?.raw?.file_size;
    if (sizeCell) {
      sizeText = String(sizeCell);
    } else if (durationSeconds > 0) {
      const bytes = Math.round(srVal * chVal * (bdVal / 8) * durationSeconds + 44);
      if (bytes > 1024 * 1024) {
        sizeText = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      } else {
        sizeText = `${(bytes / 1024).toFixed(1)} KB`;
      }
    }

    return {
      duration: durationText,
      sampleRate: srText,
      channels: chText,
      bitDepth: bdText,
      format: formatText,
      fileSize: sizeText
    };
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col justify-between">
      {layout === "compare" ? (
        <>
          {/* 1. Header Row */}
          <div className="flex items-center justify-between w-full mb-3 select-none shrink-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--primary-text)]">
                {compareTitle}
              </span>
              {compareBadge && (
                <span className={cn(
                  "shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded-[3px] border",
                  compareBadgeColor === "purple" 
                    ? "bg-[#f3f0ff] text-[#7048e8] border-[#d0bfff] dark:bg-[#1F1640] dark:text-[#9E86FF] dark:border-[#35266E]" 
                    : "bg-[#ebfbee] text-[#09ad3c] border-[#c3fae8]"
                )}>
                  {compareBadge}
                </span>
              )}
            </div>
            <span className="text-[13px] font-normal text-[var(--secondary-text)]">
              {formatTime(transport.duration)}
            </span>
          </div>

          {/* 2. Waveform Box */}
          <div className="min-h-[50px] flex-1 overflow-hidden" data-app-tour-target="audio-edit-pane">
            <AnimatePresence mode="wait" initial={false}>
              {active ? (
                <motion.div key="waveform" {...fadeSlideUpMotion} className="h-full min-h-0">
                  <WaveformSurface
                    audioPath={effectiveAudioPath}
                    bucketCount={320}
                    playhead={transport.progress}
                    isPlaying={transport.isPlaying}
                    emptyText={emptyText}
                    revision={editable ? editEntry.revision : 0}
                    markers={markers}
                    markerHandleWidth={1.5}
                    selectedMarkerHandleStyle="markerBadge"
                    selectedMarkerHandleWidth={2}
                    selectionHandleStyle="markerBadge"
                    allowsSelectionCreationOnClick={false}
                    viewStart={editable ? editEntry.viewStart : 0}
                    viewEnd={editable ? editEntry.viewEnd : 1}
                    onData={setWaveform}
                    showRuler={showRuler}
                    rulerPosition={rulerPosition}
                    framedTrack={true}
                    onRangeCreate={editable ? createMarkerFromRange : undefined}
                    onMarkerSelect={editable && audioPath ? (markerId) => selectAudioRangeMarker(audioPath, markerId, audioEditScopeId) : undefined}
                    onMarkerContextMenu={editable ? openMarkerMenu : undefined}
                    onMarkerRangeChange={editable ? updateMarkerRange : undefined}
                    onWheelZoom={editable ? (anchor, deltaY) => zoomAudioEditView(audioPath, anchor, deltaY, audioEditScopeId) : undefined}
                  />
                </motion.div>
              ) : (
                <motion.div key="empty" {...fadeSlideUpMotion} className="h-full min-h-0">
                  <EmptyPanel text={emptyText} compact />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {active && effectiveAudioPath && (
            <div className="mt-4 w-full bg-[var(--card-bg)] border border-[var(--panel-stroke)] rounded-[5px] p-4 flex items-center justify-between gap-4 select-none shrink-0">
              {/* Left Section: Skip/Play Buttons + Current Time */}
              <div className="flex items-center gap-2 justify-start shrink-0">
                <button 
                  type="button"
                  onClick={() => transport.skip(-5)}
                  disabled={!transport.canPlay}
                  className={cn(
                    "flex items-center justify-center size-9 text-[var(--secondary-text)] transition-colors focus:outline-none disabled:opacity-35",
                    compareBadgeColor === "purple" ? "hover:text-[var(--primary)]" : "hover:text-[#09ad3c]"
                  )}
                  title="5초 뒤로"
                >
                  <Rewind className="size-4" fill="currentColor" />
                </button>

                <button
                  type="button"
                  onClick={handlePlayPause}
                  disabled={!transport.canPlay}
                  className={cn(
                    "flex items-center justify-center size-10 rounded-full text-white hover:opacity-90 transition-opacity focus:outline-none shrink-0",
                    compareBadgeColor === "purple" ? "bg-[var(--primary)]" : "bg-[#09ad3c]"
                  )}
                >
                  {transport.isPlaying ? (
                    <PauseIcon className="size-4 fill-white" />
                  ) : (
                    <PlayIcon className="size-4 fill-white ml-0.5" />
                  )}
                </button>

                <button 
                  type="button"
                  onClick={() => transport.skip(5)}
                  disabled={!transport.canPlay}
                  className={cn(
                    "flex items-center justify-center size-9 text-[var(--secondary-text)] transition-colors focus:outline-none disabled:opacity-35",
                    compareBadgeColor === "purple" ? "hover:text-[var(--primary)]" : "hover:text-[#09ad3c]"
                  )}
                  title="5초 앞으로"
                >
                  <FastForward className="size-4" fill="currentColor" />
                </button>

                <span className="text-[13px] text-[var(--secondary-text)] whitespace-nowrap ml-1">
                  {formatTime(transport.currentTime)}
                </span>
              </div>

              {/* Center Section: Progress Bar Slider */}
              <div className="relative flex-1 h-8 flex items-center min-w-[50px]">
                <div className="absolute left-0 right-0 h-[3px] rounded bg-[var(--slider-rail)]" />
                <div 
                  className={cn(
                    "absolute h-[3px] rounded",
                    compareBadgeColor === "purple" ? "bg-[var(--primary)]" : "bg-[#09ad3c]"
                  )}
                  style={{ left: 0, width: `${(transport.duration > 0 ? transport.currentTime / transport.duration : 0) * 100}%` }} 
                />
                <input 
                  type="range"
                  min="0"
                  max={transport.duration || 100}
                  step="0.01"
                  value={transport.currentTime}
                  onChange={(e) => transport.seek(parseFloat(e.target.value))}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-20"
                  aria-label="재생 위치 조절"
                />
                <div 
                  className={cn(
                    "pointer-events-none absolute wpf-slider-thumb -translate-x-1/2 z-10",
                    compareBadgeColor === "purple" ? "bg-[var(--primary)]" : "bg-[#09ad3c]"
                  )}
                  style={{ left: `${(transport.duration > 0 ? transport.currentTime / transport.duration : 0) * 100}%` }} 
                />
              </div>

              {/* Right Section: Duration */}
              <div className="flex items-center justify-end shrink-0">
                <span className="text-[13px] text-[var(--secondary-text)] whitespace-nowrap">
                  {formatTime(transport.duration)}
                </span>
              </div>
            </div>
          )}

          {/* 4. Bottom Metadata Footer or Custom Footer */}
          {customFooter ? (
            <div className="mt-3 shrink-0 min-h-0 min-w-0">
              {customFooter}
            </div>
          ) : (
            active && effectiveAudioPath && (
              <div className="flex justify-between items-center mt-2.5 px-0.5 select-none shrink-0">
                <div 
                  className="text-base text-[var(--primary-text)] font-semibold truncate max-w-[65%]"
                  title={(() => {
                    const parts = effectiveAudioPath.split(/[\\/]/).filter(Boolean);
                    return parts[parts.length - 1] ?? "";
                  })()}
                >
                  {(() => {
                    const parts = effectiveAudioPath.split(/[\\/]/).filter(Boolean);
                    return parts[parts.length - 1] ?? "";
                  })()}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 text-[11px] font-normal rounded-[3px] bg-[var(--table-header-bg)] border border-[var(--panel-stroke)] text-[var(--secondary-text)]">
                    {resolveMetadata().sampleRate}
                  </span>
                  <span className="px-1.5 py-0.5 text-[11px] font-normal rounded-[3px] bg-[var(--table-header-bg)] border border-[var(--panel-stroke)] text-[var(--secondary-text)]">
                    {resolveMetadata().bitDepth}
                  </span>
                </div>
              </div>
            )
          )}
        </>
      ) : layout === "playback" ? (
        <>
          <div className="min-h-[50px] flex-1 overflow-hidden" data-app-tour-target="audio-edit-pane">
            <AnimatePresence mode="wait" initial={false}>
              {active ? (
                <motion.div key="waveform" {...fadeSlideUpMotion} className="h-full min-h-0">
                  <WaveformSurface
                    audioPath={effectiveAudioPath}
                    bucketCount={420}
                    playhead={transport.progress}
                    isPlaying={transport.isPlaying}
                    emptyText={emptyText}
                    revision={editable ? editEntry.revision : 0}
                    markers={markers}
                    markerHandleWidth={1.5}
                    selectedMarkerHandleStyle="markerBadge"
                    selectedMarkerHandleWidth={2}
                    selectionHandleStyle="markerBadge"
                    allowsSelectionCreationOnClick={false}
                    viewStart={editable ? editEntry.viewStart : 0}
                    viewEnd={editable ? editEntry.viewEnd : 1}
                    onData={setWaveform}
                    showRuler={showRuler}
                    rulerPosition={rulerPosition}
                    framedTrack={true}
                    onRangeCreate={editable ? createMarkerFromRange : undefined}
                    onMarkerSelect={editable && audioPath ? (markerId) => selectAudioRangeMarker(audioPath, markerId, audioEditScopeId) : undefined}
                    onMarkerContextMenu={editable ? openMarkerMenu : undefined}
                    onMarkerRangeChange={editable ? updateMarkerRange : undefined}
                    onWheelZoom={editable ? (anchor, deltaY) => zoomAudioEditView(audioPath, anchor, deltaY, audioEditScopeId) : undefined}
                  />
                </motion.div>
              ) : (
                <motion.div key="empty" {...fadeSlideUpMotion} className="h-full min-h-0">
                  <EmptyPanel text={emptyText} compact />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {active && effectiveAudioPath && (
            <div className="mt-4 grid grid-cols-3 items-center w-full bg-[var(--card-bg)] border border-[var(--panel-stroke)] rounded-[5px] p-4">
              {/* Left Column: Volume Controls */}
              <div className="flex items-center gap-2.5 justify-start">
                <button 
                  type="button"
                  onClick={() => {
                    const nextMute = localVolume > 0;
                    handleVolumeChange(nextMute ? 0 : 0.8);
                  }}
                  className="text-[var(--secondary-text)] hover:text-[var(--accent-blue)] transition-colors focus:outline-none"
                >
                  {localVolume === 0 ? (
                    <VolumeX className="size-5" />
                  ) : localVolume < 0.5 ? (
                    <Volume1 className="size-5" />
                  ) : (
                    <Volume2 className="size-5" />
                  )}
                </button>
                <div className="relative h-8 w-[100px] flex items-center">
                  <div className="absolute left-0 right-0 h-[3px] rounded bg-[var(--slider-rail)]" />
                  <div 
                    className="absolute h-[3px] rounded bg-[var(--accent-blue)]" 
                    style={{ left: 0, width: `${localVolume * 100}%` }} 
                  />
                  <input 
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={localVolume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="볼륨 조절"
                  />
                  <div 
                    className="pointer-events-none absolute wpf-slider-thumb bg-[var(--accent-blue)] -translate-x-1/2" 
                    style={{ left: `${localVolume * 100}%` }} 
                  />
                </div>
              </div>

              {/* Center Column: Playback & Jump Controls */}
              <div className="flex items-center gap-5 justify-center">
                <button 
                  type="button"
                  onClick={() => transport.skip(-5)}
                  disabled={!transport.canPlay}
                  className="flex items-center justify-center size-9 text-[var(--secondary-text)] hover:text-[var(--accent-blue)] transition-colors focus:outline-none disabled:opacity-35"
                  title="5초 뒤로"
                >
                  <Rewind className="size-4" fill="currentColor" />
                </button>

                <button 
                  type="button"
                  onClick={handlePlayPause}
                  disabled={!transport.canPlay}
                  className="flex items-center justify-center size-10 rounded-full bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity focus:outline-none"
                >
                  {transport.isPlaying ? (
                    <PauseIcon className="size-4 fill-white" />
                  ) : (
                    <PlayIcon className="size-4 fill-white ml-0.5" />
                  )}
                </button>

                <button 
                  type="button"
                  onClick={() => transport.skip(5)}
                  disabled={!transport.canPlay}
                  className="flex items-center justify-center size-9 text-[var(--secondary-text)] hover:text-[var(--accent-blue)] transition-colors focus:outline-none disabled:opacity-35"
                  title="5초 앞으로"
                >
                  <FastForward className="size-4" fill="currentColor" />
                </button>
              </div>

              {/* Right Column: Time Info */}
              <div className="flex items-center justify-end">
                <span className="text-sm text-[var(--secondary-text)] whitespace-nowrap select-none">
                  {formatTime(transport.currentTime)} / {formatTime(transport.duration)}
                </span>
              </div>
            </div>
          )}

          {active && effectiveAudioPath && (
            <div className="grid grid-cols-6 gap-2 text-center py-3 bg-[var(--table-header-bg)] border border-[var(--panel-stroke)] rounded-[5px] mt-4">
              <div>
                <div className="text-xs text-[var(--secondary-text)] font-normal mb-0.5">Duration</div>
                <div className="text-[13px] font-semibold text-[var(--primary-text)]">{resolveMetadata().duration}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--secondary-text)] font-normal mb-0.5">Sample Rate</div>
                <div className="text-[13px] font-semibold text-[var(--primary-text)]">{resolveMetadata().sampleRate}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--secondary-text)] font-normal mb-0.5">Channels</div>
                <div className="text-[13px] font-semibold text-[var(--primary-text)]">{resolveMetadata().channels}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--secondary-text)] font-normal mb-0.5">Bit Depth</div>
                <div className="text-[13px] font-semibold text-[var(--primary-text)]">{resolveMetadata().bitDepth}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--secondary-text)] font-normal mb-0.5">Format</div>
                <div className="text-[13px] font-semibold text-[var(--primary-text)]">{resolveMetadata().format}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--secondary-text)] font-normal mb-0.5">File Size</div>
                <div className="text-[13px] font-semibold text-[var(--primary-text)]">{resolveMetadata().fileSize}</div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="min-h-[50px] flex-1 overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]" data-app-tour-target="audio-edit-pane">
            <AnimatePresence mode="wait" initial={false}>
              {active ? (
                <motion.div key="waveform" {...fadeSlideUpMotion} className="h-full min-h-0">
                  <WaveformSurface
                    audioPath={effectiveAudioPath}
                    bucketCount={420}
                    playhead={transport.progress}
                    isPlaying={transport.isPlaying}
                    emptyText={emptyText}
                    revision={editable ? editEntry.revision : 0}
                    markers={markers}
                    markerHandleWidth={1.5}
                    selectedMarkerHandleStyle="markerBadge"
                    selectedMarkerHandleWidth={2}
                    selectionHandleStyle="markerBadge"
                    allowsSelectionCreationOnClick={false}
                    viewStart={editable ? editEntry.viewStart : 0}
                    viewEnd={editable ? editEntry.viewEnd : 1}
                    onData={setWaveform}
                    onRangeCreate={editable ? createMarkerFromRange : undefined}
                    onMarkerSelect={editable && audioPath ? (markerId) => selectAudioRangeMarker(audioPath, markerId, audioEditScopeId) : undefined}
                    onMarkerContextMenu={editable ? openMarkerMenu : undefined}
                    onMarkerRangeChange={editable ? updateMarkerRange : undefined}
                    onWheelZoom={editable ? (anchor, deltaY) => zoomAudioEditView(audioPath, anchor, deltaY, audioEditScopeId) : undefined}
                  />
                </motion.div>
              ) : (
                <motion.div key="empty" {...fadeSlideUpMotion} className="h-full min-h-0">
                  <EmptyPanel text={emptyText} compact />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 overflow-hidden" data-app-tour-target="audio-transport-controls">
            <TransportButtons transport={transport} disabled={!active || !effectiveAudioPath} />
            {editable && editEntry.error ? <p className="min-w-0 shrink truncate text-[12px] text-[#ff8c96]">{editEntry.error}</p> : null}
            <p className="ml-auto min-w-0 shrink text-right text-sm text-[var(--secondary-text)]">
              {formatTime(transport.currentTime)} / {formatTime(transport.duration)}
            </p>
          </div>
        </>
      )}
      {menu ? (
        <AudioMarkerContextMenu
          refEl={menuRef}
          menu={menu}
          busy={editEntry.busy}
          canApply={Boolean(markerMenuEnabled)}
          canPaste={Boolean(markerMenuEnabled && editClipboard)}
          onCut={() => void runMenuAction("cut")}
          onCopy={() => void runMenuAction("copy")}
          onDelete={() => void runMenuAction("delete")}
          onKeep={() => void runMenuAction("keep")}
          onRemoveMarker={removeMenuMarker}
          onPaste={() => void runMenuAction("paste")}
        />
      ) : null}
    </div>
  );
}

function AudioMarkerContextMenu({
  refEl,
  menu,
  busy,
  canApply,
  canPaste,
  onCut,
  onCopy,
  onDelete,
  onKeep,
  onRemoveMarker,
  onPaste,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  menu: AudioMarkerMenuState;
  busy: boolean;
  canApply: boolean;
  canPaste: boolean;
  onCut: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onKeep: () => void;
  onRemoveMarker: () => void;
  onPaste: () => void;
}) {
  return createPortal(
    <motion.div
      ref={refEl}
      {...menuMotion}
      className="fixed z-[1100] min-w-[210px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] py-1 text-sm shadow-[var(--app-menu-shadow)]"
      style={{ left: menu.x, top: menu.y }}
    >
      <MenuItem icon={<Scissors className="size-4" />} label="오디오 잘라내기" disabled={!canApply || busy} onClick={onCut} />
      <MenuItem icon={<Copy className="size-4" />} label="오디오 복사하기" disabled={!canApply || busy} onClick={onCopy} />
      <MenuItem icon={<X className="size-4" />} label="선택한 마커만 지우기" disabled={!canApply || busy} onClick={onRemoveMarker} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <MenuItem icon={<Trash2 className="size-4" />} label="구간 삭제하기" disabled={!canApply || busy} onClick={onDelete} />
      <MenuItem icon={<Crop className="size-4" />} label="이 구간만 남기고 자르기" disabled={!canApply || busy} onClick={onKeep} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <MenuItem icon={<ClipboardPaste className="size-4" />} label="붙여넣기" disabled={!canPaste || busy} onClick={onPaste} />
    </motion.div>,
    document.body,
  );
}

function MenuItem({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "grid h-9 w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2 px-3 text-left text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]",
        disabled && "text-[var(--secondary-text)] opacity-55 hover:bg-transparent",
      )}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

function isInsideMuteInterval(currentTime: number, intervals: Array<{ start: number; end: number }>): boolean {
  if (!Number.isFinite(currentTime)) {
    return false;
  }

  for (const interval of intervals) {
    const start = Math.max(0, Number(interval.start));
    const end = Math.max(start, Number(interval.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || currentTime < start || currentTime > end) {
      continue;
    }

    return true;
  }

  return false;
}

function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(safeSeconds / 60);
  const s = Math.floor(safeSeconds % 60);
  const ms = Math.floor((safeSeconds % 1) * 100);
  if (m === 0) {
    return `${s}.${String(ms).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

const Rewind10Icon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
    <path d="M3 3v5h5"/>
    <text x="12" y="15" fontSize="7" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" fill="currentColor">10</text>
  </svg>
);

const Forward10Icon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
    <path d="M21 3v5h-5"/>
    <text x="12" y="15" fontSize="7" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" fill="currentColor">10</text>
  </svg>
);
