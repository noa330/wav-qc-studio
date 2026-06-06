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
      <div className="absolute inset-0 pointer-events-none z-10">
        <MarkerBadgeHandle x={selection.x} side="left" />
        <MarkerBadgeHandle x={selection.x + selection.width} side="right" />
      </div>
    );
  }

  if (style === "dumbbell") {
    return (
      <div className="absolute inset-0 pointer-events-none z-10">
        <DumbbellHandle x={selection.x} side="left" />
        <DumbbellHandle x={selection.x + selection.width} side="right" />
      </div>
    );
  }

  if (style === "trimHandles") {
    return (
      <div className="absolute inset-0 pointer-events-none z-10">
        <TrimRangeHandle x={selection.x} side="left" />
        <TrimRangeHandle x={selection.x + selection.width} side="right" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <div className="absolute top-0 bottom-0 w-[2px] bg-[var(--accent-blue)]" style={{ left: `${selection.x}%`, transform: 'translateX(-50%)' }} />
      <div className="absolute top-0 bottom-0 w-[2px] bg-[var(--accent-blue)]" style={{ left: `${selection.x + selection.width}%`, transform: 'translateX(-50%)' }} />
    </div>
  );
}

export function WaveformBadgeLayer({ anchors }: { anchors: WaveformBadgeAnchor[] }) {
  if (anchors.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      {anchors.map((anchor) => (
        <svg
          key={anchor.id}
          className="absolute top-px overflow-visible"
          style={{
            left: `${anchor.x}%`,
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
          <path d="M 5 8 L 7.3 10.4 L 11.4 5.9" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </div>
  );
}

function TrimRangeHandle({ x, side }: { x: number; side: "left" | "right" }) {
  const hitWidthPx = 16;
  const isLeft = side === "left";
  return (
    <div 
      className="absolute top-0 bottom-0 cursor-ew-resize pointer-events-auto" 
      data-selection-handle={side}
      style={{ 
        left: `${x}%`, 
        width: `${hitWidthPx}px`, 
        transform: isLeft ? 'translateX(-50%)' : 'translateX(-50%)' 
      }}
    >
      <div 
        className="absolute top-0 bottom-0 bg-[var(--primary-text)] opacity-96 rounded-[1px]" 
        style={{ 
          width: '4px', 
          left: isLeft ? '50%' : 'calc(50% - 4px)',
          transform: isLeft ? 'none' : 'none'
        }} 
      />
    </div>
  );
}

function MarkerBadgeHandle({ x, side }: { x: number; side: "left" | "right" }) {
  const hitWidthPx = 16;
  return (
    <div 
      className="absolute top-0 bottom-0 cursor-ew-resize pointer-events-auto flex justify-center" 
      data-selection-handle={side}
      style={{ left: `${x}%`, width: `${hitWidthPx}px`, transform: 'translateX(-50%)' }}
    >
      <div className="w-[2px] h-full bg-[var(--accent-blue)]" />
    </div>
  );
}

function DumbbellHandle({ x, side }: { x: number; side: "left" | "right" }) {
  const hitWidthPx = 16;
  return (
    <div 
      className="absolute top-0 bottom-0 cursor-ew-resize pointer-events-auto flex flex-col justify-between items-center" 
      data-selection-handle={side}
      style={{ left: `${x}%`, width: `${hitWidthPx}px`, transform: 'translateX(-50%)' }}
    >
      {/* Top circle shifted slightly down to prevent clipping */}
      <div className="w-[7px] h-[7px] rounded-full bg-[var(--accent-blue)] mt-[1px]" />
      
      {/* Line connecting the circles */}
      <div className="absolute top-[4px] bottom-[4px] w-[1.5px] bg-[var(--accent-blue)] -z-10" />
      
      {/* Bottom circle shifted slightly up to prevent clipping */}
      <div className="w-[7px] h-[7px] rounded-full bg-[var(--accent-blue)] mb-[1px]" />
    </div>
  );
}
