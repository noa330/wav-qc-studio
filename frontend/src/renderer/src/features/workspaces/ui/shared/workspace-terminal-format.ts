import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";

export function splitTerminalLines(text: string): string[] {
  return text.trimEnd().split(/\r?\n/u).filter((line, index, lines) => line.trim() || index < lines.length - 1);
}

export function terminalStatusLabel(status: WorkspaceTerminalState["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Idle";
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

export function terminalLineToneClass(line: string): string {
  if (/\b(error|failed|traceback|exception)\b/iu.test(line)) {
    return "text-[#ff8c96]";
  }

  if (/\b(warn|warning|low confidence)\b/iu.test(line)) {
    return "text-[#fbbf24]";
  }

  if (/\b(progress|running|loading)\b/iu.test(line)) {
    return "text-[#b99cff]";
  }

  if (/\b(done|completed|success|finished)\b/iu.test(line)) {
    return "text-[#8ee6b0]";
  }

  return "text-[var(--secondary-text)]";
}
