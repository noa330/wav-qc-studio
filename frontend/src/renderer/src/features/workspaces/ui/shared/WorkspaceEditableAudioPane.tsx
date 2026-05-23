import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, Copy, Crop, Scissors, Trash2, X } from "lucide-react";
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
}: {
  row?: DataTableRow;
  audioPath?: string;
  editable?: boolean;
  emptyText?: string;
  syncKey?: string;
  muteIntervals?: Array<{ start: number; end: number }>;
  muteIntervalsEnabled?: boolean;
  audioEditScopeId?: string;
}) {
  const active = Boolean(row || audioPath);
  const editEntry = useAudioEditEntry(editable ? audioPath : undefined, audioEditScopeId);
  const editClipboard = useAudioEditClipboard();
  const effectiveAudioPath = editable && audioPath ? editEntry.effectivePath : audioPath;
  const transport = useAudioTransport(effectiveAudioPath, 0, undefined, editable ? editEntry.revision : 0);
  const audioSync = useWorkspaceAudioSync(syncKey);
  const handledSeekRequestRef = useRef<number | undefined>(undefined);
  const handledPreviewRequestRef = useRef<number | undefined>(undefined);
  const publishedAudioPathRef = useRef<string | undefined>(undefined);
  const [previewSegment, setPreviewSegment] = useState<{ id: number; start: number; end: number } | undefined>();
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [menu, setMenu] = useState<AudioMarkerMenuState | undefined>();
  const menuRef = useRef<HTMLDivElement | null>(null);
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
      });
      return;
    }

    publishWorkspaceAudioPosition(syncKey, {
      audioPath,
      currentTime: transport.currentTime,
      duration: transport.duration,
    });
  }, [audioPath, syncKey, transport.currentTime, transport.duration]);

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

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-[50px] flex-1 overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]">
        <AnimatePresence mode="wait" initial={false}>
          {active ? (
            <motion.div key="waveform" {...fadeSlideUpMotion} className="h-full min-h-0">
              <WaveformSurface
                audioPath={effectiveAudioPath}
                bucketCount={420}
                playhead={transport.progress}
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
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2 overflow-hidden">
        <TransportButtons transport={transport} disabled={!active || !effectiveAudioPath} />
        {editable && editEntry.error ? <p className="min-w-0 shrink truncate text-[12px] text-[#ff8c96]">{editEntry.error}</p> : null}
        <p className="ml-auto min-w-0 shrink text-right text-sm text-[var(--secondary-text)]">
          {formatTime(transport.currentTime)} / {formatTime(transport.duration)}
        </p>
      </div>
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
      className="fixed z-[1100] min-w-[210px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] py-1 text-sm shadow-[0_14px_32px_rgba(0,0,0,.34)]"
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
