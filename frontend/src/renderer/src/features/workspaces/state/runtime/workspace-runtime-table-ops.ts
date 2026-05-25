import type { DataTable, DataTableRow, FileTreeNode, FileTreeResult, WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import type { ScrollWindowMetrics } from "@shared/scroll-window";
import { createEmptyWorkspaceTable } from "@shared/table-schemas";
import { applyTagScoreRulesToTable, type TagScoreRule } from "../../model/pretrained-sed-tagging";
import { isAudioPath, resolveAudioSelection, wavCacheFileNameKey } from "../../model/workspace-runtime-selection";
import { activeSheet, type WorkspaceRuntimeState } from "../workspace-runtime-store";

export function normalizeBatchQcStatus(value: string): string {
  const normalized = value.trim();
  if (normalized === "검수됨" || normalized === "수정됨") {
    return normalized;
  }
  return "검수전";
}

export function buildTableSelectionPatch(workspaceId: WorkspaceId, table: DataTable, state: WorkspaceRuntimeState, fallbackAudioPath = "") {
  const rowById = new Map(table.rows.map((row) => [row.id, row]));
  const retainedSelectedRowIds = state.selectedRowIds.filter((rowId) => rowById.has(rowId));
  const selectedRow = (state.selectedRowId ? rowById.get(state.selectedRowId) : undefined) ?? (retainedSelectedRowIds[0] ? rowById.get(retainedSelectedRowIds[0]) : undefined) ?? table.rows[0];
  const selectedRowIds = retainedSelectedRowIds.length > 0 ? retainedSelectedRowIds : selectedRow ? [selectedRow.id] : [];
  const audioSelection = resolveAudioSelection(workspaceId, selectedRow, fallbackAudioPath);
  return {
    selectedRowId: selectedRow?.id,
    selectedRowIds,
    selectedFilePath: audioSelection.selectedFilePath,
    selectedAudioPath: audioSelection.selectedAudioPath,
    selectedResultAudioPath: audioSelection.selectedResultAudioPath,
    details: selectedRow ? table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : table.columns.map((column) => ({ label: column.label, value: "-" })),
  };
}

export function toggleSelectedRowId(selectedRowIds: string[], rowId: string): string[] {
  if (!selectedRowIds.includes(rowId)) {
    return [...selectedRowIds, rowId];
  }

  const nextSelectedRowIds = selectedRowIds.filter((selectedRowId) => selectedRowId !== rowId);
  return nextSelectedRowIds.length > 0 ? nextSelectedRowIds : [rowId];
}

export function sheetCanRetry(sheet: ReturnType<typeof activeSheet>): boolean {
  return Boolean(sheet && (sheet.table.rows.length > 0 || sheet.lastRun));
}

export function buildRetryPlan(workspaceId: WorkspaceId, sheet: NonNullable<ReturnType<typeof activeSheet>>, inputTree: FileTreeResult | undefined) {
  if (workspaceId === "training" || workspaceId === "inference") {
    return {
      baseTable: sheet.table,
      pendingSourcePaths: [],
      sourcePathByFileName: new Map<string, string>(),
    };
  }

  const allInputPaths = collectInputAudioPaths(inputTree);
  const successful = sheetRunSucceeded(sheet);
  const canResume = !successful && allInputPaths.length > 0;
  const baseTable = canResume ? tableWithRows(sheet.table, sheet.table.rows.filter((row) => rowCompletedSuccessfully(workspaceId, row))) : createEmptyWorkspaceTable(workspaceId);
  const completedSourceKeys = new Set(baseTable.rows.map((row) => normalizedSourceKey(rowSourcePath(workspaceId, row))).filter(Boolean));
  const completedFileNames = new Set(baseTable.rows.map((row) => fileNameKey(rowFileName(row))).filter(Boolean));
  const pendingSourcePaths = !canResume
    ? []
    : allInputPaths.filter((sourcePath) => {
        const sourceKey = normalizedSourceKey(sourcePath);
        const nameKey = fileNameKey(sourcePath);
        const wavNameKey = wavCacheFileNameKey(sourcePath);
        return !completedSourceKeys.has(sourceKey) && !completedFileNames.has(nameKey) && !completedFileNames.has(wavNameKey);
      });

  return {
    baseTable,
    pendingSourcePaths,
    sourcePathByFileName: buildSourcePathLookup(allInputPaths),
  };
}

export function mergeRetryTables(workspaceId: WorkspaceId, baseTable: DataTable, retryTable: DataTable, sourcePathByFileName?: Map<string, string>): DataTable {
  return reindexTable(workspaceId, tableWithRows(baseTable, [...baseTable.rows, ...normalizeRetryTable(workspaceId, retryTable, sourcePathByFileName).rows]));
}

export function normalizeRetryTable(workspaceId: WorkspaceId, table: DataTable, sourcePathByFileName?: Map<string, string>): DataTable {
  return reindexTable(workspaceId, tableWithRows(table, table.rows.map((row) => normalizeRetryRow(workspaceId, row, sourcePathByFileName))));
}

export function pasteRowsIntoTable(workspaceId: WorkspaceId, targetTable: DataTable, sourceRows: DataTableRow[], duplicateMode: "overwrite" | "skip"): DataTable {
  const nextRows = targetTable.rows.map(cloneRow);
  const indexBySourceKey = new Map(nextRows.map((row, index) => [duplicateKey(workspaceId, row), index]).filter(([key]) => Boolean(key)) as Array<[string, number]>);

  for (const sourceRow of sourceRows) {
    const copiedRow = cloneRow(sourceRow);
    const key = duplicateKey(workspaceId, copiedRow);
    const existingIndex = key ? indexBySourceKey.get(key) : undefined;
    if (existingIndex !== undefined) {
      if (duplicateMode === "overwrite") {
        nextRows[existingIndex] = copiedRow;
      }
      continue;
    }

    indexBySourceKey.set(key, nextRows.length);
    nextRows.push(copiedRow);
  }

  return reindexTable(workspaceId, tableWithRows(targetTable, nextRows));
}

export function cloneRow(row: DataTableRow): DataTableRow {
  return {
    ...row,
    cells: { ...row.cells },
    raw: row.raw ? { ...row.raw } : undefined,
  };
}

export function resolveFileBrowserWindow(windowState: NonNullable<FileTreeResult["window"]>, direction: "reveal" | "sync" | "up" | "down", metrics?: ScrollWindowMetrics): { offset: number; limit: number } | undefined {
  const stepSize = Math.max(1, metrics?.stepSize ?? windowState.limit);
  const chunkSize = Math.max(1, metrics?.chunkSize ?? windowState.limit);

  if (direction === "reveal" || direction === "sync") {
    return {
      offset: Math.min(windowState.offset, Math.max(0, windowState.total - chunkSize)),
      limit: chunkSize,
    };
  }

  if (direction === "up") {
    if (!windowState.hasPrevious) {
      return undefined;
    }
    return {
      offset: Math.max(0, windowState.offset - stepSize),
      limit: chunkSize,
    };
  }

  if (!windowState.hasMore) {
    return undefined;
  }

  return {
    offset: Math.min(windowState.offset + stepSize, Math.max(0, windowState.total - chunkSize)),
    limit: chunkSize,
  };
}

export function isAudioConversionStatusTree(tree: FileTreeResult): boolean {
  const visit = (nodes: FileTreeNode[]): boolean => nodes.some((node) => {
    if (node.meta && (node.meta.includes("\ubcc0\ud658 \ub300\uae30") || node.meta.includes("\ubcc0\ud658 \uc911") || node.meta.includes("\ubcc0\ud658 \uc644\ub8cc") || node.meta.includes("\ubcc0\ud658 \uc900\ube44\ub428"))) {
      return true;
    }

    return node.children ? visit(node.children) : false;
  });

  return visit(tree.nodes);
}

export function buildExportTable(workspaceId: WorkspaceId, table: DataTable, tagScoreRules: TagScoreRule[], settings: WorkspaceSettings): DataTable {
  if (workspaceId === "tagging") {
    return applyTagScoreRulesToTable(table, tagScoreRules, settings.slicer);
  }

  return table;
}

export function filterTableBySearch(table: DataTable, query: string, selectedColumns: string[]): DataTable {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return table;
  }
  const columns = selectedColumns.length > 0 ? selectedColumns : table.columns.map((column) => column.key).filter((key) => key !== "index");
  return {
    ...table,
    rows: table.rows.filter((row) =>
      columns
        .map((key) => (key === "sourcePath" ? row.sourcePath ?? "" : row.cells[key] ?? row.raw?.[key] ?? ""))
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    ),
  };
}

function buildSourcePathLookup(sourcePaths: string[]): Map<string, string> {
  const pairs: Array<[string, string]> = [];
  for (const sourcePath of sourcePaths) {
    pairs.push([fileNameKey(sourcePath), sourcePath]);
    pairs.push([wavCacheFileNameKey(sourcePath), sourcePath]);
  }
  return new Map(pairs);
}

function normalizeRetryRow(workspaceId: WorkspaceId, row: DataTableRow, sourcePathByFileName?: Map<string, string>): DataTableRow {
  const fileName = rowFileName(row);
  const originalPath = sourcePathByFileName?.get(fileNameKey(fileName));
  if (!originalPath) {
    return row;
  }

  const raw = { ...(row.raw ?? {}) };
  if (workspaceId === "overview") {
    raw.absolute_path = originalPath;
  } else {
    raw.originalPath = originalPath;
    raw.original_path = originalPath;
  }

  return {
    ...row,
    sourcePath: workspaceId === "speaker" ? row.sourcePath : originalPath,
    raw,
  };
}

function tableWithRows(table: DataTable, rows: DataTableRow[]): DataTable {
  return { ...table, rows };
}

function reindexTable(_workspaceId: WorkspaceId, table: DataTable): DataTable {
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

function duplicateKey(workspaceId: WorkspaceId, row: DataTableRow): string {
  return normalizedSourceKey(rowSourcePath(workspaceId, row)) || fileNameKey(rowFileName(row));
}

function sheetRunSucceeded(sheet: NonNullable<ReturnType<typeof activeSheet>>): boolean {
  const progress = sheet.lastRun?.progress;
  return Boolean(progress && progress.total > 0 && progress.completed === progress.total && progress.failed === 0 && progress.percent >= 100);
}

function rowCompletedSuccessfully(workspaceId: WorkspaceId, row: DataTableRow): boolean {
  if (workspaceId === "overview") {
    return !String(row.raw?.error ?? row.cells.error ?? "").trim();
  }

  return rawStatus(row) === "completed";
}

function rawStatus(row: DataTableRow): string {
  return String(row.raw?.status ?? row.raw?.audioStatus ?? row.raw?.sessionStatus ?? "").trim().toLowerCase();
}

function rowSourcePath(workspaceId: WorkspaceId, row: DataTableRow): string {
  const raw = row.raw ?? {};
  if (workspaceId === "overview") {
    return raw.absolute_path || row.sourcePath || row.cells.absolute_path || row.cells.file_name || "";
  }

  if (workspaceId === "training") {
    return raw.datasetPath || raw.dataset_path || raw.inputPath || raw.input_path || raw.checkpointPath || row.sourcePath || row.cells.modelName || "";
  }

  return raw.originalPath || raw.original_path || raw.inputPath || raw.input_path || row.sourcePath || row.cells.fileName || row.cells.file_name || "";
}

function rowFileName(row: DataTableRow): string {
  return row.raw?.fileName || row.raw?.file_name || row.cells.fileName || row.cells.file_name || row.sourcePath || row.id;
}

function collectInputAudioPaths(inputTree: FileTreeResult | undefined): string[] {
  if (!inputTree) {
    return [];
  }

  const paths: string[] = [];
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "file" && isAudioPath(node.path)) {
        paths.push(node.path);
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(inputTree.nodes);
  return paths;
}

function normalizedSourceKey(value: string | undefined): string {
  return (value ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}

function fileNameKey(value: string | undefined): string {
  const normalized = normalizedSourceKey(value);
  return normalized.split("/").pop() ?? normalized;
}
