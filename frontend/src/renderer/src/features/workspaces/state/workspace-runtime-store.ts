import type { DataTable, DetailField, FileTreeResult, VoiceTrainingModel, VoiceTrainingSettings, WorkspaceId, WorkspaceProgress, WorkspaceRunResult, WorkspaceTerminalUpdate } from "@shared/ipc";
import { createEmptyWorkspaceTable } from "@shared/table-schemas";
import { defaultBatchFilterState, type BatchFilterState } from "../model/batch-filter";

export type WorkspaceResultSheet = {
  id: string;
  label: string;
  inputPath: string;
  outputPath: string;
  inputTree?: FileTreeResult;
  outputTree?: FileTreeResult;
  table: DataTable;
  details: DetailField[];
  selectedRowId?: string;
  selectedRowIds: string[];
  selectedFilePath?: string;
  selectedAudioPath?: string;
  selectedResultAudioPath?: string;
  inferenceMultiReferenceOpen: boolean;
  inferenceAuxReferenceAudioPaths: string[];
  browserPreferredSection: "input" | "output";
  browserSectionRequestId: number;
  browserRevealRequestId: number;
  tableRevealRequestId: number;
  tableSearchQuery: string;
  tableSearchColumns: string[];
  rowExportChecks: Record<string, boolean>;
  batchSpeakerChecks: Record<string, boolean>;
  lastRun?: WorkspaceRunResult;
  trainingIdentity?: WorkspaceTrainingIdentity;
};

export type WorkspaceTrainingIdentity = {
  selectedModel: VoiceTrainingModel;
  toolRoot: string;
  modelName: string;
  gptVersion?: VoiceTrainingSettings["gptVersion"];
};

export type WorkspaceRuntimeState = {
  inputPath: string;
  outputPath: string;
  inputTree?: FileTreeResult;
  outputTree?: FileTreeResult;
  table: DataTable;
  details: DetailField[];
  selectedRowId?: string;
  selectedRowIds: string[];
  selectedFilePath?: string;
  selectedAudioPath?: string;
  selectedResultAudioPath?: string;
  inferenceMultiReferenceOpen: boolean;
  inferenceAuxReferenceAudioPaths: string[];
  browserPreferredSection: "input" | "output";
  browserSectionRequestId: number;
  browserRevealRequestId: number;
  tableRevealRequestId: number;
  tableSearchQuery: string;
  tableSearchColumns: string[];
  statusText: string;
  progressPercent: number;
  progress?: WorkspaceProgress;
  error?: string;
  isRunning: boolean;
  isExporting: boolean;
  isBatchSpeakerRunning: boolean;
  rowExportChecks: Record<string, boolean>;
  batchFilter: BatchFilterState;
  batchSpeakerChecks: Record<string, boolean>;
  lastRun?: WorkspaceRunResult;
  terminal: WorkspaceTerminalState;
  terminalOpenRequestId: number;
  sheets: WorkspaceResultSheet[];
  activeSheetId?: string;
};

export type WorkspaceTerminalStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type WorkspaceTerminalState = {
  text: string;
  status: WorkspaceTerminalStatus;
  logPath?: string;
  backendLogPath?: string;
  command?: string;
  updatedAt?: string;
};

export type WorkspaceRuntimeStore = Record<WorkspaceId, WorkspaceRuntimeState>;

export type WorkspaceRuntimeAction =
  | {
      type: "workspace.patch";
      workspaceId: WorkspaceId;
      patch: Partial<WorkspaceRuntimeState>;
    }
  | {
      type: "workspace.replace";
      workspaceId: WorkspaceId;
      state: WorkspaceRuntimeState;
    };

export const workspaceIds: WorkspaceId[] = ["slice", "tagging", "speaker", "overview", "batch", "training", "inference"];

export function createInitialRuntimeState(workspaceId: WorkspaceId): WorkspaceRuntimeState {
  const table = createEmptyWorkspaceTable(workspaceId);
  const details = table.columns.map((column) => ({ label: column.label, value: "-" }));
  const sheet = createWorkspaceResultSheet(workspaceId, "Sheet1", {
    id: `sheet-${workspaceId}-1`,
    table,
    details,
  });

  return {
    inputPath: sheet.inputPath,
    outputPath: sheet.outputPath,
    inputTree: sheet.inputTree,
    outputTree: sheet.outputTree,
    table: sheet.table,
    details: sheet.details,
    selectedRowId: sheet.selectedRowId,
    selectedRowIds: sheet.selectedRowIds,
    selectedFilePath: sheet.selectedFilePath,
    selectedAudioPath: sheet.selectedAudioPath,
    selectedResultAudioPath: sheet.selectedResultAudioPath,
    inferenceMultiReferenceOpen: sheet.inferenceMultiReferenceOpen,
    inferenceAuxReferenceAudioPaths: sheet.inferenceAuxReferenceAudioPaths,
    browserPreferredSection: sheet.browserPreferredSection,
    browserSectionRequestId: sheet.browserSectionRequestId,
    browserRevealRequestId: sheet.browserRevealRequestId,
    tableRevealRequestId: sheet.tableRevealRequestId,
    tableSearchQuery: sheet.tableSearchQuery,
    tableSearchColumns: sheet.tableSearchColumns,
    statusText: "Idle",
    progressPercent: 0,
    progress: undefined,
    isRunning: false,
    isExporting: false,
    isBatchSpeakerRunning: false,
    rowExportChecks: sheet.rowExportChecks,
    batchFilter: defaultBatchFilterState,
    batchSpeakerChecks: sheet.batchSpeakerChecks,
    lastRun: sheet.lastRun,
    terminal: createEmptyTerminalState(),
    terminalOpenRequestId: 0,
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

export function createEmptyTerminalState(): WorkspaceTerminalState {
  return {
    text: "",
    status: "idle",
  };
}

export function terminalStateFromUpdate(update: WorkspaceTerminalUpdate, status: WorkspaceTerminalStatus): WorkspaceTerminalState {
  return {
    text: update.text,
    status,
    logPath: update.logPath,
    backendLogPath: update.backendLogPath,
    command: update.command,
    updatedAt: update.updatedAt,
  };
}

export function createInitialRuntimeStore(): WorkspaceRuntimeStore {
  return Object.fromEntries(workspaceIds.map((id) => [id, createInitialRuntimeState(id)])) as WorkspaceRuntimeStore;
}

export function workspaceRuntimeReducer(store: WorkspaceRuntimeStore, action: WorkspaceRuntimeAction): WorkspaceRuntimeStore {
  if (action.type === "workspace.replace") {
    return {
      ...store,
      [action.workspaceId]: action.state,
    };
  }

  return {
    ...store,
    [action.workspaceId]: {
      ...store[action.workspaceId],
      ...action.patch,
    },
  };
}

export function createWorkspaceResultSheet(
  workspaceId: WorkspaceId,
  label: string,
  seed: Partial<WorkspaceResultSheet> = {},
): WorkspaceResultSheet {
  const table = seed.table ?? createEmptyWorkspaceTable(workspaceId);
  return {
    id: seed.id ?? `sheet-${Date.now().toString(36)}`,
    label,
    inputPath: seed.inputPath ?? "",
    outputPath: seed.outputPath ?? "",
    inputTree: seed.inputTree,
    outputTree: seed.outputTree,
    table,
    details: seed.details ?? table.columns.map((column) => ({ label: column.label, value: "-" })),
    selectedRowId: seed.selectedRowId,
    selectedRowIds: seed.selectedRowIds ?? [],
    selectedFilePath: seed.selectedFilePath,
    selectedAudioPath: seed.selectedAudioPath,
    selectedResultAudioPath: seed.selectedResultAudioPath,
    inferenceMultiReferenceOpen: seed.inferenceMultiReferenceOpen ?? false,
    inferenceAuxReferenceAudioPaths: seed.inferenceAuxReferenceAudioPaths ?? [],
    browserPreferredSection: seed.browserPreferredSection ?? "input",
    browserSectionRequestId: seed.browserSectionRequestId ?? 0,
    browserRevealRequestId: seed.browserRevealRequestId ?? 0,
    tableRevealRequestId: seed.tableRevealRequestId ?? 0,
    tableSearchQuery: seed.tableSearchQuery ?? "",
    tableSearchColumns: seed.tableSearchColumns ?? [],
    rowExportChecks: seed.rowExportChecks ?? {},
    batchSpeakerChecks: seed.batchSpeakerChecks ?? {},
    lastRun: seed.lastRun,
    trainingIdentity: seed.trainingIdentity,
  };
}

export function nextSheetLabel(sheets: WorkspaceResultSheet[]): string {
  return `Sheet${sheets.length + 1}`;
}

export function resultSheetHasRows(sheet: WorkspaceResultSheet | undefined): boolean {
  return Boolean(sheet && sheet.table.rows.length > 0);
}

export function activeSheet(state: WorkspaceRuntimeState): WorkspaceResultSheet | undefined {
  return state.sheets.find((sheet) => sheet.id === state.activeSheetId) ?? state.sheets[state.sheets.length - 1];
}

export function stateWithActiveSheet(state: WorkspaceRuntimeState, sheet: WorkspaceResultSheet | undefined): WorkspaceRuntimeState {
  if (!sheet) {
    return state;
  }

  return {
    ...state,
    inputPath: sheet.inputPath,
    outputPath: sheet.outputPath,
    inputTree: sheet.inputTree,
    outputTree: sheet.outputTree,
    table: sheet.table,
    details: sheet.details,
    selectedRowId: sheet.selectedRowId,
    selectedRowIds: sheet.selectedRowIds,
    selectedFilePath: sheet.selectedFilePath,
    selectedAudioPath: sheet.selectedAudioPath,
    selectedResultAudioPath: sheet.selectedResultAudioPath,
    inferenceMultiReferenceOpen: sheet.inferenceMultiReferenceOpen,
    inferenceAuxReferenceAudioPaths: sheet.inferenceAuxReferenceAudioPaths,
    browserPreferredSection: sheet.browserPreferredSection,
    browserSectionRequestId: sheet.browserSectionRequestId,
    browserRevealRequestId: sheet.browserRevealRequestId,
    tableRevealRequestId: sheet.tableRevealRequestId,
    tableSearchQuery: sheet.tableSearchQuery,
    tableSearchColumns: sheet.tableSearchColumns,
    rowExportChecks: sheet.rowExportChecks,
    batchSpeakerChecks: sheet.batchSpeakerChecks,
    lastRun: sheet.lastRun,
    terminal: state.terminal,
    terminalOpenRequestId: state.terminalOpenRequestId,
  };
}

export function updateActiveSheet(
  state: WorkspaceRuntimeState,
  patch: Partial<WorkspaceResultSheet>,
): WorkspaceRuntimeState {
  const sheet = activeSheet(state);
  if (!sheet) {
    return state;
  }

  const nextSheet = { ...sheet, ...patch };
  const sheets = state.sheets.map((item) => (item.id === nextSheet.id ? nextSheet : item));
  return stateWithActiveSheet({ ...state, sheets, activeSheetId: nextSheet.id }, nextSheet);
}
