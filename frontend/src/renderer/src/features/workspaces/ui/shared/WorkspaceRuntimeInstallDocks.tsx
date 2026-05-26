import { Download } from "lucide-react";
import type { VoiceModelRuntimeStatus, WorkspaceRuntimeEnvironmentStatus } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { WorkspaceDockActionButton, WorkspaceDockIcon, WorkspaceDockLabel, WorkspaceDockMetaText, WorkspaceDockShell } from "./WorkspaceDockPrimitives";

export function shouldShowRuntimeEnvironmentInstallDock(status?: WorkspaceRuntimeEnvironmentStatus): status is WorkspaceRuntimeEnvironmentStatus {
  return Boolean(status && !status.ok && status.requirements.some((item) => !item.installed));
}

export function shouldShowVoiceModelInstallDock(status?: VoiceModelRuntimeStatus): status is VoiceModelRuntimeStatus {
  return Boolean(status && !status.ok);
}

function renderLabelWithMeta(text: string) {
  return text.split(/(\([^)]*\))/g).map((part, index) => (
    part.startsWith("(") && part.endsWith(")")
      ? <WorkspaceDockMetaText key={`${part}-${index}`}>{part}</WorkspaceDockMetaText>
      : <span key={`${part}-${index}`}>{part}</span>
  ));
}

export function WorkspaceRuntimeInstallDock({
  status,
  installing,
  onInstall,
  onDismiss,
  compact = false,
  embedded = false,
  className,
}: {
  status: WorkspaceRuntimeEnvironmentStatus;
  installing: boolean;
  onInstall: () => void;
  onDismiss: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  const missing = status.requirements.filter((item) => !item.installed);
  if (!shouldShowRuntimeEnvironmentInstallDock(status)) {
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
      <WorkspaceDockLabel>{embedded ? "런타임" : renderLabelWithMeta(label)}</WorkspaceDockLabel>
      {!installing ? (
        <WorkspaceDockActionButton
          onClick={onDismiss}
          variant="secondary"
        >
          다음에
        </WorkspaceDockActionButton>
      ) : null}
      <WorkspaceDockActionButton
        onClick={onInstall}
        disabled={installing}
      >
        {installing ? "..." : "다운로드"}
      </WorkspaceDockActionButton>
    </WorkspaceDockShell>
  );
}

export function WorkspaceVoiceModelInstallDock({
  status,
  installing,
  onInstall,
  onDismiss,
  compact = false,
  embedded = false,
  className,
}: {
  status: VoiceModelRuntimeStatus;
  installing: boolean;
  onInstall: () => void;
  onDismiss: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  if (!shouldShowVoiceModelInstallDock(status)) {
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
      <WorkspaceDockLabel>{embedded ? "모델" : renderLabelWithMeta(label)}</WorkspaceDockLabel>
      {!installing ? (
        <WorkspaceDockActionButton
          onClick={onDismiss}
          variant="secondary"
        >
          다음에
        </WorkspaceDockActionButton>
      ) : null}
      <WorkspaceDockActionButton
        onClick={onInstall}
        disabled={installing}
      >
        {installing ? "..." : "다운로드"}
      </WorkspaceDockActionButton>
    </WorkspaceDockShell>
  );
}
