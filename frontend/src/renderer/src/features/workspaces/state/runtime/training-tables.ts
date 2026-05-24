import type {
  DataTable,
  DataTableRow,
  TrainingCheckpointSummary,
  TrainingModelSummary,
  WorkspaceSettings,
} from "@shared/ipc";
import { createEmptyWorkspaceTable, workspaceTableColumns } from "@shared/table-schemas";
import type { WorkspaceResultSheet, WorkspaceTrainingIdentity } from "../workspace-runtime-store";
import { shortName } from "./terminal-state";

export function createTrainingTableForModel(
  selectedModel: WorkspaceTrainingIdentity["selectedModel"],
  rows: DataTableRow[] = [],
): DataTable {
  return withTrainingTableModel({ ...createEmptyWorkspaceTable("training"), rows }, selectedModel);
}

export function withTrainingTableModel(
  table: DataTable,
  selectedModel: WorkspaceTrainingIdentity["selectedModel"],
): DataTable {
  return {
    ...table,
    columns: trainingColumnsForModel(selectedModel),
    rows: table.rows.map((row) => normalizeTrainingRowForModel(row, selectedModel)),
  };
}

export function trainingIdentityFromSettings(settings: WorkspaceSettings["training"], modelNameOverride?: string): WorkspaceTrainingIdentity {
  const selectedModel = settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  return {
    selectedModel,
    toolRoot: settings.toolRoot.trim(),
    modelName: (modelNameOverride ?? settings.modelName).trim(),
    gptVersion: selectedModel === "gpt-sovits" ? settings.gptVersion : undefined,
  };
}

export function trainingModelMatchesIdentity(model: TrainingModelSummary, identity: WorkspaceTrainingIdentity): boolean {
  return normalizedIdentityValue(model.name) === normalizedIdentityValue(identity.modelName);
}

export function findTrainingModelByName(models: TrainingModelSummary[], modelName: string): TrainingModelSummary | undefined {
  const normalizedName = normalizedIdentityValue(modelName);
  return models.find((model) => normalizedIdentityValue(model.name) === normalizedName);
}

export function sameGptSovitsWatchTarget(current: WorkspaceSettings["training"], polled: WorkspaceSettings["training"]): boolean {
  return current.selectedModel === "gpt-sovits"
    && polled.selectedModel === "gpt-sovits"
    && current.gptVersion === polled.gptVersion
    && normalizedIdentityValue(current.modelName) === normalizedIdentityValue(polled.modelName)
    && normalizePathIdentity(current.toolRoot) === normalizePathIdentity(polled.toolRoot);
}

export function applyTrainingIdentityToSettings(
  settings: WorkspaceSettings["training"],
  identity: WorkspaceTrainingIdentity,
): WorkspaceSettings["training"] {
  return {
    ...settings,
    selectedModel: identity.selectedModel,
    toolRoot: identity.toolRoot || settings.toolRoot,
    modelName: identity.modelName || settings.modelName,
    gptVersion: identity.selectedModel === "gpt-sovits" && identity.gptVersion ? identity.gptVersion : settings.gptVersion,
  };
}

export function findTrainingSheetByIdentity(sheets: WorkspaceResultSheet[], identity: WorkspaceTrainingIdentity): WorkspaceResultSheet | undefined {
  return sheets.find((sheet) => trainingSheetMatchesIdentity(sheet, identity));
}

export function trainingSheetMatchesIdentity(sheet: WorkspaceResultSheet | undefined, identity: WorkspaceTrainingIdentity): boolean {
  const sheetIdentity = resolveTrainingIdentityFromSheet(sheet);
  return Boolean(sheetIdentity && trainingIdentityKey(sheetIdentity) === trainingIdentityKey(identity));
}

export function resolveTrainingIdentityFromSheet(sheet: WorkspaceResultSheet | undefined): WorkspaceTrainingIdentity | undefined {
  if (!sheet) {
    return undefined;
  }
  if (sheet.trainingIdentity?.modelName.trim()) {
    return sheet.trainingIdentity;
  }

  const row = sheet.table.rows.find((item) => item.raw?.modelName || item.cells.modelName);
  const modelName = row?.raw?.modelName || row?.cells.modelName || "";
  if (!modelName.trim()) {
    return undefined;
  }
  const modelType = row?.raw?.modelType === "omnivoice" ? "omnivoice" : "gpt-sovits";
  const gptVersion = row?.raw?.gptVersion as WorkspaceSettings["training"]["gptVersion"] | undefined;
  return {
    selectedModel: modelType,
    toolRoot: row?.raw?.toolRoot || "",
    modelName,
    gptVersion: modelType === "gpt-sovits" ? gptVersion : undefined,
  };
}

export function trainingCheckpointRows(model: TrainingModelSummary, identity: WorkspaceTrainingIdentity): DataTableRow[] {
  return model.checkpoints
    .filter(isPublishableTrainingCheckpoint)
    .map((checkpoint, index) => trainingCheckpointRow(checkpoint, identity, index));
}

export function mergeTrainingRows(table: DataTable, incomingRows: DataTableRow[]): DataTable {
  const rows = table.rows.map(cloneRow);
  const existingKeys = new Set(rows.map(trainingRowKey).filter(Boolean));
  for (const row of incomingRows) {
    const key = trainingRowKey(row);
    if (key && existingKeys.has(key)) {
      continue;
    }
    rows.push(cloneRow(row));
    if (key) {
      existingKeys.add(key);
    }
  }
  return reindexTrainingTable(tableWithRows(table, rows));
}

export function hasNewTrainingRows(table: DataTable, incomingRows: DataTableRow[]): boolean {
  const existingKeys = new Set(table.rows.map(trainingRowKey).filter(Boolean));
  return incomingRows.some((row) => {
    const key = trainingRowKey(row);
    return !key || !existingKeys.has(key);
  });
}

export function settingsWithTrainingSheet(settings: WorkspaceSettings, sheet: WorkspaceResultSheet): WorkspaceSettings {
  const identity = resolveTrainingIdentityFromSheet(sheet);
  if (!identity) {
    return settings;
  }

  return {
    ...settings,
    training: applyTrainingIdentityToSettings(settings.training, identity),
  };
}

export function trainingStatusText(status: string): string {
  switch (status) {
    case "Loaded":
      return "불러옴";
    case "Listing input files":
      return "입력 파일 나열 중";
    case "Loading":
      return "불러오는 중";
    case "Load failed":
      return "불러오기 실패";
    case "Running":
      return "학습 중";
    case "Retrying":
      return "이어하기 중";
    case "Stopping":
      return "중지 중";
    case "Stopped":
      return "중지됨";
    case "Completed":
      return "완료";
    case "Failed":
      return "실패";
    case "Retry completed":
      return "이어하기 완료";
    case "Retry failed":
      return "이어하기 실패";
    default:
      return status || "-";
  }
}

function trainingColumnsForModel(selectedModel: WorkspaceTrainingIdentity["selectedModel"]): DataTable["columns"] {
  const hiddenColumn = selectedModel === "omnivoice" ? "epoch" : "step";
  return workspaceTableColumns.training.filter((column) => column.key !== hiddenColumn);
}

function normalizeTrainingRowForModel(
  row: DataTableRow,
  selectedModel: WorkspaceTrainingIdentity["selectedModel"],
): DataTableRow {
  const epoch = selectedModel === "omnivoice" ? "" : row.cells.epoch || row.raw?.epoch || "";
  const step = selectedModel === "omnivoice" ? row.cells.step || row.raw?.step || "" : "";
  return {
    ...row,
    raw: row.raw ? { ...row.raw, epoch, step } : undefined,
    cells: { ...row.cells, epoch, step },
  };
}

function trainingIdentityKey(identity: WorkspaceTrainingIdentity): string {
  return [
    identity.selectedModel,
    identity.selectedModel === "gpt-sovits" ? identity.gptVersion ?? "" : "",
    normalizePathIdentity(identity.toolRoot),
    normalizedIdentityValue(identity.modelName),
  ].join("|");
}

function trainingCheckpointRow(
  checkpoint: TrainingCheckpointSummary,
  identity: WorkspaceTrainingIdentity,
  index: number,
): DataTableRow {
  const checkpointName = shortName(checkpoint.path);
  const stage = trainingCheckpointStageLabel(checkpoint);
  const unit = checkpoint.kind === "omnivoice"
    ? { epoch: "", step: checkpoint.step ?? "" }
    : { epoch: checkpoint.epoch ?? "", step: "" };
  const raw: Record<string, string> = {
    id: checkpoint.path,
    modelType: identity.selectedModel,
    modelName: identity.modelName,
    toolRoot: identity.toolRoot,
    gptVersion: identity.gptVersion ?? "",
    stage: checkpoint.kind,
    checkpointRole: checkpoint.role ?? "",
    checkpointComponent: checkpoint.component ?? "",
    epoch: unit.epoch,
    step: unit.step,
    checkpoint: checkpointName,
    checkpointPath: checkpoint.path,
    status: "completed",
    discoveredCheckpoint: "true",
  };
  return {
    id: checkpoint.path || `${index + 1}`,
    sourcePath: checkpoint.path,
    raw,
    cells: {
      index: `${index + 1}`,
      modelName: identity.modelName,
      stage,
      epoch: unit.epoch,
      step: unit.step,
      elapsed: "",
      checkpoint: checkpointName,
      status: "completed",
    },
  };
}

function isPublishableTrainingCheckpoint(checkpoint: TrainingCheckpointSummary): boolean {
  const normalized = normalizePathIdentity(checkpoint.path);
  if (!normalized) {
    return false;
  }
  return !normalized.includes("/vendor/hf/");
}

function trainingCheckpointStageLabel(checkpoint: TrainingCheckpointSummary): string {
  const roleText = checkpoint.role === "resume" ? "이어하기용" : checkpoint.role === "inference" ? "추론용" : "이어하기/추론용";
  if (checkpoint.kind === "omnivoice") {
    return `OmniVoice ${roleText}`;
  }
  if (checkpoint.kind === "gpt") {
    return `GPT ${roleText}`;
  }
  if (checkpoint.component === "discriminator") {
    return `SoVITS ${roleText} D`;
  }
  if (checkpoint.component === "generator") {
    return `SoVITS ${roleText} G`;
  }
  return `SoVITS ${roleText}`;
}

function trainingRowKey(row: DataTableRow): string {
  const raw = row.raw ?? {};
  const checkpointPath = raw.checkpointPath || raw.checkpoint_path || row.sourcePath;
  if (checkpointPath) {
    return `${raw.modelType || ""}|${raw.modelName || row.cells.modelName || ""}|${raw.stage || row.cells.stage || ""}|${normalizePathIdentity(checkpointPath)}`;
  }
  return `${raw.modelType || ""}|${raw.modelName || row.cells.modelName || ""}|${raw.stage || row.cells.stage || ""}|${row.cells.epoch || raw.epoch || ""}|${row.cells.step || raw.step || ""}`;
}

function normalizedIdentityValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizePathIdentity(value: string | undefined): string {
  return (value ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}

function tableWithRows(table: DataTable, rows: DataTableRow[]): DataTable {
  return { ...table, rows };
}

function reindexTrainingTable(table: DataTable): DataTable {
  return {
    ...table,
    rows: table.rows.map((row, index) => ({
      ...row,
      id: `${index + 1}`,
      cells: {
        ...row.cells,
        index: `${index + 1}`,
      },
    })),
  };
}

function cloneRow(row: DataTableRow): DataTableRow {
  return {
    ...row,
    cells: { ...row.cells },
    raw: row.raw ? { ...row.raw } : undefined,
  };
}
