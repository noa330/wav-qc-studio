import { Copy, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { DataTableRow, WaveformData } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/shared/components/controls";
import { WaveformSurface, type WaveformMarker } from "@/shared/components/waveform";
import { useAudioTransport } from "@/shared/hooks/use-audio-transport";
import { EmptyPanel, TransportButtons } from "../../shared/workspace-panel-primitives";
import { clamp, formatTime, numberFromRow } from "../../shared/workspace-ui-utils";
import { fadeSlideUpMotion, menuMotion, pressTap, softPressTap, tightPressTap } from "@/shared/motion";
import { readSliceComponents, readSliceRowBounds, sliceComponentId, sliceRowIdFromComponentId } from "../../../model/slice-segments";
import { resolveSliceSourceIdentity } from "../../../model/workspace-runtime-selection";

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


const minSliceViewSpan = 0.035;

type SliceMarkerMenuState = {
  x: number;
  y: number;
  markerId: string;
};

export function SliceEditorHeaderControls({ view, actions, disabled = false }: { view: SliceEditorViewState; actions: SliceEditorViewActions; disabled?: boolean }) {
  return (
    <>
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
    </>
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
    <div className={cn("grid h-full min-h-0", hasAudio ? "grid-rows-[minmax(50px,1fr)_10px_20px_18px_auto_12px_auto]" : "grid-rows-[minmax(50px,1fr)_12px_auto_12px_auto]")}>
      <div className="min-h-[50px] overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]">
        <AnimatePresence mode="wait" initial={false}>
          {hasAudio ? (
            <motion.div key="waveform" {...fadeSlideUpMotion} className="relative h-full min-h-0">
              <WaveformSurface
                audioPath={audioPath}
                bucketCount={720}
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
            <motion.div key="empty" {...fadeSlideUpMotion} className="h-full min-h-0">
              <EmptyPanel text="선택한 WAV 파일의 파형을 표시할 수 없습니다." compact />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {hasAudio ? (
        <>
          <div />
          <div className="overflow-hidden rounded-[3px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] opacity-90">
          <WaveformSurface
            audioPath={audioPath}
            bucketCount={260}
            selectionStart={view.viewStart}
            selectionEnd={view.viewEnd}
            selectionHandleStyle="none"
            allowsSelectionCreationOnClick={false}
            emptyText=""
            onSelectionChange={actions?.setViewRange}
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
          "min-w-0 items-center gap-x-3 gap-y-2",
          controlsCompact ? "grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[38px_38px]" : "flex h-[38px] overflow-hidden",
        )}
      >
        <div ref={transportControlsRef} className="shrink-0">
          <TransportButtons transport={transport} disabled={!controlsEnabled} />
        </div>
        <div ref={actionControlsRef} className={cn("flex min-w-0 items-center gap-2 overflow-hidden", controlsCompact ? "col-span-3 col-start-1 row-start-2 w-full" : "shrink")}>
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
      <div className={cn("rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-4", !controlsEnabled && "opacity-55")}>
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


function SliceMarkerContextMenu({
  refEl,
  menu,
  splitLabel,
  canSplit,
  canMerge,
  onSplit,
  onCopy,
  onDelete,
  onMerge,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  menu: SliceMarkerMenuState;
  splitLabel: string;
  canSplit: boolean;
  canMerge: boolean;
  onSplit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onMerge: () => void;
}) {
  return createPortal(
    <motion.div
      ref={refEl}
      {...menuMotion}
      className="fixed z-[1100] min-w-[180px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] py-1 text-sm shadow-[0_14px_32px_rgba(0,0,0,.34)]"
      style={{ left: menu.x, top: menu.y }}
    >
      <SliceMarkerMenuItem icon={<Copy className="size-4" />} label="복사하기" disabled={!canSplit} onClick={onCopy} />
      <SliceMarkerMenuItem icon={<Trash2 className="size-4" />} label="선택한 마커만 지우기" disabled={!canSplit} onClick={onDelete} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <SliceMarkerMenuItem label={splitLabel} disabled={!canSplit} onClick={onSplit} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <SliceMarkerMenuItem label="선택 마커 병합" disabled={!canMerge} onClick={onMerge} />
    </motion.div>,
    document.body,
  );
}

function SliceMarkerMenuItem({ icon, label, disabled, onClick }: { icon?: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "grid h-9 w-full items-center gap-2 px-3 text-left text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]",
        icon ? "grid-cols-[22px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]",
        disabled && "text-[var(--secondary-text)] opacity-55 hover:bg-transparent",
      )}
    >
      {icon ? <span>{icon}</span> : null}
      <span>{label}</span>
    </motion.button>
  );
}

function SliceTimeGrid({
  disabled,
  startValue,
  endValue,
  durationValue,
  previewValue,
}: {
  disabled: boolean;
  startValue: string;
  endValue: string;
  durationValue: string;
  previewValue: string;
}) {
  const inputClass = "wpf-field h-[38px] min-w-0 px-3 text-sm outline-none disabled:opacity-60";
  const buttonClass = "wpf-button h-[38px] min-w-0 truncate px-2 text-sm disabled:opacity-45";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(36px,52px)_minmax(0,1fr)_minmax(36px,52px)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-2">
      <p className="col-start-1 truncate text-[13px] text-[var(--secondary-text)]">시작 (Start)</p>
      <p className="col-start-3 truncate text-[13px] text-[var(--secondary-text)]">종료 (End)</p>
      <p className="col-start-5 truncate text-[13px] text-[var(--secondary-text)]">길이 (Duration)</p>
      <p className="col-start-6 truncate text-[13px] text-[var(--secondary-text)]">미리듣기 재생 위치</p>
      <input className={cn(inputClass, "col-start-1 row-start-2")} value={startValue} readOnly disabled={disabled} />
      <motion.button type="button" disabled={disabled} whileTap={disabled ? undefined : pressTap} className={cn(buttonClass, "col-start-2 row-start-2")}>
        이동
      </motion.button>
      <input className={cn(inputClass, "col-start-3 row-start-2")} value={endValue} readOnly disabled={disabled} />
      <motion.button type="button" disabled={disabled} whileTap={disabled ? undefined : pressTap} className={cn(buttonClass, "col-start-4 row-start-2")}>
        이동
      </motion.button>
      <input className={cn(inputClass, "col-start-5 row-start-2")} value={durationValue} readOnly disabled={disabled} />
      <input className={cn(inputClass, "col-start-6 row-start-2")} value={previewValue} readOnly disabled={disabled} />
    </div>
  );
}

function estimateControlButtonWidth(label: string): number {
  const context = getSliceControlMeasureContext();
  const textWidth = context ? context.measureText(label).width : Array.from(label).reduce((width, char) => width + (char.charCodeAt(0) > 127 ? 14 : 7), 0);
  return Math.ceil(textWidth + 32);
}

let sliceControlMeasureContext: CanvasRenderingContext2D | null | undefined;

function getSliceControlMeasureContext(): CanvasRenderingContext2D | null {
  if (sliceControlMeasureContext !== undefined) {
    return sliceControlMeasureContext;
  }
  if (typeof document === "undefined") {
    sliceControlMeasureContext = null;
    return sliceControlMeasureContext;
  }
  const canvas = document.createElement("canvas");
  sliceControlMeasureContext = canvas.getContext("2d");
  if (sliceControlMeasureContext) {
    sliceControlMeasureContext.font = '14px "Noto Sans KR", "Segoe UI", system-ui, sans-serif';
  }
  return sliceControlMeasureContext;
}

export function zoomSliceView(view: SliceEditorViewState, factor: number, anchor: number): SliceEditorViewState {
  const safeStart = clamp(view.viewStart, 0, 1);
  const safeEnd = clamp(view.viewEnd, safeStart + minSliceViewSpan, 1);
  const currentSpan = safeEnd - safeStart;
  const nextSpan = clamp(currentSpan * factor, minSliceViewSpan, 1);
  const safeAnchor = clamp(anchor, 0, 1);
  let nextStart = safeStart + currentSpan * safeAnchor - nextSpan * safeAnchor;
  let nextEnd = nextStart + nextSpan;

  if (nextStart < 0) {
    nextEnd -= nextStart;
    nextStart = 0;
  }

  if (nextEnd > 1) {
    nextStart -= nextEnd - 1;
    nextEnd = 1;
  }

  return {
    ...view,
    viewStart: clamp(nextStart, 0, 1 - minSliceViewSpan),
    viewEnd: clamp(nextEnd, minSliceViewSpan, 1),
  };
}

export function setSliceViewRange(view: SliceEditorViewState, start: number, end: number): SliceEditorViewState {
  const safeStart = clamp(start, 0, 1);
  const safeEnd = clamp(end, safeStart + minSliceViewSpan, 1);
  const span = Math.max(minSliceViewSpan, safeEnd - safeStart);
  const nextStart = clamp(safeStart, 0, 1 - span);

  return {
    ...view,
    viewStart: nextStart,
    viewEnd: clamp(nextStart + span, minSliceViewSpan, 1),
  };
}

export function focusSliceViewOnRow(view: SliceEditorViewState, rows: DataTableRow[], selectedRow: DataTableRow, totalSeconds: number): SliceEditorViewState {
  const orderedRows = rows
    .map((row) => ({
      row,
      ...readSliceRowBounds(row),
    }))
    .filter((entry) => entry.endSec > entry.startSec)
    .sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
  const selected = orderedRows.find((entry) => entry.row.id === selectedRow.id) ?? orderedRows[0];

  if (totalSeconds <= 0 || !selected) {
    return {
      ...view,
      viewStart: 0,
      viewEnd: 1,
    };
  }

  const rangeStart = selected.startSec;
  const rangeEnd = selected.endSec;
  const rawSpan = Math.max(1, rangeEnd - rangeStart);
  const padding = Math.max(1, rawSpan * 2);
  const desiredSpan = Math.min(totalSeconds, Math.max(30, rawSpan + padding * 2));
  const center = (selected.startSec + selected.endSec) / 2;

  let start = center - desiredSpan / 2;
  let end = start + desiredSpan;
  if (start > rangeStart - padding) {
    start = rangeStart - padding;
    end = start + desiredSpan;
  }

  if (end < rangeEnd + padding) {
    end = rangeEnd + padding;
    start = end - desiredSpan;
  }

  start = clamp(start, 0, Math.max(0, totalSeconds - desiredSpan));
  end = clamp(start + desiredSpan, start + 0.001, totalSeconds);

  return {
    ...view,
    viewStart: clamp(start / totalSeconds, 0, 1),
    viewEnd: clamp(end / totalSeconds, start / totalSeconds, 1),
  };
}

function buildDisplayMarkerParts(rowId: string, components: Array<{ startSec: number; endSec: number }>, markerStartSec: number, markerEndSec: number, totalSec: number, selectedComponentIds: string[]): NonNullable<WaveformMarker["parts"]> {
  return components.map((component, index) => {
    const componentId = sliceComponentId(rowId, index);
    const nextComponent = components[index + 1];
    const previousDisplayEnd = index > 0 ? Math.max(components[index - 1].endSec, component.startSec) : markerStartSec;
    const displayStartSec = index === 0 ? markerStartSec : previousDisplayEnd;
    const displayEndSec = nextComponent ? Math.max(component.endSec, nextComponent.startSec) : markerEndSec;

    return {
      id: componentId,
      start: clamp(component.startSec / totalSec, 0, 1),
      end: clamp(component.endSec / totalSec, 0, 1),
      displayStart: clamp(displayStartSec / totalSec, 0, 1),
      displayEnd: clamp(Math.max(displayStartSec + 0.001, displayEndSec) / totalSec, 0, 1),
      selected: selectedComponentIds.includes(componentId),
    };
  });
}

function resolveOriginalPath(row: DataTableRow): string {
  return resolveSliceSourceIdentity(row);
}
