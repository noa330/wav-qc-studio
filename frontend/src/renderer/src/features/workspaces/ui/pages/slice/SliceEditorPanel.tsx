import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DataTableRow, WaveformData } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/shared/components/controls";
import { WaveformSurface, type WaveformMarker } from "@/shared/components/waveform";
import { useAudioTransport } from "@/shared/hooks/use-audio-transport";
import { EmptyPanel, TransportButtons } from "../../shared/workspace-panel-primitives";
import { clamp, formatTime, numberFromRow } from "../../shared/workspace-ui-utils";
import { fadeSlideUpMotion, pressTap, tightPressTap } from "@/shared/motion";
import { readSliceComponents, readSliceRowBounds, sliceRowIdFromComponentId } from "../../../model/slice-segments";
import { buildDisplayMarkerParts, resolveOriginalPath } from "./slice-editor-marker-utils";
import { estimateControlButtonWidth, SliceMarkerContextMenu, SliceTimeGrid, type SliceMarkerMenuState } from "./slice-editor-controls";

export { focusSliceViewOnRow, setSliceViewRange, zoomSliceView } from "./slice-editor-view-utils";

export type SliceEditorViewState = {
  viewStart: number;
  viewEnd: number;
  loopPreview: boolean;
};

export type SliceEditorViewActions = {
  setLoopPreview: (enabled: boolean) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomAt: (anchor: number, deltaY: number) => void;
  setViewRange: (start: number, end: number) => void;
  focusSelection: (rows: DataTableRow[], selectedRow: DataTableRow, totalSeconds: number) => void;
};

export type SliceEditorViewContext = {
  state: SliceEditorViewState;
  actions: SliceEditorViewActions;
};

export function SliceEditorHeaderControls({ view, actions, disabled = false }: { view: SliceEditorViewState; actions: SliceEditorViewActions; disabled?: boolean }) {
  return (
    <span className="flex min-w-max shrink-0 items-center gap-2" data-app-tour-target="slice-editor-header-controls">
      <ToggleSwitch checked={view.loopPreview} onChange={actions.setLoopPreview} disabled={disabled} />
      <span className={cn("text-sm text-[var(--primary-text)]", disabled && "opacity-45")}>루프 미리보기</span>
      <div className={cn("ml-2 flex h-[38px] overflow-hidden rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)]", disabled && "opacity-45")}>
        <motion.button type="button" disabled={disabled} onClick={actions.zoomOut} whileTap={disabled ? undefined : tightPressTap} className="flex w-[38px] items-center justify-center" aria-label="축소">
          <ZoomOut className="size-[18px]" strokeWidth={1.4} />
        </motion.button>
        <motion.button type="button" disabled={disabled} onClick={actions.zoomIn} whileTap={disabled ? undefined : tightPressTap} className="flex w-[38px] items-center justify-center" aria-label="확대">
          <ZoomIn className="size-[18px]" strokeWidth={1.4} />
        </motion.button>
      </div>
    </span>
  );
}

export function SliceEditorBody({
  row,
  rows,
  audioPath,
  view,
  actions,
  onPrevious,
  onNext,
  onSplitOrUnmergeSegment,
  onMergeSegments,
  onUpdateSegmentBounds,
  onSelectRow,
  onAddSegment,
  onCopySegment,
  onDeleteSegment,
  selectedRowIds = [],
}: {
  row?: DataTableRow;
  rows: DataTableRow[];
  audioPath?: string;
  view: SliceEditorViewState;
  actions?: SliceEditorViewActions;
  onPrevious: () => void;
  onNext: () => void;
  onSplitOrUnmergeSegment: (row: DataTableRow, componentIds: string[]) => void;
  onMergeSegments: () => void;
  onUpdateSegmentBounds: (row: DataTableRow, startSec: number, endSec: number) => void;
  onSelectRow: (row: DataTableRow, options?: { additive?: boolean }) => void;
  onAddSegment: (startSec: number, endSec: number) => void;
  onCopySegment: (row: DataTableRow) => void;
  onDeleteSegment: (row: DataTableRow) => void;
  selectedRowIds?: string[];
}) {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const [markerMenu, setMarkerMenu] = useState<SliceMarkerMenuState | undefined>();
  const markerMenuRef = useRef<HTMLDivElement | null>(null);
  const hasAudio = Boolean(audioPath);
  const { startSec, endSec } = readSliceRowBounds(row);
  const audioDurationSec = waveform && waveform.path === audioPath ? waveform.durationSeconds : 0;
  const durationSec = row ? Math.max(0, endSec - startSec || numberFromRow(row, "durationSec")) : audioDurationSec;
  const totalSec = Math.max(audioDurationSec, endSec, durationSec, 1);
  const selectionStart = hasAudio && row && endSec > startSec ? startSec / totalSec : undefined;
  const selectionEnd = hasAudio && row && endSec > startSec ? endSec / totalSec : undefined;
  const controlsEnabled = hasAudio;
  const segmentNavEnabled = controlsEnabled && Boolean(row);
  const hasSegments = Boolean(row);
  const selectedRowSet = useMemo(() => new Set(selectedRowIds.length > 0 ? selectedRowIds : row ? [row.id] : []), [row, selectedRowIds]);
  const selectedComponents = useMemo(() => (row ? readSliceComponents(row) : []), [row]);
  const isMergedMarker = selectedComponents.length > 1;
  const scopedRows = useMemo(() => {
    if (!row) {
      return rows;
    }

    const selectedOriginalPath = resolveOriginalPath(row);
    if (!selectedOriginalPath) {
      return rows;
    }

    return rows.filter((item) => resolveOriginalPath(item) === selectedOriginalPath);
  }, [row, rows]);
  const markers = useMemo(
    () =>
      scopedRows.flatMap((item) => {
          const { startSec: markerStartSec, endSec: markerEndSec } = readSliceRowBounds(item);
          if (!hasAudio || markerEndSec <= markerStartSec) {
            return [];
          }

          const markerComponents = readSliceComponents(item);
          const markerParts = markerComponents.length > 1 ? buildDisplayMarkerParts(item.id, markerComponents, markerStartSec, markerEndSec, totalSec, selectedComponentIds) : undefined;
          const marker: WaveformMarker = {
            id: item.id,
            start: clamp(markerStartSec / totalSec, 0, 1),
            end: clamp(markerEndSec / totalSec, 0, 1),
            selected: selectedRowSet.has(item.id),
            parts: markerParts,
          };

          return marker.end > marker.start ? [marker] : [];
        }),
    [hasAudio, scopedRows, selectedComponentIds, selectedRowSet, totalSec],
  );
  const selectableComponentIds = useMemo(() => new Set(markers.flatMap((marker) => marker.parts?.map((part) => part.id) ?? [])), [markers]);
  const loopRange = view.loopPreview && selectionStart !== undefined && selectionEnd !== undefined ? { start: selectionStart * totalSec, end: selectionEnd * totalSec } : undefined;
  const transport = useAudioTransport(audioPath, totalSec, loopRange);
  const controlsBarRef = useRef<HTMLDivElement | null>(null);
  const transportControlsRef = useRef<HTMLDivElement | null>(null);
  const actionControlsRef = useRef<HTMLDivElement | null>(null);
  const timeControlsRef = useRef<HTMLSpanElement | null>(null);
  const [controlsCompact, setControlsCompact] = useState(false);

  useEffect(() => {
    setSelectedComponentIds((current) => {
      const next = current.filter((componentId) => selectableComponentIds.has(componentId) && selectedRowSet.has(sliceRowIdFromComponentId(componentId)));
      return next.length === current.length ? current : next;
    });
  }, [selectableComponentIds, selectedRowSet]);

  useEffect(() => {
    if (!markerMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && markerMenuRef.current?.contains(target)) {
        return;
      }
      setMarkerMenu(undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMarkerMenu(undefined);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [markerMenu]);

  useEffect(() => {
    if (!row || !hasAudio || totalSec <= 0) {
      return;
    }

    actions?.focusSelection(scopedRows, row, totalSec);
  }, [actions, audioPath, hasAudio, row?.id, scopedRows, totalSec]);

  useEffect(() => {
    const controlsBar = controlsBarRef.current;
    if (!controlsBar) {
      return;
    }

    const updateLayout = () => {
      const transportWidth = transportControlsRef.current?.scrollWidth ?? 0;
      const timeWidth = timeControlsRef.current?.scrollWidth ?? 0;
      const splitLabel = isMergedMarker ? "병합 해제" : "마커 분할";
      const actionButtonWidth = ["맞춤", "이전 구간", "다음 구간", splitLabel, "마커 병합"].reduce((total, label) => total + estimateControlButtonWidth(label), 0);
      const actionGroupGaps = 8 * 3;
      const rootGaps = 12 * 2;
      const requiredOneLineWidth = transportWidth + actionButtonWidth + timeWidth + actionGroupGaps + rootGaps + 2;
      setControlsCompact(requiredOneLineWidth > controlsBar.getBoundingClientRect().width);
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(controlsBar);
    return () => observer.disconnect();
  }, [isMergedMarker]);


  const openMarkerMenu = (markerId: string, event: ReactMouseEvent<Element>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextRow = rows.find((item) => item.id === markerId);
    if (nextRow) {
      onSelectRow(nextRow);
      setSelectedComponentIds([]);
    }
    setMarkerMenu({ x: event.clientX, y: event.clientY, markerId });
  };

  const selectedMenuRow = markerMenu ? rows.find((item) => item.id === markerMenu.markerId) : undefined;
  const splitMenuLabel = selectedMenuRow && readSliceComponents(selectedMenuRow).length > 1 ? "병합 해제" : "마커 분할";

  return (
    <div className={cn("grid h-full min-h-0", hasAudio ? "grid-rows-[minmax(50px,1fr)_10px_24px_10px_auto_12px_auto]" : "grid-rows-[minmax(50px,1fr)_12px_auto_12px_auto]")}>
      <div className="min-h-[50px] overflow-hidden rounded-[5px] border border-transparent bg-transparent" data-app-tour-target="slice-editor-waveform">
        <AnimatePresence mode="wait" initial={false}>
          {hasAudio ? (
            <motion.div key="waveform" {...fadeSlideUpMotion} className="relative h-full min-h-0">
              <WaveformSurface
                audioPath={audioPath}
                bucketCount={720}
                framedTrack
                showRuler
                markers={markers}
                selectionStart={selectionStart}
                selectionEnd={selectionEnd}
                selectionHandleStyle="markerBadge"
                allowsSelectionCreationOnClick={false}
                markerHandleWidth={1.5}
                selectedMarkerHandleWidth={2}
                selectionOverlayOpacity={0}
                selectionWaveOpacity={0}
                viewStart={view.viewStart}
                viewEnd={view.viewEnd}
                playhead={transport.progress}
                isPlaying={transport.isPlaying}
                onData={setWaveform}
                onSelectionChange={(nextStart, nextEnd) => {
                  if (!row || !hasAudio) {
                    return;
                  }

                  onUpdateSegmentBounds(row, nextStart * totalSec, nextEnd * totalSec);
                }}
                onRangeCreate={(nextStart, nextEnd) => {
                  if (!hasAudio || totalSec <= 0) {
                    return;
                  }

                  onAddSegment(nextStart * totalSec, nextEnd * totalSec);
                }}
                onMarkerRangeChange={(markerId, nextStart, nextEnd) => {
                  if (!hasAudio || totalSec <= 0) {
                    return;
                  }

                  const nextRow = rows.find((item) => item.id === markerId);
                  if (!nextRow) {
                    return;
                  }

                  onUpdateSegmentBounds(nextRow, nextStart * totalSec, nextEnd * totalSec);
                }}
                onWheelZoom={actions?.zoomAt}
                onMarkerSelect={(markerId, additive) => {
                  setSelectedComponentIds([]);
                  const nextRow = rows.find((item) => item.id === markerId);
                  if (nextRow) {
                    onSelectRow(nextRow, { additive });
                  }
                }}
                onMarkerContextMenu={openMarkerMenu}
                onMarkerPartSelect={(markerId, partId, additive) => {
                  const nextRow = rows.find((item) => item.id === markerId);
                  if (!nextRow) {
                    return;
                  }

                  onSelectRow(nextRow);
                  setSelectedComponentIds((current) => {
                    if (!additive) {
                      return [partId];
                    }

                    return current.includes(partId) ? current.filter((currentPartId) => currentPartId !== partId) : [...current, partId];
                  });
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="empty" {...fadeSlideUpMotion} className="h-full min-h-0 overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]">
              <EmptyPanel text="선택한 WAV 파일의 파형을 표시할 수 없습니다." compact />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {hasAudio ? (
        <>
          <div />
          <div className="overflow-hidden rounded-[5px] border border-transparent bg-transparent" data-app-tour-target="slice-editor-minimap">
            <WaveformSurface
              audioPath={audioPath}
              bucketCount={260}
              framedTrack
              selectionStart={view.viewStart}
              selectionEnd={view.viewEnd}
              selectionHandleStyle="none"
              allowsSelectionCreationOnClick={false}
              emptyText=""
              onSelectionChange={actions?.setViewRange}
              useMarkerStyleForSelection
            />
          </div>
          <div />
        </>
      ) : (
        <div />
      )}
      <div
        ref={controlsBarRef}
        className={cn(
          "min-w-0 items-center gap-x-3 gap-y-2 py-2",
          controlsCompact ? "grid grid-cols-[auto_minmax(0,1fr)_auto]" : "flex",
        )}
      >
        <div ref={transportControlsRef} className="shrink-0">
          <TransportButtons transport={transport} disabled={!controlsEnabled} />
        </div>
        <div ref={actionControlsRef} data-app-tour-target="slice-editor-actions" className={cn("flex min-w-0 items-center gap-2 overflow-hidden", controlsCompact ? "col-span-3 col-start-1 row-start-2 w-full" : "shrink")}>
          <motion.button type="button" disabled={!controlsEnabled || !row} onClick={() => {
            if (!row) {
              return;
            }
            actions?.focusSelection(scopedRows, row, totalSec);
          }} whileTap={controlsEnabled && row ? pressTap : undefined} className={cn("wpf-button h-[38px] min-w-0 truncate text-sm disabled:opacity-45", controlsCompact ? "flex-1 px-3" : "shrink px-4")}>
            맞춤
          </motion.button>
          <div className={cn("flex h-[38px] min-w-0 overflow-hidden rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]", controlsCompact ? "flex-[2_1_0%]" : "shrink", !segmentNavEnabled && "opacity-45")}>
            <motion.button type="button" disabled={!segmentNavEnabled} onClick={onPrevious} whileTap={segmentNavEnabled ? pressTap : undefined} className={cn("min-w-0 truncate text-sm", controlsCompact ? "flex-1 px-3" : "shrink px-4")}>
              이전 구간
            </motion.button>
            <motion.button type="button" disabled={!segmentNavEnabled} onClick={onNext} whileTap={segmentNavEnabled ? pressTap : undefined} className={cn("min-w-0 truncate text-sm", controlsCompact ? "flex-1 px-3" : "shrink px-4")}>
              다음 구간
            </motion.button>
          </div>
          <motion.button type="button" disabled={!controlsEnabled || !row} onClick={() => {
            if (!row) {
              return;
            }
            onSplitOrUnmergeSegment(row, selectedComponentIds);
            setSelectedComponentIds([]);
          }} whileTap={controlsEnabled && row ? pressTap : undefined} className={cn("wpf-primary-button h-[38px] min-w-0 truncate text-sm disabled:opacity-45", controlsCompact ? "flex-1 px-3" : "shrink px-4")}>
            {isMergedMarker ? "병합 해제" : "마커 분할"}
          </motion.button>
          <motion.button type="button" disabled={!controlsEnabled || selectedRowSet.size < 2} onClick={() => {
            setSelectedComponentIds([]);
            onMergeSegments();
          }} whileTap={controlsEnabled && selectedRowSet.size >= 2 ? pressTap : undefined} className={cn("wpf-button h-[38px] min-w-0 truncate text-sm disabled:opacity-45", controlsCompact ? "flex-1 px-3" : "shrink px-4")}>
            마커 병합
          </motion.button>
        </div>
        <span ref={timeControlsRef} className={cn("flex h-[38px] shrink-0 items-center whitespace-nowrap text-sm text-[var(--secondary-text)]", controlsCompact ? "col-start-3 row-start-1" : "ml-auto")}>{formatTime(transport.currentTime)} / {formatTime(transport.duration || totalSec)}</span>
      </div>
      <div />
      <div className={cn("rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] py-2.5 px-4", !controlsEnabled && "opacity-55")} data-app-tour-target="slice-editor-time-grid">
        <SliceTimeGrid
          disabled={!controlsEnabled}
          startValue={formatTime(hasSegments ? startSec : 0)}
          endValue={formatTime(hasSegments ? endSec : totalSec)}
          durationValue={formatTime(durationSec)}
          previewValue="00:00:00"
        />
      </div>
      {markerMenu ? (
        <SliceMarkerContextMenu
          refEl={markerMenuRef}
          menu={markerMenu}
          splitLabel={splitMenuLabel}
          canSplit={Boolean(selectedMenuRow)}
          canMerge={selectedRowSet.size >= 2}
          onSplit={() => {
            if (selectedMenuRow) {
              setMarkerMenu(undefined);
              onSplitOrUnmergeSegment(selectedMenuRow, selectedComponentIds);
              setSelectedComponentIds([]);
            }
          }}
          onCopy={() => {
            if (selectedMenuRow) {
              setMarkerMenu(undefined);
              onCopySegment(selectedMenuRow);
            }
          }}
          onDelete={() => {
            if (selectedMenuRow) {
              setMarkerMenu(undefined);
              setSelectedComponentIds((current) => current.filter((componentId) => sliceRowIdFromComponentId(componentId) !== selectedMenuRow.id));
              onDeleteSegment(selectedMenuRow);
            }
          }}
          onMerge={() => {
            setMarkerMenu(undefined);
            setSelectedComponentIds([]);
            onMergeSegments();
          }}
        />
      ) : null}
    </div>
  );
}
