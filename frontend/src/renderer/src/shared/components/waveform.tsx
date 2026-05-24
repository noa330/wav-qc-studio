import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { WaveformData } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { studioBackend } from "@/services/studio-backend";

type SelectionHandleStyle = "grip" | "markerBadge" | "trimHandles" | "none";
type ViewportSelection = { x: number; width: number };

type WaveformSurfaceProps = {
  audioPath?: string;
  bucketCount?: number;
  className?: string;
  emptyText?: string;
  framedTrack?: boolean;
  allowsSelectionCreationOnClick?: boolean;
  markerHandleWidth?: number;
  selectedMarkerHandleStyle?: "line" | "markerBadge";
  selectedMarkerHandleWidth?: number;
  markers?: WaveformMarker[];
  muted?: boolean;
  revision?: number;
  showRuler?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  selectionHandleStyle?: SelectionHandleStyle;
  selectionOverlayOpacity?: number;
  selectionWaveOpacity?: number;
  draftSelectionOverlayOpacity?: number;
  draftSelectionWaveOpacity?: number;
  viewStart?: number;
  viewEnd?: number;
  playhead?: number;
  onData?: (data: WaveformData) => void;
  onMarkerSelect?: (markerId: string, additive: boolean) => void;
  onMarkerContextMenu?: (markerId: string, event: ReactMouseEvent<Element>) => void;
  onMarkerPartSelect?: (markerId: string, partId: string, additive: boolean) => void;
  onMarkerRangeChange?: (markerId: string, start: number, end: number) => void;
  onRangeCreate?: (start: number, end: number) => void;
  onSelectionChange?: (start: number, end: number) => void;
  onWheelZoom?: (anchor: number, deltaY: number) => void;
};

export type WaveformMarker = {
  id: string;
  start: number;
  end: number;
  selected?: boolean;
  parts?: Array<{
    id: string;
    start: number;
    end: number;
    displayStart?: number;
    displayEnd?: number;
    selected?: boolean;
  }>;
};

type NormalizedMarkerPart = {
  markerId: string;
  part: NonNullable<WaveformMarker["parts"]>[number];
  index: number;
  selection: ViewportSelection;
};

type NormalizedMarker = {
  marker: WaveformMarker;
  selection: ViewportSelection;
  parts: NormalizedMarkerPart[];
};

const emptyWaveform: WaveformData = {
  path: "",
  durationSeconds: 0,
  peaks: [],
};

export function WaveformSurface({
  audioPath,
  bucketCount = 420,
  className,
  markers = [],
  emptyText = "선택한 WAV 파일의 파형을 표시할 수 없습니다.",
  framedTrack = false,
  allowsSelectionCreationOnClick = true,
  markerHandleWidth = 1.5,
  selectedMarkerHandleStyle = "line",
  selectedMarkerHandleWidth = 2,
  muted = false,
  revision = 0,
  showRuler = false,
  selectionStart,
  selectionEnd,
  selectionHandleStyle = "grip",
  selectionOverlayOpacity = 1,
  selectionWaveOpacity = 0.98,
  draftSelectionOverlayOpacity = 1,
  draftSelectionWaveOpacity = 0.98,
  viewStart = 0,
  viewEnd = 1,
  playhead = 0,
  onData,
  onMarkerSelect,
  onMarkerContextMenu,
  onMarkerPartSelect,
  onMarkerRangeChange,
  onRangeCreate,
  onSelectionChange,
  onWheelZoom,
}: WaveformSurfaceProps) {
  const waveform = useWaveform(audioPath, Math.max(bucketCount, 2048), revision);
  const clipId = useId().replace(/:/gu, "");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [selectionDragActive, setSelectionDragActive] = useState(false);
  const [activeDragMarkerId, setActiveDragMarkerId] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<{ start: number; end: number } | null>(null);
  const dragRef = useRef<{
    mode: "selection-left" | "selection-right" | "selection-range" | "create" | "marker-left" | "marker-right" | "marker-range";
    startClientX: number;
    selectionStart: number;
    selectionEnd: number;
    markerId?: string;
  } | null>(null);
  const safeViewStart = clamp(viewStart, 0, 1);
  const safeViewEnd = clamp(viewEnd, safeViewStart + 0.001, 1);
  const renderedPeaks = useMemo(() => resamplePeaks(waveform.data.peaks, safeViewStart, safeViewEnd, bucketCount), [bucketCount, safeViewEnd, safeViewStart, waveform.data.peaks]);
  const hasWaveform = Boolean(audioPath) && renderedPeaks.length > 0;
  const viewBoxHeight = 100;
  const trackTop = 0;
  const trackHeight = viewBoxHeight;
  const wavePath = useMemo(() => createWavePath(renderedPeaks, 0, trackTop, 100, trackHeight), [renderedPeaks, trackHeight, trackTop]);
  const selection = normalizeSelection(selectionStart, selectionEnd, safeViewStart, safeViewEnd);
  const normalizedDraftSelection = normalizeSelection(draftSelection?.start, draftSelection?.end, safeViewStart, safeViewEnd);
  const normalizedMarkers = useMemo(
    () =>
      markers
        .map((marker): NormalizedMarker | null => {
          const selection = normalizeSelection(marker.start, marker.end, safeViewStart, safeViewEnd);
          if (!selection) {
            return null;
          }

          const parts = marker.parts
            ?.map((part, index) => ({
              markerId: marker.id,
              part,
              index,
              selection: normalizeSelection(part.displayStart ?? part.start, part.displayEnd ?? part.end, safeViewStart, safeViewEnd),
            }))
            .filter((entry): entry is NormalizedMarkerPart => entry.selection !== null) ?? [];

          return { marker, selection, parts };
        })
        .filter((entry): entry is NormalizedMarker => entry !== null),
    [markers, safeViewEnd, safeViewStart],
  );
  const displayedMarkers = useMemo(
    () =>
      normalizedMarkers.map((entry) => ({
        ...entry,
        selection: entry.selection,
      })),
    [normalizedMarkers],
  );
  const displayedMarkerParts = useMemo(
    () => displayedMarkers.flatMap((entry) => entry.parts),
    [displayedMarkers],
  );
  const selectionLinkedMarkerSelection = useMemo(() => {
    if (!selection) {
      return null;
    }

    const match = normalizedMarkers.find(({ marker, selection: markerSelection }) => marker.selected && areSelectionsNearlyEqual(markerSelection, selection));
    if (!match) {
      return null;
    }

    return match.selection;
  }, [normalizedMarkers, selection]);
  const animatedSelection = selection;
  const displayedSelection = normalizedDraftSelection ?? (selectionDragActive ? selection : selectionLinkedMarkerSelection ?? animatedSelection);
  const displayedSelectionOverlayOpacity = normalizedDraftSelection ? draftSelectionOverlayOpacity : selectionOverlayOpacity;
  const isResizeDragging = (() => {
    const mode = dragRef.current?.mode;
    return mode === "selection-left" || mode === "selection-right" || mode === "marker-left" || mode === "marker-right";
  })();
  const markerTransitionStyle = isResizeDragging
    ? { transition: "fill 140ms ease, opacity 140ms ease" }
    : { transition: "left 120ms ease-out, width 120ms ease-out, fill 140ms ease, opacity 140ms ease" };
  const markerHandleTransitionStyle = isResizeDragging
    ? { transition: "stroke 140ms ease, stroke-width 140ms ease" }
    : { transition: "x1 120ms ease-out, x2 120ms ease-out, stroke 140ms ease, stroke-width 140ms ease" };
  const displayedSelectionWaveOpacity = normalizedDraftSelection ? draftSelectionWaveOpacity : selectionWaveOpacity;
  const playheadX = progressToViewportX(playhead, safeViewStart, safeViewEnd);
  const markerBadgeAnchors = useMemo<WaveformBadgeAnchor[]>(() => {
    const anchors: WaveformBadgeAnchor[] = [];

    if (selectedMarkerHandleStyle === "markerBadge") {
      for (const { marker, selection: markerSelection } of displayedMarkers) {
        if (!marker.selected) {
          continue;
        }

        anchors.push({ id: `${marker.id}-start`, x: markerSelection.x });
        anchors.push({ id: `${marker.id}-end`, x: markerSelection.x + markerSelection.width });
      }
    }

    if (selectionHandleStyle === "markerBadge" && displayedSelection) {
      anchors.push({ id: "selection-start", x: displayedSelection.x });
      anchors.push({ id: "selection-end", x: displayedSelection.x + displayedSelection.width });
    }

    return anchors;
  }, [displayedMarkers, displayedSelection, selectedMarkerHandleStyle, selectionHandleStyle]);

  useEffect(() => {
    if (!onSelectionChange && !onRangeCreate && !onMarkerRangeChange) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!drag || !rect || rect.width <= 0) {
        return;
      }

      event.preventDefault();
      const progressDelta = ((event.clientX - drag.startClientX) / rect.width) * (safeViewEnd - safeViewStart);
      const minimumWidth = 0.00005;

      if (drag.mode === "create") {
        const progress = clientXToProgress(event.clientX, rect, safeViewStart, safeViewEnd);
        drag.selectionEnd = progress;
        const start = Math.min(drag.selectionStart, progress);
        const end = Math.max(drag.selectionStart, progress);
        setDraftSelection({ start, end });
        return;
      }

      if (drag.mode.startsWith("marker-")) {
        if (!onMarkerRangeChange || !drag.markerId) {
          return;
        }

        if (drag.mode === "marker-left") {
          onMarkerRangeChange(drag.markerId, clamp(drag.selectionStart + progressDelta, 0, drag.selectionEnd - minimumWidth), drag.selectionEnd);
          return;
        }

        if (drag.mode === "marker-right") {
          onMarkerRangeChange(drag.markerId, drag.selectionStart, clamp(drag.selectionEnd + progressDelta, drag.selectionStart + minimumWidth, 1));
          return;
        }

        const width = Math.max(minimumWidth, drag.selectionEnd - drag.selectionStart);
        const nextStart = clamp(drag.selectionStart + progressDelta, 0, 1 - width);
        onMarkerRangeChange(drag.markerId, nextStart, nextStart + width);
        return;
      }

      if (!onSelectionChange) {
        return;
      }

      if (drag.mode === "selection-left") {
        onSelectionChange(clamp(drag.selectionStart + progressDelta, 0, drag.selectionEnd - minimumWidth), drag.selectionEnd);
        return;
      }

      if (drag.mode === "selection-right") {
        onSelectionChange(drag.selectionStart, clamp(drag.selectionEnd + progressDelta, drag.selectionStart + minimumWidth, 1));
        return;
      }

      const width = Math.max(minimumWidth, drag.selectionEnd - drag.selectionStart);
      const nextStart = clamp(drag.selectionStart + progressDelta, 0, 1 - width);
      onSelectionChange(nextStart, nextStart + width);
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag?.mode === "create" && onRangeCreate) {
        const start = Math.min(drag.selectionStart, drag.selectionEnd);
        const end = Math.max(drag.selectionStart, drag.selectionEnd);
        if (end - start >= 0.00005) {
          onRangeCreate(start, end);
        }
      }
      dragRef.current = null;
      setDraftSelection(null);
      setSelectionDragActive(false);
      setActiveDragMarkerId(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draftSelection, onMarkerRangeChange, onRangeCreate, onSelectionChange, safeViewEnd, safeViewStart]);

  const beginSelectionDrag = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (!onSelectionChange && !onRangeCreate) || !hasWaveform) {
      return;
    }

    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return;
    }

    event.preventDefault();
    const progress = clientXToProgress(event.clientX, rect, safeViewStart, safeViewEnd);
    const hasSelection = selectionStart !== undefined && selectionEnd !== undefined && selectionEnd > selectionStart;
    const currentStart = hasSelection ? selectionStart : progress;
    const currentEnd = hasSelection ? selectionEnd : progress;
    const target = event.target instanceof Element ? event.target : null;
    const explicitHandle = target?.closest("[data-selection-handle]")?.getAttribute("data-selection-handle");
    if (onSelectionChange && (explicitHandle === "left" || explicitHandle === "right")) {
      dragRef.current = {
        mode: explicitHandle === "left" ? "selection-left" : "selection-right",
        startClientX: event.clientX,
        selectionStart: currentStart,
        selectionEnd: currentEnd,
      };
      setSelectionDragActive(true);
      return;
    }

    const handleHitWidth = (12 / rect.width) * (safeViewEnd - safeViewStart);
    const leftHit = Math.abs(progress - currentStart) <= handleHitWidth;
    const rightHit = Math.abs(progress - currentEnd) <= handleHitWidth;

    if (onSelectionChange && hasSelection && (leftHit || rightHit || (progress >= currentStart && progress <= currentEnd))) {
      dragRef.current = {
        mode: leftHit ? "selection-left" : rightHit ? "selection-right" : "selection-range",
        startClientX: event.clientX,
        selectionStart: currentStart,
        selectionEnd: currentEnd,
      };
      setSelectionDragActive(true);
      return;
    }

    if (onRangeCreate) {
      dragRef.current = {
        mode: "create",
        startClientX: event.clientX,
        selectionStart: progress,
        selectionEnd: progress,
      };
      setDraftSelection({ start: progress, end: progress });
      setSelectionDragActive(true);
      return;
    }

    if (!allowsSelectionCreationOnClick || !onSelectionChange) {
      return;
    }

    const halfWidth = Math.max(0.00005, (safeViewEnd - safeViewStart) * 0.1);
    const nextStart = clamp(progress - halfWidth, 0, 1 - halfWidth * 2);
    const nextEnd = clamp(progress + halfWidth, nextStart + 0.00005, 1);
    onSelectionChange(nextStart, nextEnd);
    dragRef.current = {
      mode: "selection-range",
      startClientX: event.clientX,
      selectionStart: nextStart,
      selectionEnd: nextEnd,
    };
    setSelectionDragActive(true);
  };

  const beginMarkerDrag = (marker: WaveformMarker, event: ReactMouseEvent<Element>) => {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    onMarkerSelect?.(marker.id, event.ctrlKey || event.metaKey);

    if (!onMarkerRangeChange || !hasWaveform) {
      return;
    }

    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || marker.end <= marker.start) {
      return;
    }

    event.preventDefault();
    const progress = clientXToProgress(event.clientX, rect, safeViewStart, safeViewEnd);
    const handleHitWidth = (12 / rect.width) * (safeViewEnd - safeViewStart);
    const leftHit = Math.abs(progress - marker.start) <= handleHitWidth;
    const rightHit = Math.abs(progress - marker.end) <= handleHitWidth;

    dragRef.current = {
      mode: leftHit ? "marker-left" : rightHit ? "marker-right" : "marker-range",
      markerId: marker.id,
      startClientX: event.clientX,
      selectionStart: marker.start,
      selectionEnd: marker.end,
    };
    setActiveDragMarkerId(marker.id);
    setSelectionDragActive(true);
  };

  useEffect(() => {
    onData?.(waveform.data);
  }, [onData, waveform.data]);

  return (
    <div
      ref={surfaceRef}
      className={cn("relative grid h-full min-h-[22px] overflow-hidden", showRuler ? "grid-rows-[24px_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]", muted && "opacity-35", className)}
      onWheel={(event) => {
        if (!hasWaveform || !onWheelZoom) {
          return;
        }

        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const anchor = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;
        onWheelZoom(anchor, event.deltaY);
      }}
    >
      {showRuler && waveform.data.durationSeconds > 0 ? <TimeRuler durationSeconds={waveform.data.durationSeconds} viewStart={safeViewStart} viewEnd={safeViewEnd} /> : null}
      {hasWaveform ? (
        <div className={cn("relative h-full min-h-0 w-full overflow-hidden", framedTrack && "rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]")}>
          <svg className="block h-full w-full min-h-0" preserveAspectRatio="none" viewBox={`0 0 100 ${viewBoxHeight}`} role="img" aria-label="WAV waveform" onMouseDown={beginSelectionDrag}>
          <rect x="0" y={trackTop} width="100" height={trackHeight} rx="1.6" fill="var(--field-bg)" />
          <path d={wavePath} fill="var(--waveform-base)" opacity="0.88" />
          {displayedMarkers.map(({ marker, selection: markerSelection, parts }) => (
            <g
              key={marker.id}
              className={onMarkerRangeChange ? "cursor-grab active:cursor-grabbing" : onMarkerSelect ? "cursor-pointer" : undefined}
              onMouseDown={(event) => beginMarkerDrag(marker, event)}
              onContextMenu={(event) => onMarkerContextMenu?.(marker.id, event)}
            >
              <rect
                x={markerSelection.x}
                y={trackTop}
                width={markerSelection.width}
                height={trackHeight}
                fill={marker.selected ? "rgba(150,124,224,.58)" : "rgba(132,108,195,.32)"}
                opacity={marker.selected ? 0.86 : 0.72}
                style={markerTransitionStyle}
              />
              <line
                x1={markerSelection.x}
                x2={markerSelection.x}
                y1={trackTop}
                y2={trackTop + trackHeight}
                stroke={marker.selected ? "var(--accent-blue)" : "rgba(242,247,255,.42)"}
                strokeWidth={marker.selected ? selectedMarkerHandleWidth : markerHandleWidth}
                vectorEffect="non-scaling-stroke"
                style={markerHandleTransitionStyle}
              />
              <line
                x1={markerSelection.x + markerSelection.width}
                x2={markerSelection.x + markerSelection.width}
                y1={trackTop}
                y2={trackTop + trackHeight}
                stroke={marker.selected ? "var(--accent-blue)" : "rgba(242,247,255,.42)"}
                strokeWidth={marker.selected ? selectedMarkerHandleWidth : markerHandleWidth}
                vectorEffect="non-scaling-stroke"
                style={markerHandleTransitionStyle}
              />
              {parts.map(({ part, selection: partSelection }) => (
                <rect
                  key={`hit-${part.id}`}
                  x={partSelection.x}
                  y={trackTop}
                  width={partSelection.width}
                  height={trackHeight}
                  fill="transparent"
                  className={onMarkerRangeChange ? "cursor-grab active:cursor-grabbing" : onMarkerSelect || onMarkerPartSelect ? "cursor-pointer" : undefined}
                  onMouseDown={(event) => {
                    if (event.shiftKey) {
                      event.stopPropagation();
                      return;
                    }

                    beginMarkerDrag(marker, event);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.shiftKey) {
                      onMarkerPartSelect?.(marker.id, part.id, event.ctrlKey || event.metaKey);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    onMarkerContextMenu?.(marker.id, event);
                  }}
                />
              ))}
            </g>
          ))}
          {displayedSelection ? (
            <>
              <rect x={displayedSelection.x} y={trackTop} width={displayedSelection.width} height={trackHeight} fill="var(--waveform-selection-fill)" opacity={displayedSelectionOverlayOpacity} pointerEvents="none" />
              <clipPath id={clipId}>
                <rect x={displayedSelection.x} y={trackTop} width={displayedSelection.width} height={trackHeight} />
              </clipPath>
              <path d={wavePath} clipPath={`url(#${clipId})`} fill="var(--waveform-selected-wave)" opacity={displayedSelectionWaveOpacity} pointerEvents="none" />
            </>
          ) : null}
          {displayedMarkerParts.map(({ part, selection: partSelection }) =>
            part.selected ? <rect key={`selected-part-${part.id}`} x={partSelection.x} y={trackTop} width={partSelection.width} height={trackHeight} fill="rgba(121,84,209,.62)" pointerEvents="none" style={markerTransitionStyle} /> : null,
          )}
          {displayedMarkerParts.map(({ part, index, selection: partSelection }) =>
            index > 0 ? (
              <line
                key={`divider-${part.id}`}
                x1={partSelection.x}
                x2={partSelection.x}
                y1={trackTop + 3}
                y2={trackTop + trackHeight - 3}
                stroke="#cbd5f6"
                strokeWidth="0.65"
                strokeDasharray="2.2 2.2"
                vectorEffect="non-scaling-stroke"
                shapeRendering="crispEdges"
                pointerEvents="none"
              />
            ) : null,
          )}
          {displayedSelection ? <SelectionHandles selection={displayedSelection} trackTop={trackTop} trackHeight={trackHeight} style={selectionHandleStyle} /> : null}
          {playheadX !== null ? (
            <g>
              <line x1={playheadX} x2={playheadX} y1={trackTop} y2={viewBoxHeight} stroke="rgba(0,0,0,.55)" strokeWidth="0.45" />
              <line x1={playheadX} x2={playheadX} y1={trackTop} y2={viewBoxHeight} stroke="var(--primary-text)" strokeWidth="0.16" />
            </g>
          ) : null}
          <rect x="0.1" y={trackTop + 0.1} width="99.8" height={trackHeight - 0.2} rx="1.6" fill="none" stroke="var(--panel-stroke)" strokeWidth="0.25" />
          </svg>
          <WaveformBadgeLayer anchors={markerBadgeAnchors} />
        </div>
      ) : (
        <div className={cn("row-start-1 row-end-[-1] flex h-full min-h-[86px] items-center justify-center px-4 text-center text-sm text-[var(--secondary-text)]", framedTrack && "rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]")}>
          {waveform.loading ? "파형을 읽는 중입니다." : waveform.data.error || emptyText}
        </div>
      )}
    </div>
  );
}

function SelectionHandles({ selection, trackTop, trackHeight, style }: { selection: { x: number; width: number }; trackTop: number; trackHeight: number; style: SelectionHandleStyle }) {
  if (style === "none") {
    return null;
  }

  if (style === "markerBadge") {
    return (
      <>
        <MarkerBadgeHandle x={selection.x} trackTop={trackTop} trackHeight={trackHeight} side="left" />
        <MarkerBadgeHandle x={selection.x + selection.width} trackTop={trackTop} trackHeight={trackHeight} side="right" />
      </>
    );
  }

  if (style === "trimHandles") {
    return (
      <>
        <TrimRangeHandle x={selection.x} trackTop={trackTop} trackHeight={trackHeight} side="left" />
        <TrimRangeHandle x={selection.x + selection.width} trackTop={trackTop} trackHeight={trackHeight} side="right" />
      </>
    );
  }

  return (
    <>
      <line x1={selection.x} x2={selection.x} y1={trackTop} y2={trackTop + trackHeight} stroke="var(--primary-text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <line x1={selection.x + selection.width} x2={selection.x + selection.width} y1={trackTop} y2={trackTop + trackHeight} stroke="var(--primary-text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </>
  );
}

function TrimRangeHandle({ x, trackTop, trackHeight, side }: { x: number; trackTop: number; trackHeight: number; side: "left" | "right" }) {
  const handleWidth = 1.35;
  const hitWidth = 3.2;
  const handleTop = trackTop;
  const handleHeight = trackHeight;
  const handleLeft = side === "left" ? x : x - handleWidth;
  const hitLeft = x - hitWidth / 2;

  return (
    <g className="cursor-ew-resize" data-selection-handle={side}>
      <rect x={hitLeft} y={trackTop} width={hitWidth} height={trackHeight} fill="transparent" />
      <rect x={handleLeft} y={handleTop} width={handleWidth} height={handleHeight} rx="0.25" fill="var(--primary-text)" opacity="0.96" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

type WaveformBadgeAnchor = { id: string; x: number };

const markerBadgeWidthPx = 16;
const markerBadgeHeightPx = 22;

function MarkerBadgeHandle({ x, trackTop, trackHeight, side }: { x: number; trackTop: number; trackHeight: number; side: "left" | "right" }) {
  const hitWidth = 3.2;
  return (
    <g className="cursor-ew-resize" data-selection-handle={side}>
      <rect x={x - hitWidth / 2} y={trackTop} width={hitWidth} height={trackHeight} fill="transparent" />
      <line x1={x} x2={x} y1={trackTop} y2={trackTop + trackHeight} stroke="var(--accent-blue)" strokeWidth="1.35" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function WaveformBadgeLayer({ anchors }: { anchors: WaveformBadgeAnchor[] }) {
  if (anchors.length === 0) {
    return null;
  }

  const horizontalClamp = markerBadgeWidthPx / 2;

  return (
    <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true">
      {anchors.map((anchor) => (
        <svg
          key={anchor.id}
          className="absolute top-px overflow-visible"
          style={{
            left: `clamp(${horizontalClamp}px, ${anchor.x}%, calc(100% - ${horizontalClamp}px))`,
            width: markerBadgeWidthPx,
            height: markerBadgeHeightPx,
            transform: "translateX(-50%)",
          }}
          viewBox="0 0 16 21.8"
          preserveAspectRatio="xMidYMid meet"
        >
          <path
            d="M 2.7 0.7 L 13.3 0.7 C 14.4 0.7 15.3 1.6 15.3 2.7 L 15.3 11.8 C 15.3 12.7 14.8 13.5 14 14.2 L 8 21.1 L 2 14.2 C 1.2 13.5 0.7 12.7 0.7 11.8 L 0.7 2.7 C 0.7 1.6 1.6 0.7 2.7 0.7 Z"
            fill="var(--accent-blue)"
            stroke="var(--panel-stroke)"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <path d="M 5 8 L 7.3 10.4 L 11.4 5.9" fill="none" stroke="var(--primary-text)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </div>
  );
}

function useAnimatedSelection(target: ViewportSelection | null, enabled: boolean): ViewportSelection | null {
  const targetKey = target ? `${target.x}:${target.width}` : "none";
  const [displayed, setDisplayed] = useState<ViewportSelection | null>(target);
  const displayedRef = useRef<ViewportSelection | null>(target);

  useEffect(() => {
    if (!enabled || !target) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    const start = displayedRef.current ?? target;
    let frame = 0;
    const startedAt = performance.now();
    const duration = 160;

    const step = (now: number) => {
      const progress = easeOutCubic(clamp((now - startedAt) / duration, 0, 1));
      const next = {
        x: start.x + (target.x - start.x) * progress,
        width: start.width + (target.width - start.width) * progress,
      };
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [enabled, targetKey]);

  return displayed;
}

function useAnimatedSelectionMap(targets: Array<{ id: string; selection: ViewportSelection }>): Map<string, ViewportSelection> {
  const targetKey = targets.map(({ id, selection }) => `${id}:${selection.x}:${selection.width}`).join("|");
  const [displayed, setDisplayed] = useState<Map<string, ViewportSelection>>(() => new Map(targets.map(({ id, selection }) => [id, selection])));
  const displayedRef = useRef(displayed);

  useEffect(() => {
    const targetMap = new Map(targets.map(({ id, selection }) => [id, selection]));
    const startMap = displayedRef.current;
    let frame = 0;
    const startedAt = performance.now();
    const duration = 170;

    const step = (now: number) => {
      const progress = easeOutCubic(clamp((now - startedAt) / duration, 0, 1));
      const next = new Map<string, ViewportSelection>();
      for (const [id, target] of targetMap) {
        const start = startMap.get(id) ?? target;
        next.set(id, {
          x: start.x + (target.x - start.x) * progress,
          width: start.width + (target.width - start.width) * progress,
        });
      }
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [targetKey]);

  return displayed;
}


function areSelectionsNearlyEqual(left: ViewportSelection, right: ViewportSelection): boolean {
  return Math.abs(left.x - right.x) <= 0.04 && Math.abs(left.width - right.width) <= 0.04;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function useWaveform(audioPath: string | undefined, bucketCount: number, revision: number) {
  const [data, setData] = useState<WaveformData>(emptyWaveform);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let disposed = false;
    const path = audioPath?.trim();
    if (!path) {
      setData(emptyWaveform);
      setLoading(false);
      return;
    }

    if (path.startsWith("guide://")) {
      setData(createGuideWaveform(path, bucketCount));
      setLoading(false);
      return;
    }

    setLoading(true);
    void studioBackend
      .readWaveform(path, bucketCount)
      .then((nextData) => {
        if (!disposed) {
          setData(nextData);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setData({ path, durationSeconds: 0, peaks: [], error: error instanceof Error ? error.message : String(error) });
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [audioPath, bucketCount, revision]);

  return { data, loading };
}

function createGuideWaveform(path: string, bucketCount: number): WaveformData {
  const durationSeconds = guideDuration(path);
  const count = Math.max(128, bucketCount);
  const seed = Array.from(path).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const peaks = Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    const envelope = Math.sin(Math.PI * t) ** 0.42;
    const carrier = Math.abs(Math.sin(t * 28 + seed * 0.00003));
    const detail = Math.abs(Math.sin(t * 93 + seed * 0.00011)) * 0.38;
    return Math.min(1, Math.max(0.08, envelope * (0.32 + carrier * 0.5 + detail * 0.28)));
  });

  return {
    path,
    durationSeconds,
    peaks,
  };
}

function guideDuration(path: string): number {
  const lower = path.toLowerCase();
  if (lower.includes("dialogue")) {
    return 3.2;
  }
  if (lower.includes("result")) {
    return 5.8;
  }
  if (lower.includes("reference") || lower.includes("prompt")) {
    return 4.9;
  }
  return 6.4;
}

function TimeRuler({ durationSeconds, viewStart, viewEnd }: { durationSeconds: number; viewStart: number; viewEnd: number }) {
  const majorCount = 5;
  return (
    <div className="relative h-6 select-none overflow-hidden border-0 bg-transparent text-[11px] leading-none text-[var(--waveform-ruler-text)]">
      {Array.from({ length: majorCount * 4 + 1 }).map((_, index) => {
        const isMajor = index % 4 === 0;
        return <span key={`tick-${index}`} className={cn("absolute bottom-0 w-px", isMajor ? "h-[6px] bg-[var(--waveform-ruler-major)]" : "h-[4px] bg-[var(--waveform-ruler-minor)]")} style={{ left: `${(index / (majorCount * 4)) * 100}%` }} />;
      })}
      {Array.from({ length: majorCount + 1 }).map((_, index) => {
        const x = `${(index / majorCount) * 100}%`;
        const progress = viewStart + (viewEnd - viewStart) * (index / majorCount);
        return (
          <div key={`label-${index}`} className="absolute top-0 h-full" style={{ left: x }}>
            <span className={cn("absolute top-0 whitespace-nowrap", index === 0 ? "left-0" : index === majorCount ? "right-0" : "left-1/2 -translate-x-1/2")}>{formatTime(durationSeconds * progress)}</span>
          </div>
        );
      })}
    </div>
  );
}

function createWavePath(peaks: number[], x: number, y: number, width: number, height: number): string {
  if (peaks.length === 0) {
    return "";
  }

  const centerY = y + height / 2;
  const maxHalf = Math.max(2, height / 2);
  const step = peaks.length > 1 ? width / (peaks.length - 1) : width;
  const topPoints = peaks.map((peak, index) => {
    const px = Math.min(x + width, x + index * step);
    const py = centerY - clamp(peak, 0, 1) * maxHalf;
    return `${px.toFixed(3)} ${py.toFixed(3)}`;
  });
  const bottomPoints = peaks
    .map((peak, index) => {
      const px = Math.min(x + width, x + index * step);
      const py = centerY + clamp(peak, 0, 1) * maxHalf;
      return `${px.toFixed(3)} ${py.toFixed(3)}`;
    })
    .reverse();

  return `M ${x} ${centerY.toFixed(3)} L ${topPoints.join(" L ")} L ${bottomPoints.join(" L ")} Z`;
}

function normalizeSelection(start: number | undefined, end: number | undefined, viewStart: number, viewEnd: number): { x: number; width: number } | null {
  if (start === undefined || end === undefined || end <= start) {
    return null;
  }

  if (end < viewStart || start > viewEnd) {
    return null;
  }

  const x = progressToViewportX(Math.max(start, viewStart), viewStart, viewEnd);
  const right = progressToViewportX(Math.min(end, viewEnd), viewStart, viewEnd);
  if (x === null || right === null || right <= x) {
    return null;
  }

  return { x, width: right - x };
}

function progressToViewportX(progress: number | undefined, viewStart: number, viewEnd: number): number | null {
  if (progress === undefined || progress < viewStart || progress > viewEnd) {
    return null;
  }

  const span = Math.max(0.001, viewEnd - viewStart);
  return clamp(((progress - viewStart) / span) * 100, 0, 100);
}

function clientXToProgress(clientX: number, rect: DOMRect, viewStart: number, viewEnd: number): number {
  const viewportRatio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  return clamp(viewStart + viewportRatio * (viewEnd - viewStart), 0, 1);
}

function resamplePeaks(source: number[], start: number, end: number, targetCount: number): number[] {
  if (source.length === 0 || targetCount <= 0) {
    return [];
  }

  const result = new Array<number>(Math.max(16, targetCount));
  const startIndex = clamp(start, 0, 1) * (source.length - 1);
  const endIndex = clamp(end, start + 0.001, 1) * (source.length - 1);
  const span = Math.max(1, endIndex - startIndex);

  for (let index = 0; index < result.length; index += 1) {
    const ratio = result.length === 1 ? 0 : index / (result.length - 1);
    const sourceIndex = startIndex + ratio * span;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(source.length - 1, lower + 1);
    const t = sourceIndex - lower;
    result[index] = source[lower] * (1 - t) + source[upper] * t;
  }

  return result;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalSeconds = Math.floor(safeSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
