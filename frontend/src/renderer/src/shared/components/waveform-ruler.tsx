import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatTime } from "./waveform-geometry";

const MAX_RULER_LABELS = 6;
const MIN_LABEL_GAP_PX = 12;
let rulerMeasureContext: CanvasRenderingContext2D | null | undefined;

type RulerDensity = {
  labelCount: number;
};

export function TimeRuler({ 
  durationSeconds, 
  viewStart, 
  viewEnd,
  position = "top",
  showTicks = true
}: { 
  durationSeconds: number; 
  viewStart: number; 
  viewEnd: number;
  position?: "top" | "bottom";
  showTicks?: boolean;
}) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [density, setDensity] = useState<RulerDensity>({ labelCount: MAX_RULER_LABELS });
  const { labelCount } = density;
  const isTop = position === "top";
  const visibleDurationSeconds = durationSeconds * Math.max(0, viewEnd - viewStart);

  useEffect(() => {
    const ruler = rulerRef.current;
    if (!ruler) {
      return;
    }

    const updateMajorCount = () => {
      const nextDensity = resolveRulerDensity(ruler, durationSeconds, viewStart, viewEnd);
      setDensity((current) => current.labelCount === nextDensity.labelCount ? current : nextDensity);
    };

    updateMajorCount();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateMajorCount) : undefined;
    observer?.observe(ruler);
    window.addEventListener("resize", updateMajorCount);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateMajorCount);
    };
  }, [durationSeconds, viewEnd, viewStart]);

  return (
    <div ref={rulerRef} className={cn("relative select-none overflow-hidden border-0 bg-transparent text-[12px] font-medium leading-none text-[var(--waveform-ruler-text)]", showTicks ? "h-6" : "h-[14px]")}>
      {showTicks && Array.from({ length: labelCount * 4 + 1 }).map((_, index) => {
        const isMajor = index % 4 === 2;
        return (
          <span 
            key={`tick-${index}`} 
            className={cn(
              "absolute w-px", 
              isTop ? "bottom-0" : "top-0",
              isMajor ? "h-[6px] bg-[var(--waveform-ruler-major)]" : "h-[4px] bg-[var(--waveform-ruler-minor)]"
            )} 
            style={{ left: `${(index / (labelCount * 4)) * 100}%` }}
          />
        );
      })}
      {Array.from({ length: labelCount }).map((_, index) => {
        const ratio = (index + 0.5) / labelCount;
        const x = `${ratio * 100}%`;
        const progress = viewStart + (viewEnd - viewStart) * ratio;
        return (
          <div key={`label-${index}`} className="absolute h-full" style={{ left: x, top: isTop || !showTicks ? 0 : "auto", bottom: isTop || !showTicks ? "auto" : 0 }}>
            <span className={cn("absolute left-1/2 -translate-x-1/2 whitespace-nowrap", isTop || !showTicks ? "top-0" : "bottom-0")}>
              {formatRulerTime(durationSeconds * progress, visibleDurationSeconds)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function resolveRulerDensity(ruler: HTMLDivElement, durationSeconds: number, viewStart: number, viewEnd: number): RulerDensity {
  const width = ruler.getBoundingClientRect().width;
  if (width <= 0) {
    return { labelCount: MAX_RULER_LABELS };
  }

  const visibleDurationSeconds = durationSeconds * Math.max(0, viewEnd - viewStart);
  for (let candidate = MAX_RULER_LABELS; candidate >= 1; candidate -= 1) {
    const slotWidth = width / candidate;
    const labelsFit = Array.from({ length: candidate }).every((_, index) => {
      const ratio = (index + 0.5) / candidate;
      const progress = viewStart + (viewEnd - viewStart) * ratio;
      const labelWidth = measureLabelWidth(ruler, formatRulerTime(durationSeconds * progress, visibleDurationSeconds));
      return labelWidth + MIN_LABEL_GAP_PX <= slotWidth;
    });
    if (labelsFit) {
      return { labelCount: candidate };
    }
  }

  return { labelCount: 1 };
}

function measureLabelWidth(ruler: HTMLDivElement, label: string): number {
  if (rulerMeasureContext === undefined) {
    rulerMeasureContext = document.createElement("canvas").getContext("2d");
  }
  const context = rulerMeasureContext;
  if (!context) {
    return label.length * 6.5;
  }

  const style = window.getComputedStyle(ruler);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(label).width;
}

function formatRulerTime(seconds: number, visibleDurationSeconds: number): string {
  if (visibleDurationSeconds >= 20) {
    return formatTime(seconds);
  }

  const precision = visibleDurationSeconds < 0.01 ? 5 : visibleDurationSeconds < 1 ? 3 : 2;
  const scale = 10 ** precision;
  const roundedSeconds = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * scale) / scale;
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const secs = Math.floor(roundedSeconds % 60);
  const fraction = (roundedSeconds - Math.floor(roundedSeconds)).toFixed(precision).slice(2);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${fraction}`;
}
