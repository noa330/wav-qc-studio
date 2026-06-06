import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { fadeSlideUpMotion } from "@/shared/motion";
import { EmptyPanel } from "./workspace-panel-primitives";

/** Shared inline style for iOS-like liquid glass — bypasses Tailwind layer issues */
const glassStyle: CSSProperties = {
  background: "var(--glass-bg)",
  boxShadow: "var(--glass-shadow)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
};

export function WorkspaceAudioCardLayout({
  hasAudio,
  emptyText,
  waveform,
  controls,
  minimap,
  footer,
  className,
  waveformClassName,
  waveformMinHeightClassName = "min-h-[140px]",
  waveformSurfaceVariant = "default",
  controlsPlacement = "below",
  dataTourTarget = "audio-edit-pane",
  minimapTourTarget,
}: {
  hasAudio: boolean;
  emptyText: string;
  waveform: ReactNode;
  controls: ReactNode;
  minimap?: ReactNode;
  footer?: ReactNode;
  className?: string;
  waveformClassName?: string;
  waveformMinHeightClassName?: string;
  waveformSurfaceVariant?: "default" | "framed";
  controlsPlacement?: "below" | "waveformGlass";
  dataTourTarget?: string;
  minimapTourTarget?: string;
}) {
  const framedWaveformSurface = waveformSurfaceVariant === "framed";
  const controlsInWaveformGlass = controlsPlacement === "waveformGlass";
  const waveformGlassSpacing = controlsInWaveformGlass
    ? ({
        "--workspace-audio-glass-control-height": "48px",
        "--workspace-audio-glass-footer-gap": "16px",
      } as CSSProperties)
    : undefined;

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col justify-between", className)} style={waveformGlassSpacing}>
      <div
        className={cn(
          "relative flex-1",
          controlsInWaveformGlass ? "overflow-visible" : "overflow-hidden",
          waveformMinHeightClassName,
          framedWaveformSurface && "rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]",
        )}
        data-app-tour-target={dataTourTarget}
      >
        <AnimatePresence mode="wait" initial={false}>
          {hasAudio ? (
            <motion.div key="waveform" {...fadeSlideUpMotion} className={cn("relative h-full min-h-0", waveformClassName)}>
              {waveform}
              {minimap ? (
                <div
                  className="absolute bottom-[12px] left-1/2 z-20 flex h-[36px] w-[70%] min-w-[240px] max-w-[520px] -translate-x-1/2 items-center justify-center rounded-[10px] px-5 py-1.5"
                  style={glassStyle}
                  data-app-tour-target={minimapTourTarget}
                >
                  <div className="h-full w-full opacity-80">{minimap}</div>
                </div>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              {...fadeSlideUpMotion}
              className={cn(
                "h-full min-h-0 overflow-hidden",
                !framedWaveformSurface && "rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]",
              )}
            >
              <EmptyPanel text={emptyText} compact />
            </motion.div>
          )}
        </AnimatePresence>
        {controlsInWaveformGlass ? (
          <div
            className="absolute inset-x-3 bottom-0 z-30 flex min-h-[var(--workspace-audio-glass-control-height)] translate-y-1/2 items-center rounded-[12px] px-2.5 py-1.5"
            style={glassStyle}
          >
            {controls}
          </div>
        ) : null}
      </div>

      {hasAudio && !framedWaveformSurface ? <div className={cn(minimap ? "mt-[12px]" : "mt-[17px]", "mb-[12px] h-px w-full shrink-0 bg-[var(--panel-stroke)]")} /> : null}
      {!hasAudio && !framedWaveformSurface && !controlsInWaveformGlass ? <div className={cn(minimap ? "h-[13px]" : "h-[30px]", "w-full shrink-0")} /> : null}
      {controlsInWaveformGlass ? null : controls}
      {!controlsInWaveformGlass && framedWaveformSurface && footer ? <div className="my-[12px] h-px w-full shrink-0 bg-[var(--panel-stroke)]" /> : null}
      {controlsInWaveformGlass && footer ? (
        <div
          className="min-w-0 shrink-0"
          style={{
            marginTop: "calc(var(--workspace-audio-glass-control-height) / 2 + var(--workspace-audio-glass-footer-gap))",
          }}
        >
          {footer}
        </div>
      ) : footer}
    </div>
  );
}
