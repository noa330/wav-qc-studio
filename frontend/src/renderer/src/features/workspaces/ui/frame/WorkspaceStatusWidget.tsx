import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "motion/react";
import { menuMotion, progressSpring, softPressTap } from "@/shared/motion";
import type { WorkspaceRuntimeState, WorkspaceTerminalState } from "../../state/workspace-runtime-store";
import { ProjectSelector } from "../shared/WorkspaceProjectSelector";
import { WorkspaceTerminalDock } from "../shared/WorkspaceTerminalDock";


export function useCompactWorkspaceHeader(): boolean {
  const [compact, setCompact] = useState(() => (typeof window === "undefined" ? false : window.innerHeight < 860));

  useEffect(() => {
    const update = () => setCompact(window.innerHeight < 860);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return compact;
}

type WorkspaceHeaderStatusItem = {
  label: string;
  value: string;
};

export function createWorkspaceHeaderStatusItems(state: WorkspaceRuntimeState): WorkspaceHeaderStatusItem[] {
  const completedRows = state.table.rows.length;
  const progress = state.progress ?? state.lastRun?.progress;
  const finishedByProgress = (progress?.completed ?? completedRows) + (progress?.failed ?? 0);
  const hasPendingWork = progress && progress.total > 0 ? finishedByProgress < progress.total : true;
  const processing = state.isRunning || state.isBatchSpeakerRunning
    ? hasPendingWork ? 1 : 0
    : 0;

  return [
    { label: "처리중", value: `${processing}` },
    { label: "완료", value: `${completedRows}` },
  ];
}

export function WorkspaceStatusWidget({
  statusItems,
  progressPercent,
  projectSelectorDisabled,
  terminal,
  terminalTitle,
  terminalBubblePinned,
  onTerminalBubblePinnedChange,
  onOpenFullTerminal,
}: {
  statusItems: WorkspaceHeaderStatusItem[];
  progressPercent: number;
  projectSelectorDisabled: boolean;
  terminal: WorkspaceTerminalState;
  terminalTitle: string;
  terminalBubblePinned: boolean;
  onTerminalBubblePinnedChange: (pinned: boolean) => void;
  onOpenFullTerminal: () => void;
}) {
  const [position, setPosition] = useState({ right: 20, top: 20 });
  const [terminalBubbleGeometry, setTerminalBubbleGeometry] = useState({ width: 360, rightOffset: 0, caretLeft: 180 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startRight: number; startTop: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const terminalSlotRef = useRef<HTMLSpanElement | null>(null);
  const borderProgress = Math.max(0, Math.min(100, progressPercent));
  const progressRatio = borderProgress / 100;
  const edgeProgress = {
    top: Math.min(1, progressRatio / 0.38),
    right: Math.min(1, Math.max(0, progressRatio - 0.38) / 0.12),
    bottom: Math.min(1, Math.max(0, progressRatio - 0.5) / 0.38),
    left: Math.min(1, Math.max(0, progressRatio - 0.88) / 0.12),
  };
  const items = statusItems;

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement | null)?.closest("[data-status-widget-interactive='true']")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: position.right,
      startTop: position.top,
    };
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    const nextRight = Math.max(8, Math.min(window.innerWidth - 160, current.startRight - (event.clientX - current.startX)));
    const nextTop = Math.max(8, Math.min(window.innerHeight - 48, current.startTop + event.clientY - current.startY));
    setPosition({ right: nextRight, top: nextTop });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  useEffect(() => {
    const bar = barRef.current;
    const slot = terminalSlotRef.current;
    if (!bar || !slot) {
      return;
    }

    const update = () => {
      const barRect = bar.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      const bubbleWidth = Math.max(300, Math.min(barRect.width / 2, barRect.width));
      const rightOffset = Math.max(0, barRect.right - slotRect.right);
      const slotCenterFromBubbleLeft = bubbleWidth - rightOffset - slotRect.width / 2;
      setTerminalBubbleGeometry({
        width: bubbleWidth,
        rightOffset,
        caretLeft: Math.max(16, Math.min(bubbleWidth - 16, slotCenterFromBubbleLeft)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    observer.observe(slot);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [position.right, position.top]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={menuMotion.transition}
      className="fixed z-[2100]"
      style={{ right: position.right, top: position.top }}
      data-app-tour-target="compact-status"
    >
      <motion.div
        ref={barRef}
        role="button"
        tabIndex={0}
        aria-label="상태 위젯"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        whileTap={softPressTap}
        className="relative flex h-10 max-w-[min(860px,calc(100vw-40px))] cursor-move select-none items-center overflow-visible rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-2 shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[5px]">
          <motion.span className="absolute left-0 top-0 h-[2px] w-full origin-left bg-[var(--accent-blue)]" initial={false} animate={{ scaleX: edgeProgress.top }} transition={progressSpring} />
          <motion.span className="absolute right-0 top-0 h-full w-[2px] origin-top bg-[var(--accent-blue)]" initial={false} animate={{ scaleY: edgeProgress.right }} transition={progressSpring} />
          <motion.span className="absolute bottom-0 right-0 h-[2px] w-full origin-right bg-[var(--accent-blue)]" initial={false} animate={{ scaleX: edgeProgress.bottom }} transition={progressSpring} />
          <motion.span className="absolute bottom-0 left-0 h-full w-[2px] origin-bottom bg-[var(--accent-blue)]" initial={false} animate={{ scaleY: edgeProgress.left }} transition={progressSpring} />
        </div>
        <div className="relative z-10 flex min-w-0 items-center">
          <ProjectSelector disabled={projectSelectorDisabled} compact />
          <span className="mx-2 h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
          {items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex shrink-0 items-center gap-1.5 px-1.5">
              {index > 0 ? <span className="mr-1 h-4 w-px bg-[var(--panel-stroke)]" /> : null}
              <span className="whitespace-nowrap text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">{item.label}</span>
              <span className="max-w-16 truncate text-[13px] font-normal tabular-nums text-[var(--primary-text)]">{item.value}</span>
            </div>
          ))}
          <span className="mx-2 h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
          <span ref={terminalSlotRef} className="relative shrink-0" data-status-widget-interactive="true" onPointerDown={(event) => event.stopPropagation()}>
            <WorkspaceTerminalDock
              terminal={terminal}
              title={terminalTitle}
              bubblePinned={terminalBubblePinned}
              onBubblePinnedChange={onTerminalBubblePinnedChange}
              onOpenFull={onOpenFullTerminal}
              placement="bottom"
              compact
              embedded
              style={{
                "--terminal-dock-bubble-width": `${terminalBubbleGeometry.width}px`,
                "--terminal-dock-bubble-right-offset": `${terminalBubbleGeometry.rightOffset}px`,
                "--terminal-dock-caret-left": `${terminalBubbleGeometry.caretLeft}px`,
                "--terminal-dock-bubble-gap": "18px",
              } as CSSProperties}
            />
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
