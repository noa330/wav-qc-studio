import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function WorkspaceSplitPane({
  children,
  className,
  tourTarget,
}: {
  children: ReactNode;
  className?: string;
  tourTarget?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col p-4", className)} data-app-tour-target={tourTarget}>
      {children}
    </div>
  );
}

export function WorkspaceSplitSectionLayout({
  left,
  right,
  centerAdornment,
  rootTourTarget,
  leftTourTarget,
  rightTourTarget,
}: {
  left: ReactNode;
  right: ReactNode;
  centerAdornment?: ReactNode;
  rootTourTarget?: string;
  leftTourTarget?: string;
  rightTourTarget?: string;
}) {
  return (
    <div className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]" data-app-tour-target={rootTourTarget}>
      <WorkspaceSplitPane tourTarget={leftTourTarget}>{left}</WorkspaceSplitPane>

      <div className="relative flex min-h-0 items-center justify-center">
        <div aria-hidden="true" className="absolute inset-y-4 inset-x-0 bg-[var(--panel-stroke)]" />
        {centerAdornment ? (
          <div className="absolute left-1/2 top-1/2 z-10 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--panel-stroke)] bg-[var(--panel-bg)] text-[var(--secondary-text)] shadow-[var(--compare-arrow-shadow)]">
            {centerAdornment}
          </div>
        ) : null}
      </div>

      <WorkspaceSplitPane tourTarget={rightTourTarget}>{right}</WorkspaceSplitPane>
    </div>
  );
}
