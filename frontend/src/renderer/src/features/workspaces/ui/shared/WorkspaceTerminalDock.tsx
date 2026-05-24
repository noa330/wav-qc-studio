import { useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuMotion, softPressTap } from "@/shared/motion";
import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";
import { splitTerminalLines, terminalLineToneClass, terminalStatusDotClass, terminalStatusLabel } from "./workspace-terminal-format";

type WorkspaceTerminalDockProps = {
  terminal: WorkspaceTerminalState;
  title: string;
  bubblePinned: boolean;
  onBubblePinnedChange: (pinned: boolean) => void;
  onOpenFull: () => void;
  placement?: "top" | "bottom";
  compact?: boolean;
  embedded?: boolean;
  hideCaret?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function WorkspaceTerminalDock({
  terminal,
  title,
  bubblePinned,
  onBubblePinnedChange,
  onOpenFull,
  placement = "top",
  compact = false,
  embedded = false,
  hideCaret = false,
  className,
  style,
}: WorkspaceTerminalDockProps) {
  const [hovering, setHovering] = useState(false);
  const lines = useMemo(() => splitTerminalLines(terminal.text).slice(-5), [terminal.text]);
  const bubbleOpen = bubblePinned || hovering;

  const closeBubble = () => {
    setHovering(false);
    onBubblePinnedChange(false);
  };

  const pinBubble = () => {
    if (!bubblePinned) {
      onBubblePinnedChange(true);
    }
  };

  return (
    <div
      className={cn("relative", embedded ? "w-auto" : "w-[360px]", className)}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => {
        setHovering(true);
        if (!bubblePinned) {
          onBubblePinnedChange(true);
        }
      }}
      onPointerLeave={() => setHovering(false)}
      data-app-tour-target="workspace-terminal-widget"
    >
      <AnimatePresence>
        {bubbleOpen ? (
          <motion.div
            key="terminal-bubble"
            {...menuMotion}
            className={cn(
              "absolute z-[1] w-[var(--terminal-dock-bubble-width,100%)] rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-3 py-3 pr-10 font-mono text-[13px] font-normal leading-5 text-[var(--secondary-text)] shadow-[0_16px_36px_rgba(0,0,0,.42)] backdrop-blur",
              placement === "top" ? "bottom-[calc(100%+var(--terminal-dock-bubble-gap,10px))]" : "top-[calc(100%+var(--terminal-dock-bubble-gap,10px))]",
              "right-[calc(var(--terminal-dock-bubble-right-offset,0px)*-1)]",
            )}
            style={{ minWidth: embedded ? 300 : undefined }}
            onClick={pinBubble}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeBubble();
              }}
              className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-[4px] text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)] hover:text-[var(--primary-text)]"
              aria-label="터미널 말풍선 닫기"
            >
              <X className="size-3.5" strokeWidth={1.8} />
            </button>
            <div className="max-h-[132px] overflow-hidden">
              {lines.length > 0 ? (
                lines.map((line, index) => (
                  <div key={`${index}-${line}`} className={cn("min-h-5 truncate whitespace-pre", terminalLineToneClass(line))}>
                    {line || " "}
                  </div>
                ))
              ) : (
                <div className="font-sans text-sm font-normal text-[var(--secondary-text)]">표시할 터미널 로그가 없습니다.</div>
              )}
            </div>
            {hideCaret ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[var(--terminal-dock-caret-left,50%)] size-3 -translate-x-1/2 rotate-45 border border-[var(--panel-stroke)] bg-[#0d131c]",
                  placement === "top" ? "bottom-[-7px] border-l-0 border-t-0" : "top-[-7px] border-b-0 border-r-0",
                )}
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        layout={embedded ? false : true}
        className={cn(
          "relative flex h-10 min-w-0 items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-3 text-sm font-normal text-[var(--primary-text)] shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur",
          compact && "h-7 min-w-[148px] px-2 shadow-none",
          embedded && "min-w-0 border-transparent bg-transparent px-0 shadow-none backdrop-blur-0",
        )}
        transition={embedded ? { duration: 0 } : undefined}
      >
        {embedded ? null : (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
              <Terminal className="size-3.5" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </>
        )}
        <span className={cn("size-2 shrink-0 rounded-full", terminalStatusDotClass(terminal.status))} />
        <span className="shrink-0 text-[13px] font-normal leading-[18px] text-[var(--primary-text)]">{terminalStatusLabel(terminal.status)}</span>
        <motion.button
          type="button"
          whileTap={softPressTap}
          onClick={onOpenFull}
          className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)] hover:text-[var(--primary-text)]"
          aria-label="전체 터미널 열기"
        >
          <ChevronRight className="size-4" strokeWidth={1.8} />
        </motion.button>
      </motion.div>
    </div>
  );
}
