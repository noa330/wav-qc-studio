import { cn } from "@/lib/utils";
import { formatTime } from "./workspace-ui-utils";

export function AudioProgressSlider({
  currentTime,
  duration,
  onSeek,
  disabled = false,
  accentClassName = "bg-[var(--accent-blue)]",
  railHeightClassName = "h-[3px]",
  className,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  accentClassName?: string;
  railHeightClassName?: string;
  className?: string;
}) {
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <span className="w-[55px] shrink-0 text-right font-sans text-xs text-[var(--secondary-text)]">
        {formatTime(currentTime)}
      </span>
      <div className="relative flex h-8 min-w-[80px] flex-1 items-center">
        <div className={cn("absolute left-0 right-0 rounded bg-[var(--slider-rail)]", railHeightClassName)} />
        <div
          className={cn("absolute rounded", railHeightClassName, accentClassName)}
          style={{ left: 0, width: `${progress * 100}%` }}
        />
        <input
          type="range"
          min="0"
          max={duration || 100}
          step="0.01"
          value={currentTime}
          onChange={(event) => onSeek(parseFloat(event.target.value))}
          disabled={disabled}
          className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
          aria-label="재생 위치 조절"
        />
        <div
          className={cn("pointer-events-none absolute z-10 -translate-x-1/2 wpf-slider-thumb", accentClassName)}
          style={{ left: `${progress * 100}%` }}
        />
      </div>
      <span className="w-[55px] shrink-0 text-left font-sans text-xs text-[var(--secondary-text)]">
        {formatTime(duration)}
      </span>
    </div>
  );
}
