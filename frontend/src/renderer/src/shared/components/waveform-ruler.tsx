import { cn } from "@/lib/utils";
import { formatTime } from "./waveform-geometry";

export function TimeRuler({ durationSeconds, viewStart, viewEnd }: { durationSeconds: number; viewStart: number; viewEnd: number }) {
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
