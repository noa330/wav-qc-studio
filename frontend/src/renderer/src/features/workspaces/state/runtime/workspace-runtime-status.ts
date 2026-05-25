import type { DataTable, WorkspaceId, WorkspaceRunResult, WorkspaceSettings } from "@shared/ipc";
import { shortName } from "./terminal-state";
import { trainingStatusText } from "./training-tables";
import type { WorkspaceRuntimeState } from "../workspace-runtime-store";

export function buildMetrics(workspaceId: WorkspaceId, state: WorkspaceRuntimeState, settings: WorkspaceSettings, displayTable?: DataTable): string[] {
  const totalRows = state.table.rows.length;
  const completed = state.table.rows.filter((row) => Object.values(row.cells).some((value) => value === "완료")).length;
  const failed = state.table.rows.filter((row) => Object.values(row.cells).some((value) => value === "실패")).length;

  if (workspaceId === "overview") {
    const enabledModules = [settings.overview.analyzeNoise].filter(Boolean).length;
    return [state.inputPath ? shortName(state.inputPath) : "-", `${totalRows}`, `${displayTable?.rows.length ?? totalRows}`, `${enabledModules}`];
  }

  if (workspaceId === "speaker") {
    return [`${totalRows}`, state.isRunning ? "1" : "0", `${completed}`, modelLabel(settings)];
  }

  if (workspaceId === "batch") {
    const speakers = new Set(state.table.rows.map((row) => row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker).filter(Boolean));
    return [`${totalRows}`, `${totalRows}`, `${speakers.size}`, `${speakers.size}`];
  }

  if (workspaceId === "training") {
    const checkpoints = state.table.rows.filter((row) => row.raw?.checkpointPath || row.raw?.checkpoint_path || row.cells.checkpoint).length;
    return [trainingModelLabel(settings), `${totalRows}`, `${checkpoints}`, trainingStatusText(state.statusText)];
  }

  return [`${totalRows}`, `${completed}`, `${failed}`, `${totalRows}`, "기본값"];
}

export function isVoiceModelWorkspace(workspaceId: WorkspaceId): workspaceId is "training" | "inference" {
  return workspaceId === "training" || workspaceId === "inference";
}

export function voiceModelRuntimeSettingsKey(workspaceId: WorkspaceId, settings: WorkspaceSettings): string | undefined {
  if (workspaceId === "training") {
    const selectedModel = settings.training.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return [
      workspaceId,
      selectedModel,
      settings.training.toolRoot.trim(),
      selectedModel === "gpt-sovits" ? settings.training.gptVersion : "",
    ].join("|");
  }

  if (workspaceId === "inference") {
    const selectedModel = settings.inference.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return [
      workspaceId,
      selectedModel,
      settings.inference.toolRoot.trim(),
      selectedModel === "gpt-sovits" ? settings.inference.gptVersion : "",
    ].join("|");
  }

  return undefined;
}

export function nextAnimationFrame(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

export function formatRunError(result: WorkspaceRunResult): string {
  const lines = [result.metadata ? "백엔드 실행이 실패했습니다. 아래 로그 파일을 확인하세요." : result.error || "백엔드 실행이 실패했습니다."];

  if (typeof result.exitCode === "number") {
    lines.push(`종료 코드: ${result.exitCode}`);
  }

  if (result.metadata?.logPath) {
    lines.push(`Electron 로그: ${result.metadata.logPath}`);
  }

  if (result.metadata?.backendLogPath && result.metadata.backendLogPath !== result.metadata.logPath) {
    lines.push(`백엔드 로그: ${result.metadata.backendLogPath}`);
  }

  return Array.from(new Set(lines)).join("\n");
}

function modelLabel(settings: WorkspaceSettings): string {
  const labels = [
    settings.speaker.useVoiceFixer ? "VoiceFixer" : "",
    settings.speaker.useResemble ? "Resemble" : "",
    settings.speaker.useSidon ? "SIDON" : "",
  ].filter(Boolean);
  return labels.length > 0 ? labels.join(" + ") : "-";
}

function trainingModelLabel(settings: WorkspaceSettings): string {
  return settings.training.selectedModel === "omnivoice" ? "OmniVoice" : "GPT-SoVITS";
}
