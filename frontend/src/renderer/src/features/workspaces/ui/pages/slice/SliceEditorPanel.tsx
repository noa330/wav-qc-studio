import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { motion } from "motion/react";
import type { DataTableRow, WaveformData } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/shared/components/controls";
import { WaveformSurface, type WaveformMarker } from "@/shared/components/waveform";
import { useAudioTransport } from "@/shared/hooks/use-audio-transport";
import { WorkspaceAudioCardLayout } from "../../shared/WorkspaceAudioCardLayout";
import { UnifiedAudioTransportBar } from "../../shared/UnifiedAudioTransportBar";
import { clamp, numberFromRow } from "../../shared/workspace-ui-utils";
import { pressTap, tightPressTap } from "@/shared/motion";
import { readSliceComponents, readSliceRowBounds, sliceRowIdFromComponentId } from "../../../model/slice-segments";
import { buildDisplayMarkerParts, resolveOriginalPath } from "./slice-editor-marker-utils";
import { SliceMarkerContextMenu, type SliceMarkerMenuState } from "./slice-editor-controls";

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
  selectedComponentIds: string[];
  setSelectedComponentIds: Dispatch<SetStateAction<string[]>>;
  animateMarkerTransitions: boolean;
  triggerMarkerTransitions: () => void;
};

export function SliceEditorHeaderControls({ view, actions, disabled = false }: { view: SliceEditorViewState; actions: SliceEditorViewActions; disabled?: boolean }) {
  return (
    <span className="flex min-w-max shrink-0 items-center gap-2" data-app-tour-target="slice-editor-header-controls">
      <ToggleSwitch checked={view.loopPreview} onChange={actions.setLoopPreview} disabled={disabled} />
      <span className={cn("text-sm text-[var(--primary-text)]", disabled && "opacity-45")}>루프 미리보기</span>
      <div className={cn("ml-2 flex h-8 overflow-hidden rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)]", disabled && "opacity-45")}>
        <motion.button type="button" disabled={disabled} onClick={actions.zoomOut} whileTap={disabled ? undefined : tightPressTap} className="flex w-8 items-center justify-center" aria-label="축소">
          <ZoomOut className="size-[18px]" strokeWidth={1.4} />
        </motion.button>
        <motion.button type="button" disabled={disabled} onClick={actions.zoomIn} whileTap={disabled ? undefined : tightPressTap} className="flex w-8 items-center justify-center" aria-label="확대">
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
  selectedComponentIds: controlledSelectedComponentIds,
  onSelectedComponentIdsChange,
  animateMarkerTransitions = false,
  onMarkerTransitionRequest,
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
  selectedComponentIds?: string[];
  onSelectedComponentIdsChange?: Dispatch<SetStateAction<string[]>>;
  animateMarkerTransitions?: boolean;
  onMarkerTransitionRequest?: () => void;
}) {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [localSelectedComponentIds, setLocalSelectedComponentIds] = useState<string[]>([]);
  const [markerMenu, setMarkerMenu] = useState<SliceMarkerMenuState | undefined>();
  const markerMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedComponentIds = controlledSelectedComponentIds ?? localSelectedComponentIds;
  const setSelectedComponentIds = onSelectedComponentIdsChange ?? setLocalSelectedComponentIds;
  const hasAudio = Boolean(audioPath);
  const { startSec, endSec } = readSliceRowBounds(row);
  const audioDurationSec = waveform && waveform.path === audioPath ? waveform.durationSeconds : 0;
  const durationSec = row ? Math.max(0, endSec - startSec || numberFromRow(row, "durationSec")) : audioDurationSec;
  const totalSec = Math.max(audioDurationSec, endSec, durationSec, 1);
  const selectionStart = hasAudio && row && endSec > startSec ? startSec / totalSec : undefined;
  const selectionEnd = hasAudio && row && endSec > startSec ? endSec / totalSec : undefined;
  const controlsEnabled = hasAudio;
  const segmentNavEnabled = controlsEnabled && Boolean(row);
  const selectedRowSet = useMemo(() => new Set(selectedRowIds.length > 0 ? selectedRowIds : row ? [row.id] : []), [row, selectedRowIds]);
  const selectedComponents = useMemo(() => (row ? readSliceComponents(row) : []), [row]);
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

  // Removed ResizeObserver for controlsCompact as it is now strictly 2-row layout


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
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <WorkspaceAudioCardLayout
        hasAudio={hasAudio}
        emptyText="선택한 WAV 파일의 파형을 표시할 수 없습니다."
        dataTourTarget="slice-editor-waveform"
        minimapTourTarget="slice-editor-minimap"
        className="min-h-0 flex-1"
        waveform={
          <WaveformSurface
            audioPath={audioPath}
            bucketCount={720}
            showRuler
            rulerPosition="top"
            markers={markers}
            selectionStart={selectionStart}
            selectionEnd={selectionEnd}
            selectionHandleStyle="markerBadge"
            allowsSelectionCreationOnClick={false}
            animateMarkerTransitions={animateMarkerTransitions}
            markerHandleWidth={1.5}
            selectedMarkerHandleWidth={2}
            selectionOverlayOpacity={0}
            selectionWaveOpacity={0}
            viewStart={view.viewStart}
            viewEnd={view.viewEnd}
            playhead={transport.progress}
            isPlaying={transport.isPlaying}
            playheadVisible={transport.playheadVisible}
            showBorder={false}
            showRulerTicks={false}
            onPlayheadChange={(progress) => transport.seek(progress * totalSec)}
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
        }
        minimap={
          <WaveformSurface
            audioPath={audioPath}
            bucketCount={260}
            selectionStart={view.viewStart}
            selectionEnd={view.viewEnd}
            selectionHandleStyle="line"
            allowsSelectionCreationOnClick={false}
            emptyText=""
            showBorder={false}
            onSelectionChange={actions?.setViewRange}
          />
        }
        controls={
          <UnifiedAudioTransportBar
            transport={transport}
            disabled={!controlsEnabled}
            themeColor="blue"
            framed={false}
            className="mt-[8px] mb-[4px]"
          />
        }
      />
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
              onMarkerTransitionRequest?.();
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
            onMarkerTransitionRequest?.();
            onMergeSegments();
          }}
        />
      ) : null}
    </div>
  );
}

export function SliceEditorActionsBody({
  row,
  audioPath,
  onSplitOrUnmergeSegment,
  onMergeSegments,
  selectedRowIds = [],
  selectedComponentIds,
  setSelectedComponentIds,
  onMarkerTransitionRequest,
}: {
  row?: DataTableRow;
  audioPath?: string;
  onSplitOrUnmergeSegment: (row: DataTableRow, componentIds: string[]) => void;
  onMergeSegments: () => void;
  selectedRowIds?: string[];
  selectedComponentIds: string[];
  setSelectedComponentIds?: Dispatch<SetStateAction<string[]>>;
  onMarkerTransitionRequest: () => void;
}) {
  const controlsEnabled = Boolean(audioPath);
  const selectedRowSet = useMemo(() => new Set(selectedRowIds.length > 0 ? selectedRowIds : row ? [row.id] : []), [row, selectedRowIds]);
  const selectedComponents = useMemo(() => (row ? readSliceComponents(row) : []), [row]);
  const isMergedMarker = selectedComponents.length > 1;
  const updateSelectedComponentIds = setSelectedComponentIds ?? (() => undefined);
  const rowControlsEnabled = controlsEnabled && Boolean(row);

  return (
    <div data-app-tour-target="slice-editor-actions" className="flex h-full min-h-0 min-w-max flex-none items-center justify-start gap-2 px-0 py-0">
      <motion.button type="button" disabled={!rowControlsEnabled} onClick={() => {
        if (!row) {
          return;
        }
        onMarkerTransitionRequest();
        onSplitOrUnmergeSegment(row, selectedComponentIds);
        updateSelectedComponentIds([]);
      }} whileTap={rowControlsEnabled ? pressTap : undefined} className="wpf-button wpf-button-on-card h-[38px] flex-none whitespace-nowrap px-3 text-sm disabled:cursor-default disabled:text-[var(--secondary-text)]">
        {isMergedMarker ? "병합 해제" : "마커 분할"}
      </motion.button>
      <motion.button type="button" disabled={!controlsEnabled || selectedRowSet.size < 2} onClick={() => {
        updateSelectedComponentIds([]);
        onMarkerTransitionRequest();
        onMergeSegments();
      }} whileTap={controlsEnabled && selectedRowSet.size >= 2 ? pressTap : undefined} className="wpf-button wpf-button-on-card h-[38px] flex-none whitespace-nowrap px-3 text-sm disabled:cursor-default disabled:text-[var(--secondary-text)]">
        마커 병합
      </motion.button>
    </div>
  );
}
