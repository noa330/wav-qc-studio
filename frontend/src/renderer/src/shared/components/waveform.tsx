import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";
import { useWaveform } from "./waveform-data";
import { areSelectionsNearlyEqual, clamp, clientXToProgress, createWavePath, normalizeSelection, progressToViewportX, resamplePeaks } from "./waveform-geometry";
import { SelectionHandles, WaveformBadgeLayer } from "./waveform-handles";
import { buildMarkerBadgeAnchors, buildNormalizedMarkers } from "./waveform-markers";
import { TimeRuler } from "./waveform-ruler";
import type { WaveformMarker, WaveformSurfaceProps } from "./waveform-types";

export type { WaveformMarker } from "./waveform-types";

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
  rulerPosition = "top",
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
  isPlaying = false,
  onData,
  onMarkerSelect,
  onMarkerContextMenu,
  onMarkerPartSelect,
  onMarkerRangeChange,
  onRangeCreate,
  onSelectionChange,
  onWheelZoom,
  useMarkerStyleForSelection = false,
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
  const normalizedMarkers = useMemo(() => buildNormalizedMarkers(markers, safeViewStart, safeViewEnd), [markers, safeViewEnd, safeViewStart]);
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
  const markerBadgeAnchors = useMemo(
    () => buildMarkerBadgeAnchors({ displayedMarkers, displayedSelection, selectedMarkerHandleStyle, selectionHandleStyle }),
    [displayedMarkers, displayedSelection, selectedMarkerHandleStyle, selectionHandleStyle],
  );

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
      className={cn(
        "relative grid h-full min-h-[22px] overflow-visible",
        showRuler ? (rulerPosition === "bottom" ? "grid-rows-[minmax(0,1fr)_24px]" : "grid-rows-[24px_minmax(0,1fr)]") : "grid-rows-[minmax(0,1fr)]",
        muted && "opacity-35",
        className
      )}
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
      {showRuler && rulerPosition === "top" && waveform.data.durationSeconds > 0 ? (
        <TimeRuler durationSeconds={waveform.data.durationSeconds} viewStart={safeViewStart} viewEnd={safeViewEnd} position="top" />
      ) : null}
      {hasWaveform ? (
        <div className={cn("relative h-full min-h-0 w-full overflow-visible", framedTrack && "border-t border-b border-[var(--panel-stroke)]")}>
          <svg className="block h-full w-full min-h-0" preserveAspectRatio="none" viewBox={`0 0 100 ${viewBoxHeight}`} role="img" aria-label="WAV waveform" onMouseDown={beginSelectionDrag}>
          <rect x="0" y={trackTop} width="100" height={trackHeight} fill="transparent" />
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
              {marker.selected ? (
                <>
                  <line
                    x1={markerSelection.x}
                    x2={markerSelection.x}
                    y1={trackTop}
                    y2={trackTop + trackHeight}
                    stroke="var(--accent-blue)"
                    strokeWidth={selectedMarkerHandleWidth}
                    vectorEffect="non-scaling-stroke"
                    style={markerHandleTransitionStyle}
                  />
                  <line
                    x1={markerSelection.x + markerSelection.width}
                    x2={markerSelection.x + markerSelection.width}
                    y1={trackTop}
                    y2={trackTop + trackHeight}
                    stroke="var(--accent-blue)"
                    strokeWidth={selectedMarkerHandleWidth}
                    vectorEffect="non-scaling-stroke"
                    style={markerHandleTransitionStyle}
                  />
                </>
              ) : null}
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
              {useMarkerStyleForSelection ? (
                <>
                  <rect
                    x={displayedSelection.x}
                    y={trackTop}
                    width={displayedSelection.width}
                    height={trackHeight}
                    fill="rgba(132,108,195,.32)"
                    opacity={0.72}
                    pointerEvents="none"
                    style={markerTransitionStyle}
                  />
                  <line
                    x1={displayedSelection.x}
                    x2={displayedSelection.x}
                    y1={trackTop}
                    y2={trackTop + trackHeight}
                    stroke="var(--accent-blue)"
                    strokeWidth={selectedMarkerHandleWidth}
                    vectorEffect="non-scaling-stroke"
                    style={markerHandleTransitionStyle}
                  />
                  <line
                    x1={displayedSelection.x + displayedSelection.width}
                    x2={displayedSelection.x + displayedSelection.width}
                    y1={trackTop}
                    y2={trackTop + trackHeight}
                    stroke="var(--accent-blue)"
                    strokeWidth={selectedMarkerHandleWidth}
                    vectorEffect="non-scaling-stroke"
                    style={markerHandleTransitionStyle}
                  />
                </>
              ) : (
                <>
                  <rect x={displayedSelection.x} y={trackTop} width={displayedSelection.width} height={trackHeight} fill="var(--waveform-selection-fill)" opacity={displayedSelectionOverlayOpacity} pointerEvents="none" />
                  <clipPath id={clipId}>
                    <rect x={displayedSelection.x} y={trackTop} width={displayedSelection.width} height={trackHeight} />
                  </clipPath>
                  <path d={wavePath} clipPath={`url(#${clipId})`} fill="var(--waveform-selected-wave)" opacity={displayedSelectionWaveOpacity} pointerEvents="none" />
                </>
              )}
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
          {isPlaying && playheadX !== null ? (
            <g>
              <line x1={playheadX} x2={playheadX} y1={trackTop} y2={viewBoxHeight} stroke="rgba(0,0,0,.55)" strokeWidth="0.45" />
              <line x1={playheadX} x2={playheadX} y1={trackTop} y2={viewBoxHeight} stroke="var(--primary-text)" strokeWidth="0.16" />
            </g>
          ) : null}
          {!framedTrack && <rect x="0.1" y={trackTop + 0.1} width="99.8" height={trackHeight - 0.2} rx="1.6" fill="none" stroke="var(--panel-stroke)" strokeWidth="0.25" />}
          </svg>
          <WaveformBadgeLayer anchors={markerBadgeAnchors} />
        </div>
      ) : (
        <div className={cn("row-start-1 row-end-[-1] flex h-full min-h-[86px] items-center justify-center px-4 text-center text-sm text-[var(--secondary-text)]", framedTrack && "border-t border-b border-[var(--panel-stroke)]")}>
          {waveform.loading ? "파형을 읽는 중입니다." : waveform.data.error || emptyText}
        </div>
      )}
      {showRuler && rulerPosition === "bottom" && waveform.data.durationSeconds > 0 ? (
        <TimeRuler durationSeconds={waveform.data.durationSeconds} viewStart={safeViewStart} viewEnd={safeViewEnd} position="bottom" />
      ) : null}
    </div>
  );
}
