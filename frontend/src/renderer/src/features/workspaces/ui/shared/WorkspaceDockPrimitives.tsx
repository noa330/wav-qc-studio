import { motion } from "motion/react";
import type { ComponentType, PointerEventHandler, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { softPressTap } from "@/shared/motion";

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

export function WorkspaceDockShell({
  children,
  compact = false,
  embedded = false,
  className,
  title,
  onPointerDown,
  dataStatusWidgetInteractive,
}: {
  children: ReactNode;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
  title?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  dataStatusWidgetInteractive?: string;
}) {
  return (
    <motion.div
      layout={embedded ? false : true}
      className={cn(
        "relative flex h-10 min-w-0 items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]/95 px-3 text-sm font-normal text-[var(--primary-text)] shadow-[var(--workspace-dock-shadow)] backdrop-blur",
        compact && "h-7 px-2 shadow-none",
        embedded && "min-w-0 border-transparent bg-transparent px-0 shadow-none backdrop-blur-0",
        className,
      )}
      transition={embedded ? { duration: 0 } : undefined}
      data-status-widget-interactive={dataStatusWidgetInteractive}
      title={title}
      onPointerDown={onPointerDown}
    >
      {children}
    </motion.div>
  );
}

export function WorkspaceDockIcon({ icon: Icon }: { icon: IconType }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
      <Icon className="size-3.5" strokeWidth={1.8} />
    </span>
  );
}

export function WorkspaceDockLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("min-w-0 flex-1 truncate", className)}>{children}</span>;
}

export function WorkspaceDockMetaText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap text-[12px] font-normal tabular-nums text-[var(--secondary-text)]", className)}>
      {children}
    </span>
  );
}

export function WorkspaceDockStatus({
  dotClassName,
  children,
}: {
  dotClassName: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className={cn("size-2 shrink-0 rounded-full", dotClassName)} />
      <span className="shrink-0 text-[13px] font-normal leading-[18px] text-[var(--primary-text)]">{children}</span>
    </>
  );
}

export function WorkspaceDockActionButton({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  ariaLabel,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : softPressTap}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "ml-1 flex h-7 shrink-0 items-center justify-center rounded-[4px] text-[12px] font-normal disabled:opacity-55",
        variant === "primary"
          ? "bg-[var(--accent-blue)] px-2.5 text-white hover:brightness-110"
          : variant === "secondary"
            ? "wpf-button !h-7 px-2.5 text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]"
            : "size-7 text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)] hover:text-[var(--primary-text)]",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
