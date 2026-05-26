import { Download } from "lucide-react";
import type { VoiceModelRuntimeStatus, WorkspaceRuntimeEnvironmentStatus } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { WorkspaceDockActionButton, WorkspaceDockIcon, WorkspaceDockLabel, WorkspaceDockShell, WorkspaceDockStatus } from "./WorkspaceDockPrimitives";

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
    <WorkspaceDockShell
      compact={compact}
      embedded={embedded}
      className={cn(compact && "min-w-[176px]", className)}
      dataStatusWidgetInteractive="true"
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : <WorkspaceDockIcon icon={Download} />}
      <WorkspaceDockLabel>{embedded ? "런타임" : label}</WorkspaceDockLabel>
      <WorkspaceDockStatus dotClassName={installing ? "bg-[var(--accent-blue)]" : "bg-[#f7c34a]"}>
        {installing ? "설치 중" : "없음"}
      </WorkspaceDockStatus>
      <WorkspaceDockActionButton
        onClick={onInstall}
        disabled={installing}
      >
        {installing ? "..." : "설치"}
      </WorkspaceDockActionButton>
    </WorkspaceDockShell>
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
    <WorkspaceDockShell
      compact={compact}
      embedded={embedded}
      className={cn(compact && "min-w-[198px]", className)}
      dataStatusWidgetInteractive="true"
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : <WorkspaceDockIcon icon={Download} />}
      <WorkspaceDockLabel>{embedded ? "모델" : label}</WorkspaceDockLabel>
      <WorkspaceDockStatus dotClassName={installing ? "bg-[var(--accent-blue)]" : "bg-[#f7c34a]"}>
        {installing ? "설치 중" : "없음"}
      </WorkspaceDockStatus>
      <WorkspaceDockActionButton
        onClick={onInstall}
        disabled={installing}
      >
        {installing ? "..." : "설치"}
      </WorkspaceDockActionButton>
    </WorkspaceDockShell>
  );
}
