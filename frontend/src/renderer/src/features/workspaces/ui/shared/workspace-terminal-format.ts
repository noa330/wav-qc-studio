import type { WorkspaceTerminalState } from "../../state/workspace-runtime-store";

export function splitTerminalLines(text: string): string[] {
  const lines = text.trimEnd().split(/\r\n|\n|\r/u).map((line) => line.trimEnd());
  const collapsed: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (line.trim()) {
      collapsed.push(line);
      blankCount = 0;
      continue;
    }

    blankCount += 1;
    if (blankCount <= 1) {
      collapsed.push("");
    }
  }

  return collapsed.filter((line, index, allLines) => line.trim() || index < allLines.length - 1);
}

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
