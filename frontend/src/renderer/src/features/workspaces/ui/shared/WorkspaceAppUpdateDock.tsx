import { Download, RefreshCw } from "lucide-react";
import type { AppUpdateState } from "@shared/ipc";
import { WorkspaceDockActionButton, WorkspaceDockIcon, WorkspaceDockLabel, WorkspaceDockMetaText, WorkspaceDockShell } from "./WorkspaceDockPrimitives";

function formatDownloadSize(bytes: number, unitBase: number): string {
  if (unitBase >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (unitBase >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (unitBase >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

function formatDownloadProgress(state: AppUpdateState): string {
  const total = state.total ?? 0;
  const transferred = Math.min(Math.max(0, state.transferred ?? 0), total || Number.POSITIVE_INFINITY);
  if (total > 0) {
    const unitBase = total;
    const totalText = formatDownloadSize(total, unitBase);
    const totalParts = totalText.split(" ");
    const unit = totalParts[totalParts.length - 1] ?? "";
    const transferredText = formatDownloadSize(transferred, unitBase).replace(` ${unit}`, "");
    return `${transferredText}/${totalText}`;
  }
  if (state.phase === "downloading" && transferred > 0) {
    return `${formatDownloadSize(transferred, transferred)}/?`;
  }
  return "";
}

export function shouldShowAppUpdateDock(state: AppUpdateState): boolean {
  return ["available", "downloading", "downloaded", "installing", "error"].includes(state.phase);
}

export function WorkspaceAppUpdateDock({
  state,
  onInstall,
  onDismiss,
  compact = false,
  embedded = false,
  className,
}: {
  state: AppUpdateState;
  onInstall: () => void;
  onDismiss: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  if (!shouldShowAppUpdateDock(state)) {
    return null;
  }

  const latestVersion = state.latestVersion ? `v${state.latestVersion}` : "";
  const downloadProgress = formatDownloadProgress(state);
  const labelBase = latestVersion ? `업데이트 ${latestVersion}` : "업데이트";
  const title = [
    `현재 버전: v${state.currentVersion}`,
    state.latestVersion ? `최신 버전: v${state.latestVersion}` : undefined,
    downloadProgress ? `다운로드: ${downloadProgress}` : undefined,
    state.error ? `오류: ${state.error}` : undefined,
  ].filter(Boolean).join("\n");
  const updateDisabled = state.phase !== "downloaded";

  return (
    <WorkspaceDockShell
      compact={compact}
      embedded={embedded}
      className={className}
      dataStatusWidgetInteractive="true"
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embedded ? null : <WorkspaceDockIcon icon={state.phase === "error" ? RefreshCw : Download} />}
      <WorkspaceDockLabel>
        <span>{embedded ? "업데이트" : labelBase}</span>
        {downloadProgress ? <WorkspaceDockMetaText className="ml-1">({downloadProgress})</WorkspaceDockMetaText> : null}
      </WorkspaceDockLabel>
      <WorkspaceDockActionButton
        onClick={onDismiss}
        variant="secondary"
        disabled={state.phase === "installing"}
      >
        다음에
      </WorkspaceDockActionButton>
      <WorkspaceDockActionButton onClick={onInstall} disabled={updateDisabled}>
        업데이트
      </WorkspaceDockActionButton>
    </WorkspaceDockShell>
  );
}
