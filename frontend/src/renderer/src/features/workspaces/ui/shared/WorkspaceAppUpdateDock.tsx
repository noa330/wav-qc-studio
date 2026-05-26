import { Download, RefreshCw } from "lucide-react";
import type { AppUpdateState } from "@shared/ipc";
import { WorkspaceDockActionButton, WorkspaceDockIcon, WorkspaceDockLabel, WorkspaceDockShell, WorkspaceDockStatus } from "./WorkspaceDockPrimitives";

function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "";
  }

  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${Math.round(bytesPerSecond / 1024)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}

export function shouldShowAppUpdateDock(state: AppUpdateState): boolean {
  return ["checking", "available", "downloading", "downloaded", "installing", "error"].includes(state.phase);
}

export function WorkspaceAppUpdateDock({
  state,
  onCheck,
  onInstall,
  compact = false,
  embedded = false,
  className,
}: {
  state: AppUpdateState;
  onCheck: () => void;
  onInstall: () => void;
  compact?: boolean;
  embedded?: boolean;
  className?: string;
}) {
  if (!shouldShowAppUpdateDock(state)) {
    return null;
  }

  const latestVersion = state.latestVersion ? `v${state.latestVersion}` : "";
  const label = latestVersion ? `업데이트 ${latestVersion}` : "업데이트";
  const speed = formatSpeed(state.bytesPerSecond);
  const title = [
    `현재 버전: v${state.currentVersion}`,
    state.latestVersion ? `최신 버전: v${state.latestVersion}` : undefined,
    state.error ? `오류: ${state.error}` : undefined,
  ].filter(Boolean).join("\n");

  let status = "확인 중";
  let dotClassName = "bg-[var(--accent-blue)]";
  let buttonLabel = "확인";
  let buttonDisabled = false;
  let buttonAction = onCheck;

  if (state.phase === "available") {
    status = "준비 중";
    dotClassName = "bg-[#f7c34a]";
    buttonLabel = "...";
    buttonDisabled = true;
  } else if (state.phase === "downloading") {
    status = `${Math.round(state.percent ?? 0)}%${speed ? ` ${speed}` : ""}`;
    dotClassName = "bg-[var(--accent-blue)]";
    buttonLabel = "...";
    buttonDisabled = true;
  } else if (state.phase === "downloaded") {
    status = "설치 가능";
    dotClassName = "bg-[#58d68d]";
    buttonLabel = "설치";
    buttonAction = onInstall;
  } else if (state.phase === "installing") {
    status = "재시작 중";
    dotClassName = "bg-[var(--accent-blue)]";
    buttonLabel = "...";
    buttonDisabled = true;
  } else if (state.phase === "error") {
    status = "오류";
    dotClassName = "bg-[#ff6b7a]";
    buttonLabel = "재시도";
  }

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
      <WorkspaceDockLabel>{embedded ? "업데이트" : label}</WorkspaceDockLabel>
      <WorkspaceDockStatus dotClassName={dotClassName}>{status}</WorkspaceDockStatus>
      <WorkspaceDockActionButton onClick={buttonAction} disabled={buttonDisabled}>
        {buttonLabel}
      </WorkspaceDockActionButton>
    </WorkspaceDockShell>
  );
}
