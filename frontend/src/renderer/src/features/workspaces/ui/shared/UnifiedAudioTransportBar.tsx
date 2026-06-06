import { Play as PlayIcon, Pause as PauseIcon, Rewind, FastForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "./workspace-ui-utils";
import type { AudioTransport } from "@/shared/hooks/use-audio-transport";
import { AudioProgressSlider } from "./AudioProgressSlider";

export interface UnifiedAudioTransportBarProps {
  transport: AudioTransport;
  disabled?: boolean;
  themeColor?: "purple" | "green" | "blue";
  framed?: boolean;
  className?: string;
  onPlayPause?: () => void;
}

export function UnifiedAudioTransportBar({
  transport,
  disabled = false,
  themeColor = "blue",
  framed = true,
  className,
  onPlayPause,
}: UnifiedAudioTransportBarProps) {
  const isPlayDisabled = disabled || !transport.canPlay;

  const handlePlayPause = () => {
    if (onPlayPause) {
      onPlayPause();
    } else {
      transport.toggle();
    }
  };

  const getThemeClass = (type: "bg" | "text" | "hoverText") => {
    switch (themeColor) {
      case "purple":
        return type === "bg" ? "bg-[var(--primary)]" : type === "text" ? "text-[var(--primary)]" : "hover:text-[var(--primary)]";
      case "green":
        return type === "bg" ? "bg-[#09ad3c]" : type === "text" ? "text-[#09ad3c]" : "hover:text-[#09ad3c]";
      case "blue":
      default:
        return type === "bg" ? "bg-[var(--accent-blue)]" : type === "text" ? "text-[var(--accent-blue)]" : "hover:text-[var(--accent-blue)]";
    }
  };

  return (
    <div className={cn(
      "w-full min-w-0 flex items-center justify-between gap-2 select-none shrink-0 @container",
      framed ? "overflow-hidden bg-[var(--card-bg)] border border-[var(--panel-stroke)] rounded-[5px] px-3 py-2.5" : "p-0",
      disabled && "opacity-55",
      className
    )} data-app-tour-target="audio-transport-controls">
      {/* Skip/Play Buttons */}
      <div className="flex items-center gap-1 justify-start shrink-0">
        <button 
          type="button"
          onClick={() => transport.skip(-5)}
          disabled={isPlayDisabled}
          className={cn(
            "hidden @[300px]:flex items-center justify-center size-8 text-[var(--secondary-text)] transition-colors focus:outline-none disabled:opacity-35",
            getThemeClass("hoverText")
          )}
          title="5초 뒤로"
        >
          <Rewind className="size-4" fill="currentColor" />
        </button>

        <button
          type="button"
          onClick={handlePlayPause}
          disabled={isPlayDisabled}
          className={cn(
            "flex items-center justify-center size-9 rounded-full text-white hover:opacity-90 transition-opacity focus:outline-none shrink-0",
            getThemeClass("bg")
          )}
        >
          {transport.isPlaying ? (
            <PauseIcon className="size-4 fill-white" />
          ) : (
            <PlayIcon className="size-4 fill-white ml-0.5" />
          )}
        </button>

        <button 
          type="button"
          onClick={() => transport.skip(5)}
          disabled={isPlayDisabled}
          className={cn(
            "hidden @[300px]:flex items-center justify-center size-8 text-[var(--secondary-text)] transition-colors focus:outline-none disabled:opacity-35",
            getThemeClass("hoverText")
          )}
          title="5초 앞으로"
        >
          <FastForward className="size-4" fill="currentColor" />
        </button>
      </div>

      {/* Time and Slider (Wide Mode) */}
      <AudioProgressSlider
        currentTime={transport.currentTime}
        duration={transport.duration}
        onSeek={transport.seek}
        disabled={isPlayDisabled}
        accentClassName={getThemeClass("bg")}
        className="hidden @[360px]:flex"
      />

      {/* Combined Time (Ultra-Narrow Mode) */}
      <div className="flex @[360px]:hidden flex-1 items-center justify-end min-w-0">
        <span className="shrink-0 text-xs text-[var(--secondary-text)] whitespace-nowrap">
          {formatTime(transport.currentTime)} / {formatTime(transport.duration)}
        </span>
      </div>
    </div>
  );
}
