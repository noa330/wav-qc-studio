import type {
  VoiceModelRuntimeInstallResult,
  WorkspaceRunResult,
  WorkspaceRuntimeEnvironmentInstallResult,
  WorkspaceTerminalUpdate,
} from "@shared/ipc";
import { terminalStateFromUpdate, type WorkspaceTerminalStatus } from "../workspace-runtime-store";

const TERMINAL_TEXT_LIMIT = 60000;

export function createTerminalStartState(label: string) {
  return {
    text: `[${new Date().toLocaleTimeString()}] ${label}\n콘솔 출력을 기다리는 중입니다.`,
    status: "running" as const,
    updatedAt: new Date().toISOString(),
  };
}

export function createTerminalFromUpdate(update: WorkspaceTerminalUpdate, status: WorkspaceTerminalStatus) {
  return terminalStateFromUpdate(
    {
      ...update,
      text: limitTerminalText(update.text),
    },
    status,
  );
}

export function createTerminalFromResult(result: WorkspaceRunResult, status: WorkspaceTerminalStatus) {
  const metadata = result.metadata;
  const lines = [
    result.stdout,
    !result.stdout && result.stderr ? result.stderr : "",
    !result.stdout && !result.stderr && result.error ? result.error : "",
  ].filter(Boolean);
  const fallback = metadata
    ? [
        "실행 로그 파일이 준비되었습니다.",
        `Electron 로그: ${metadata.logPath}`,
        metadata.backendLogPath ? `백엔드 로그: ${metadata.backendLogPath}` : "",
      ].filter(Boolean).join("\n")
    : "아직 표시할 터미널 로그가 없습니다.";

  return {
    text: limitTerminalText(lines.join("\n") || fallback),
    status,
    logPath: metadata?.logPath,
    backendLogPath: metadata?.backendLogPath,
    command: metadata?.command,
    updatedAt: new Date().toISOString(),
  };
}

export function createTerminalFromEnvironmentInstallResult(result: WorkspaceRuntimeEnvironmentInstallResult) {
  const fallback = result.ok ? "환경 설치가 완료되었습니다." : result.error ?? "환경 설치에 실패했습니다.";
  return {
    text: limitTerminalText(result.stdout || result.stderr || fallback),
    status: result.ok ? "completed" as const : result.exitCode === 130 ? "cancelled" as const : "failed" as const,
    logPath: result.logPath,
    backendLogPath: result.logPath,
    command: result.command,
    updatedAt: new Date().toISOString(),
  };
}

export function createTerminalFromVoiceModelInstallResult(result: VoiceModelRuntimeInstallResult) {
  const fallback = result.ok ? "모델 설치가 완료되었습니다." : result.error ?? "모델 설치에 실패했습니다.";
  return {
    text: limitTerminalText(result.stdout || result.stderr || fallback),
    status: result.ok ? "completed" as const : result.exitCode === 130 ? "cancelled" as const : "failed" as const,
    logPath: result.logPath,
    backendLogPath: result.logPath,
    command: result.command,
    updatedAt: new Date().toISOString(),
  };
}

export function createTerminalFromLogPath(logPath: string | undefined) {
  if (!logPath) {
    return undefined;
  }

  return {
    text: `오디오 변환 로그 파일이 준비되었습니다.\n${logPath}`,
    status: "completed" as const,
    backendLogPath: logPath,
    updatedAt: new Date().toISOString(),
  };
}

export function limitTerminalText(text: string): string {
  if (text.length <= TERMINAL_TEXT_LIMIT) {
    return text;
  }

  return `... 이전 로그 생략 ...\n${text.slice(-TERMINAL_TEXT_LIMIT)}`;
}

export function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}

export function shortName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function formatSecondsCell(value: number): string {
  const minutes = Math.floor(Math.max(0, value) / 60);
  const seconds = Math.max(0, value) % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}
