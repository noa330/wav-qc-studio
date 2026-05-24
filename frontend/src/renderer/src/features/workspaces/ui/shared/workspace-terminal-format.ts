import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";

export function terminalStatusLabel(status: WorkspaceTerminalState["status"]): string {
  switch (status) {
    case "running":
      return "실행 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소됨";
    default:
      return "대기";
  }
}

export function terminalStatusDotClass(status: WorkspaceTerminalState["status"]): string {
  switch (status) {
    case "running":
      return "bg-[var(--accent-blue)]";
    case "completed":
      return "bg-[#34d399]";
    case "failed":
      return "bg-[#ff8c96]";
    case "cancelled":
      return "bg-[#fbbf24]";
    default:
      return "bg-[var(--slider-rail)]";
  }
}
