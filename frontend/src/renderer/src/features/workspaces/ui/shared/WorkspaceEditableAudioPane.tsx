import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, Crop, Scissors, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { AudioEditOperation, DataTableRow, WaveformData } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { WaveformSurface, type WaveformMarker } from "@/shared/components/waveform";
import { useAudioTransport } from "@/shared/hooks/use-audio-transport";
import { fadeSlideUpMotion, menuMotion, softPressTap } from "@/shared/motion";
import { EmptyPanel, TransportButtons } from "./workspace-panel-primitives";
import { WorkspaceAudioCardLayout } from "./WorkspaceAudioCardLayout";
import { UnifiedAudioTransportBar } from "./UnifiedAudioTransportBar";
import { clamp, formatTime } from "./workspace-ui-utils";
import { publishWorkspaceAudioPosition, useWorkspaceAudioSync } from "./workspace-audio-sync";
import {
  createAudioRangeMarker,
  removeAudioRangeMarker,
  runAudioEditOperation,
  selectAudioRangeMarker,
  setAudioEditDuration,
  setAudioEditViewRange,
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

type AudioMetadata = {
  duration: string;
  sampleRate: string;
  channels: string;
  bitDepth: string;
  format: string;
  fileSize: string;
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
  compareHeaderAction,
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
  compareHeaderAction?: ReactNode;
  customFooter?: ReactNode;
}) {
  const active = Boolean(row || audioPath);
  const editEntry = useAudioEditEntry(editable ? audioPath : undefined, audioEditScopeId);
  const editClipboard = useAudioEditClipboard();
  const effectiveAudioPath = editable && audioPath ? editEntry.effectivePath : audioPath;
  const hasAudio = Boolean(effectiveAudioPath);
  const transport = useAudioTransport(effectiveAudioPath, 0, undefined, editable ? editEntry.revision : 0);
  const audioSync = useWorkspaceAudioSync(syncKey);
  const compareTitleId = useId();
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

  const resolveMetadata = (): AudioMetadata => {
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

  const audioFilename = useMemo(() => {
    if (!effectiveAudioPath) {
      return "-";
    }
    const parts = effectiveAudioPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? "-";
  }, [effectiveAudioPath]);
  const metadata = resolveMetadata();

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col justify-between"
      role={layout === "compare" ? "group" : undefined}
      aria-labelledby={layout === "compare" && compareTitle ? compareTitleId : undefined}
    >
      {layout === "compare" ? (
        <>
          <div className="mb-4 flex min-h-8 w-full shrink-0 items-center gap-2 overflow-hidden">
            <h3 id={compareTitleId} className="min-w-0 truncate whitespace-nowrap text-base font-semibold leading-5 text-[var(--primary-text)]">
              {compareTitle}
            </h3>
            {compareBadge && (
              <span className={cn(
                "shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-bold",
                compareBadgeColor === "purple"
                  ? "border-[#d0bfff] bg-[#f3f0ff] text-[#7048e8] dark:border-[#35266E] dark:bg-[#1F1640] dark:text-[#9E86FF]"
                  : "border-[#c3fae8] bg-[#ebfbee] text-[#09ad3c]"
              )}>
                {compareBadge}
              </span>
            )}
            {compareHeaderAction ? (
              <div className="ml-auto flex min-w-max shrink-0 items-center justify-end">
                {compareHeaderAction}
              </div>
            ) : null}
          </div>

          <WorkspaceAudioCardLayout
            hasAudio={hasAudio}
            emptyText={emptyText}
            className="flex-1"
            waveformMinHeightClassName="min-h-[50px]"
            waveformSurfaceVariant="framed"
            controlsPlacement="waveformGlass"
            waveform={
              <WaveformSurface
                audioPath={effectiveAudioPath}
                bucketCount={320}
                playhead={transport.progress}
                isPlaying={transport.isPlaying}
                playheadVisible={transport.playheadVisible}
                onPlayheadChange={(progress) => transport.seek(progress * (transport.duration || durationSeconds))}
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
                framedTrack={false}
                showBorder={false}
                showRulerTicks={false}
                onRangeCreate={editable ? createMarkerFromRange : undefined}
                onMarkerSelect={editable && audioPath ? (markerId) => selectAudioRangeMarker(audioPath, markerId, audioEditScopeId) : undefined}
                onMarkerContextMenu={editable ? openMarkerMenu : undefined}
                onMarkerRangeChange={editable ? updateMarkerRange : undefined}
                onWheelZoom={editable ? (anchor, deltaY) => zoomAudioEditView(audioPath, anchor, deltaY, audioEditScopeId) : undefined}
              />
            }
            controls={
              <UnifiedAudioTransportBar
                transport={transport}
                disabled={!hasAudio}
                themeColor={compareBadgeColor === "purple" ? "purple" : "green"}
                framed={false}
                onPlayPause={handlePlayPause}
              />
            }
            footer={
              customFooter ? (
                <div className="min-h-0 min-w-0 shrink-0">{customFooter}</div>
              ) : (
                <div className="flex shrink-0 items-center justify-between gap-3 overflow-hidden px-0.5">
                  <div className="min-w-0 max-w-[65%] truncate text-[13px] font-medium leading-[18px] text-[var(--primary-text)]" title={audioFilename}>
                    {audioFilename}
                  </div>

                  <CompareMetadataChips sampleRate={metadata.sampleRate} bitDepth={metadata.bitDepth} />
                </div>
              )
            }
          />
        </>
      ) : layout === "playback" ? (
        <>
          <WorkspaceAudioCardLayout
            hasAudio={hasAudio}
            emptyText={emptyText}
            waveform={
              <WaveformSurface
                audioPath={effectiveAudioPath}
                bucketCount={420}
                playhead={transport.progress}
                isPlaying={transport.isPlaying}
                playheadVisible={transport.playheadVisible}
                onPlayheadChange={(progress) => transport.seek(progress * (transport.duration || durationSeconds))}
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
                framedTrack={false}
                showBorder={false}
                showRulerTicks={false}
                onRangeCreate={editable ? createMarkerFromRange : undefined}
                onMarkerSelect={editable && audioPath ? (markerId) => selectAudioRangeMarker(audioPath, markerId, audioEditScopeId) : undefined}
                onMarkerContextMenu={editable ? openMarkerMenu : undefined}
                onMarkerRangeChange={editable ? updateMarkerRange : undefined}
                onWheelZoom={editable ? (anchor, deltaY) => zoomAudioEditView(audioPath, anchor, deltaY, audioEditScopeId) : undefined}
              />
            }
            minimap={
              <WaveformSurface
                audioPath={effectiveAudioPath}
                bucketCount={260}
                revision={editable ? editEntry.revision : 0}
                selectionStart={editable ? editEntry.viewStart : 0}
                selectionEnd={editable ? editEntry.viewEnd : 1}
                selectionHandleStyle="line"
                allowsSelectionCreationOnClick={false}
                emptyText=""
                showBorder={false}
                onSelectionChange={editable && audioPath ? (start, end) => setAudioEditViewRange(audioPath, start, end, audioEditScopeId) : undefined}
              />
            }
            controls={
              <UnifiedAudioTransportBar
                transport={transport}
                disabled={!hasAudio}
                themeColor="blue"
                framed={false}
                className="mt-[8px] mb-[4px]"
                onPlayPause={handlePlayPause}
              />
            }
          />
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
                    playheadVisible={transport.playheadVisible}
                    onPlayheadChange={(progress) => transport.seek(progress * (transport.duration || durationSeconds))}
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
          <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2 overflow-hidden" data-app-tour-target="audio-transport-controls">
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

function CompareMetadataChips({ sampleRate, bitDepth }: { sampleRate: string; bitDepth: string }) {
  return (
    <div className="@container flex min-w-0 flex-1 shrink items-center justify-end gap-1.5 overflow-hidden">
      <span className="hidden shrink-0 whitespace-nowrap rounded-[3px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] px-1.5 py-0.5 text-[11px] font-normal text-[var(--secondary-text)] @[90px]:inline-flex">
        {sampleRate}
      </span>
      <span className="hidden shrink-0 whitespace-nowrap rounded-[3px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] px-1.5 py-0.5 text-[11px] font-normal text-[var(--secondary-text)] @[166px]:inline-flex">
        {bitDepth}
      </span>
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
      className="fixed z-[1100] min-w-[210px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--popover)] py-1 text-sm shadow-[var(--app-menu-shadow)]"
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
