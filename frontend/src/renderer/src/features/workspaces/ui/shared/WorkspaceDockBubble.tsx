import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { menuMotion } from "@/shared/motion";

export type WorkspaceDockBubblePlacement = "top" | "bottom" | "left" | "right";

export function WorkspaceDockBubble({
  open,
  placement = "top",
  children,
  onClose,
  onClick,
  className,
  bodyClassName,
  style,
  minWidth,
  hideCaret = false,
  closeLabel,
  bubbleKey = "workspace-dock-bubble",
}: {
  open: boolean;
  placement?: WorkspaceDockBubblePlacement;
  children: ReactNode;
  onClose: () => void;
  onClick?: () => void;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
  minWidth?: number;
  hideCaret?: boolean;
  closeLabel: string;
  bubbleKey?: string;
}) {
  const motionProps = placement === "left" || placement === "right"
    ? {
        initial: { opacity: 0, x: placement === "left" ? 4 : -4, y: "-50%", scale: 0.985 },
        animate: { opacity: 1, x: 0, y: "-50%", scale: 1 },
        exit: { opacity: 0, x: placement === "left" ? 4 : -4, y: "-50%", scale: 0.985 },
        transition: menuMotion.transition,
      }
    : menuMotion;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key={bubbleKey}
          {...motionProps}
          className={cn(
            "absolute z-[1] w-[var(--terminal-dock-bubble-width,100%)] rounded-[5px] border border-[var(--terminal-dock-bubble-border)] bg-[var(--terminal-dock-bubble-bg)] pl-3 py-3 pr-[38px] text-[13px] font-normal leading-5 text-[var(--secondary-text)] shadow-[var(--terminal-dock-bubble-shadow)] backdrop-blur",
            placement === "top" && "bottom-[calc(100%+var(--terminal-dock-bubble-gap,10px))] right-[calc(var(--terminal-dock-bubble-right-offset,0px)*-1)]",
            placement === "bottom" && "top-[calc(100%+var(--terminal-dock-bubble-gap,10px))] right-[calc(var(--terminal-dock-bubble-right-offset,0px)*-1)]",
            placement === "left" && "right-[calc(100%+var(--terminal-dock-bubble-gap,10px))] top-1/2",
            placement === "right" && "left-[calc(100%+var(--terminal-dock-bubble-gap,10px))] top-1/2",
            className,
          )}
          style={{ minWidth, ...style }}
          onClick={onClick}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-[4px] text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)] hover:text-[var(--primary-text)]"
            aria-label={closeLabel}
          >
            <X className="size-3.5" strokeWidth={1.8} />
          </button>
          <div className={bodyClassName}>{children}</div>
          {hideCaret ? null : (
            <span
              aria-hidden="true"
              className={cn(
                "absolute size-3 rotate-45 border border-[var(--terminal-dock-bubble-border)] bg-[var(--terminal-dock-bubble-bg)]",
                placement === "top" && "left-[var(--terminal-dock-caret-left,50%)] bottom-[-7px] -translate-x-1/2 border-l-0 border-t-0",
                placement === "bottom" && "left-[var(--terminal-dock-caret-left,50%)] top-[-7px] -translate-x-1/2 border-b-0 border-r-0",
                placement === "left" && "right-[-7px] top-[var(--terminal-dock-caret-top,50%)] -translate-y-1/2 border-b-0 border-l-0",
                placement === "right" && "left-[-7px] top-[var(--terminal-dock-caret-top,50%)] -translate-y-1/2 border-r-0 border-t-0",
              )}
            />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
