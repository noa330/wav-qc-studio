import { useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuMotion } from "@/shared/motion";
import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";
import { WorkspacePtyTerminal } from "./WorkspacePtyTerminal";
import { terminalStatusDotClass, terminalStatusLabel } from "./workspace-terminal-format";
import { WorkspaceDockActionButton, WorkspaceDockIcon, WorkspaceDockLabel, WorkspaceDockShell, WorkspaceDockStatus } from "./WorkspaceDockPrimitives";

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
              "absolute z-[1] w-[var(--terminal-dock-bubble-width,100%)] rounded-[5px] border border-[var(--terminal-dock-bubble-border)] bg-[var(--terminal-dock-bubble-bg)] px-3 py-3 pr-10 font-mono text-[13px] font-normal leading-5 text-[var(--secondary-text)] shadow-[var(--terminal-dock-bubble-shadow)] backdrop-blur",
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
              aria-label="콘솔 미리보기 닫기"
            >
              <X className="size-3.5" strokeWidth={1.8} />
            </button>
            <div className="h-[132px] overflow-hidden rounded-[4px] bg-transparent">
              {terminal.text.trim() ? (
                <WorkspacePtyTerminal text={terminal.text} className="h-full w-full px-2 py-2" fontSize={12} scrollback={800} />
              ) : (
                <div className="flex h-full items-center font-sans text-sm font-normal text-[var(--secondary-text)]">아직 표시할 콘솔 출력이 없습니다.</div>
              )}
            </div>
            {hideCaret ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[var(--terminal-dock-caret-left,50%)] size-3 -translate-x-1/2 rotate-45 border border-[var(--terminal-dock-bubble-border)] bg-[var(--terminal-dock-bubble-bg)]",
                  placement === "top" ? "bottom-[-7px] border-l-0 border-t-0" : "top-[-7px] border-b-0 border-r-0",
                )}
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <WorkspaceDockShell compact={compact} embedded={embedded} className={cn(compact && !embedded && "min-w-[148px]")}>
        {embedded ? null : (
          <>
            <WorkspaceDockIcon icon={Terminal} />
            <WorkspaceDockLabel>{title}</WorkspaceDockLabel>
          </>
        )}
        <WorkspaceDockStatus dotClassName={terminalStatusDotClass(terminal.status)}>
          {terminalStatusLabel(terminal.status)}
        </WorkspaceDockStatus>
        <WorkspaceDockActionButton
          onClick={onOpenFull}
          variant="ghost"
          aria-label="전체 콘솔 열기"
        >
          <ChevronRight className="size-4" strokeWidth={1.8} />
        </WorkspaceDockActionButton>
      </WorkspaceDockShell>
    </div>
  );
}
