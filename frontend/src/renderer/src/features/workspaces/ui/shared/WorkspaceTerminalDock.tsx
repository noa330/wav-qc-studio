import { useState, type CSSProperties } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";
import { WorkspaceDockBubble } from "./WorkspaceDockBubble";
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
      <WorkspaceDockBubble
        open={bubbleOpen}
        placement={placement}
        minWidth={embedded ? 300 : undefined}
        onClick={pinBubble}
        onClose={closeBubble}
        hideCaret={hideCaret}
        closeLabel="콘솔 미리보기 닫기"
        bubbleKey="terminal-bubble"
        className="font-mono"
        bodyClassName="h-[132px] overflow-hidden rounded-[4px] bg-transparent"
      >
        {terminal.text.trim() ? (
          <WorkspacePtyTerminal text={terminal.text} className="h-full w-full pl-2 pr-0 py-2" fontSize={12} scrollback={800} />
        ) : (
          <div className="flex h-full items-center font-sans text-sm font-normal text-[var(--secondary-text)]">아직 표시할 콘솔 출력이 없습니다.</div>
        )}
      </WorkspaceDockBubble>

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
