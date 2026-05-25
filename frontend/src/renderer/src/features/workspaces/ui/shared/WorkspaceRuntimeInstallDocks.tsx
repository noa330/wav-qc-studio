import { Download } from "lucide-react";
import { motion } from "motion/react";
import type { VoiceModelRuntimeStatus, WorkspaceRuntimeEnvironmentStatus } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { softPressTap } from "@/shared/motion";

export function WorkspaceRuntimeInstallDock({
  status,
  installing,
  onInstall,
  compact = false,
  embedded = false,
  className,
}: {
  status: WorkspaceRuntimeEnvironmentStatus;
  installing: boolean;
  onInstall: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  const missing = status.requirements.filter((item) => !item.installed);
  if (status.ok || missing.length === 0) {
    return null;
  }

  const label = missing.map((item) => item.label).join(", ");
  return (
    <motion.div
      layout={embedded ? false : true}
      className={cn(
        "relative flex h-10 min-w-0 items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-3 text-sm font-normal text-[var(--primary-text)] shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur",
        compact && "h-7 min-w-[176px] px-2 shadow-none",
        embedded && "min-w-0 border-transparent bg-transparent px-0 shadow-none backdrop-blur-0",
        className,
      )}
      transition={embedded ? { duration: 0 } : undefined}
      data-status-widget-interactive="true"
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
          <Download className="size-3.5" strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{embedded ? "런타임" : label}</span>
      <span className={cn("size-2 shrink-0 rounded-full", installing ? "bg-[var(--accent-blue)]" : "bg-[#f7c34a]")} />
      <span className="shrink-0 text-[13px] font-normal leading-[18px] text-[var(--primary-text)]">{installing ? "설치 중" : "없음"}</span>
      <motion.button
        type="button"
        whileTap={installing ? undefined : softPressTap}
        onClick={onInstall}
        disabled={installing}
        className="ml-1 flex h-7 shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-[12px] font-normal text-white hover:brightness-110 disabled:opacity-55"
      >
        {installing ? "..." : "설치"}
      </motion.button>
    </motion.div>
  );
}

export function WorkspaceVoiceModelInstallDock({
  status,
  installing,
  onInstall,
  compact = false,
  embedded = false,
  className,
}: {
  status: VoiceModelRuntimeStatus;
  installing: boolean;
  onInstall: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  if (status.ok) {
    return null;
  }

  const label = `${status.label} 모델`;
  const title = status.error ? `${label}: ${status.error}` : `${label}: ${status.path}`;
  return (
    <motion.div
      layout={embedded ? false : true}
      className={cn(
        "relative flex h-10 min-w-0 items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[#0d131c]/95 px-3 text-sm font-normal text-[var(--primary-text)] shadow-[0_16px_36px_rgba(0,0,0,.28)] backdrop-blur",
        compact && "h-7 min-w-[198px] px-2 shadow-none",
        embedded && "min-w-0 border-transparent bg-transparent px-0 shadow-none backdrop-blur-0",
        className,
      )}
      transition={embedded ? { duration: 0 } : undefined}
      data-status-widget-interactive="true"
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-[var(--neutral-button-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
          <Download className="size-3.5" strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{embedded ? "모델" : label}</span>
      <span className={cn("size-2 shrink-0 rounded-full", installing ? "bg-[var(--accent-blue)]" : "bg-[#f7c34a]")} />
      <span className="shrink-0 text-[13px] font-normal leading-[18px] text-[var(--primary-text)]">{installing ? "설치 중" : "없음"}</span>
      <motion.button
        type="button"
        whileTap={installing ? undefined : softPressTap}
        onClick={onInstall}
        disabled={installing}
        className="ml-1 flex h-7 shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-[12px] font-normal text-white hover:brightness-110 disabled:opacity-55"
      >
        {installing ? "..." : "설치"}
      </motion.button>
    </motion.div>
  );
}
