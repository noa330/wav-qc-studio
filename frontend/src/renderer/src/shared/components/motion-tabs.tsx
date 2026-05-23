import { motion } from "motion/react";
import type { MouseEventHandler } from "react";
import { cn } from "@/lib/utils";
import { softPressTap, tabUnderlineTransition } from "@/shared/motion";

export function MotionUnderlineTab({
  label,
  active,
  onClick,
  onContextMenu,
  disabled = false,
  className,
  underlineId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  underlineId?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "relative min-w-0 border-b-[3px] border-transparent text-sm font-normal transition-colors",
        active ? "text-[var(--primary-text)]" : "text-[var(--secondary-text)] hover:text-[var(--primary-text)]",
        disabled && "cursor-default opacity-70",
        className,
      )}
    >
      <span className="relative z-10 truncate">{label}</span>
      {active ? <motion.span layoutId={underlineId} transition={tabUnderlineTransition} className="absolute inset-x-0 bottom-[-3px] h-[3px] rounded-full bg-[var(--accent-blue)]" /> : null}
    </motion.button>
  );
}
