import type { SelectionHandleStyle, ViewportSelection } from "./waveform-types";

export type WaveformBadgeAnchor = {
  id: string;
  x: number;
};

const markerBadgeWidthPx = 16;
const markerBadgeHeightPx = 22;

export function SelectionHandles({
  selection,
  trackTop,
  trackHeight,
  style,
}: {
  selection: ViewportSelection;
  trackTop: number;
  trackHeight: number;
  style: SelectionHandleStyle;
}) {
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

export function WaveformBadgeLayer({ anchors }: { anchors: WaveformBadgeAnchor[] }) {
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

function MarkerBadgeHandle({ x, trackTop, trackHeight, side }: { x: number; trackTop: number; trackHeight: number; side: "left" | "right" }) {
  const hitWidth = 3.2;
  return (
    <g className="cursor-ew-resize" data-selection-handle={side}>
      <rect x={x - hitWidth / 2} y={trackTop} width={hitWidth} height={trackHeight} fill="transparent" />
      <line x1={x} x2={x} y1={trackTop} y2={trackTop + trackHeight} stroke="var(--accent-blue)" strokeWidth="1.35" vectorEffect="non-scaling-stroke" />
    </g>
  );
}
