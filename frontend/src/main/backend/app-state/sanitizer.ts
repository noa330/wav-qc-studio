import { basename } from "node:path";
import { fileSizeMeta, findAudioSourceMapping, isRealPathCandidate, isVirtualPath, readProjectAudioSourceMappings, resolveMappedAudioPath, resolveSanitizedTreeRoot, type AudioSourceMapping } from "./audio-mappings";
import { isRecord, pathExists, stringValue } from "./store-utils";

const virtualPathPrefix = "wqcs://";

export function sanitizeProjectRecord(project: unknown): unknown {
  if (!isRecord(project) || project.state === undefined) {
    return project;
  }

  return {
    ...project,
    state: sanitizePersistedAppState(project.state, stringValue(project.rootPath)),
  };
}

export function sanitizePersistedAppState(state: unknown, projectRoot?: string): unknown {
  if (!isRecord(state)) {
    return state;
  }

  return {
    ...state,
    runtime: sanitizeRuntimeState(state.runtime, projectRoot),
  };
}

function sanitizeRuntimeState(runtime: unknown, projectRoot?: string): unknown {
  if (!isRecord(runtime)) {
    return runtime;
  }

  return {
    ...runtime,
    rowsClipboard: sanitizeRowsClipboard(runtime.rowsClipboard, projectRoot),
    states: sanitizeWorkspaceStates(runtime.states, projectRoot),
  };
}

function sanitizeRowsClipboard(value: unknown, projectRoot?: string): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const workspaceId = stringValue(value.workspaceId);
  if (!workspaceId || !Array.isArray(value.rows)) {
    return value;
  }

  const audioMappings = readProjectAudioSourceMappings(projectRoot, workspaceId, "");
  const rows = value.rows
    .filter(isRecord)
    .map((row) => sanitizeDataTableRowAudioMapping(row, audioMappings));

  return {
    ...value,
    rows: rows.filter((row) => rowHasAvailablePath(workspaceId, row)),
  };
}

function sanitizeWorkspaceStates(states: unknown, projectRoot?: string): unknown {
  if (!isRecord(states)) {
    return states;
  }

  return Object.fromEntries(
    Object.entries(states).map(([workspaceId, state]) => [
      workspaceId,
      sanitizeWorkspaceState(workspaceId, state, projectRoot),
    ]),
  );
}

function sanitizeWorkspaceState(workspaceId: string, state: unknown, projectRoot?: string): unknown {
  if (!isRecord(state)) {
    return state;
  }

  const inputPath = stringValue(state.inputPath);
  const audioMappings = readProjectAudioSourceMappings(projectRoot, workspaceId, inputPath);
  const forceClear = Boolean(inputPath && !pathExists(inputPath) && audioMappings.length === 0);
  const sanitizedState = sanitizeWorkspaceRecord(workspaceId, state, forceClear, audioMappings);
  const rawSheets = Array.isArray(state.sheets) ? state.sheets : [];
  const sheets = rawSheets
    .filter(isRecord)
    .map((sheet) => {
      const sheetInputPath = stringValue(sheet.inputPath) || inputPath;
      const sheetMappings = sheetInputPath === inputPath ? audioMappings : readProjectAudioSourceMappings(projectRoot, workspaceId, sheetInputPath);
      return sanitizeWorkspaceRecord(
        workspaceId,
        sheet,
        forceClear || Boolean(sheetInputPath && !pathExists(sheetInputPath) && sheetMappings.length === 0),
        sheetMappings,
      );
    });

  if (sheets.length === 0) {
    return sanitizedState;
  }

  const activeSheetId = sheets.some((sheet) => stringValue(sheet.id) === stringValue(sanitizedState.activeSheetId))
    ? stringValue(sanitizedState.activeSheetId)
    : stringValue(sheets[0]?.id);

  return {
    ...sanitizedState,
    sheets,
    activeSheetId: activeSheetId || sanitizedState.activeSheetId,
  };
}

function sanitizeWorkspaceRecord(workspaceId: string, record: Record<string, unknown>, forceClear: boolean, audioMappings: AudioSourceMapping[] = []): Record<string, unknown> {
  if (forceClear) {
    return clearWorkspaceRecord(record);
  }

  const table = sanitizeDataTable(workspaceId, record.table, audioMappings);
  const rowIds = collectTableRowIds(table);
  const selectedRowIds = Array.isArray(record.selectedRowIds)
    ? record.selectedRowIds.map(stringValue).filter((rowId) => rowIds.has(rowId))
    : [];
  const selectedRowId = rowIds.has(stringValue(record.selectedRowId))
    ? stringValue(record.selectedRowId)
    : selectedRowIds[0];

  return {
    ...record,
    table,
    details: rowIds.size > 0 ? record.details : detailsForTable(table),
    selectedRowId,
    selectedRowIds,
    inputTree: sanitizeFileTree(record.inputTree, rowIds, audioMappings),
    outputTree: sanitizeFileTree(record.outputTree, rowIds),
    selectedFilePath: sanitizeSelectedPath(record.selectedFilePath, rowIds, audioMappings),
    selectedAudioPath: sanitizeSelectedPath(record.selectedAudioPath, rowIds, audioMappings),
    selectedResultAudioPath: sanitizeSelectedPath(record.selectedResultAudioPath, rowIds),
    rowExportChecks: filterRecordByKeys(record.rowExportChecks, rowIds),
    batchSpeakerChecks: filterBatchSpeakerChecks(record.batchSpeakerChecks, table),
    lastRun: undefined,
    isRunning: false,
    isExporting: false,
    isBatchSpeakerRunning: false,
    progressPercent: 0,
    progress: undefined,
    error: undefined,
  };
}

function clearWorkspaceRecord(record: Record<string, unknown>): Record<string, unknown> {
  const table = emptyDataTable(record.table);
  return {
    ...record,
    inputPath: "",
    outputPath: "",
    inputTree: undefined,
    outputTree: undefined,
    table,
    details: detailsForTable(table),
    selectedRowId: undefined,
    selectedRowIds: [],
    selectedFilePath: undefined,
    selectedAudioPath: undefined,
    selectedResultAudioPath: undefined,
    rowExportChecks: {},
    batchSpeakerChecks: {},
    lastRun: undefined,
    isRunning: false,
    isExporting: false,
    isBatchSpeakerRunning: false,
    progressPercent: 0,
    progress: undefined,
    statusText: "Idle",
    error: undefined,
  };
}

function sanitizeDataTable(workspaceId: string, table: unknown, audioMappings: AudioSourceMapping[] = []): Record<string, unknown> {
  if (!isRecord(table)) {
    return emptyDataTable(table);
  }

  const rows = Array.isArray(table.rows)
    ? table.rows
      .filter(isRecord)
      .map((row) => sanitizeDataTableRowAudioMapping(row, audioMappings))
      .filter((row) => rowHasAvailablePath(workspaceId, row))
    : [];

  return {
    ...table,
    rows,
  };
}

function sanitizeDataTableRowAudioMapping(row: Record<string, unknown>, audioMappings: AudioSourceMapping[]): Record<string, unknown> {
  if (audioMappings.length === 0) {
    return row;
  }

  const raw = isRecord(row.raw) ? row.raw : {};
  const sourcePath = stringValue(raw.originalPath)
    || stringValue(raw.original_path)
    || stringValue(raw.absolute_path)
    || stringValue(raw.inputPath)
    || stringValue(raw.input_path)
    || stringValue(row.sourcePath);
  const mapping = findAudioSourceMapping(audioMappings, sourcePath);
  if (!mapping || !pathExists(mapping.cachedPath)) {
    return row;
  }

  return {
    ...row,
    raw: {
      ...raw,
      cachedPath: mapping.cachedPath,
      cached_path: mapping.cachedPath,
    },
  };
}

function rowHasAvailablePath(workspaceId: string, row: unknown): boolean {
  if (!isRecord(row)) {
    return false;
  }

  const sourceCandidates = rowSourcePathCandidates(workspaceId, row).filter(isRealPathCandidate);
  if (sourceCandidates.length > 0) {
    return sourceCandidates.some(pathExists);
  }

  const fallbackCandidates = rowAnyPathCandidates(row).filter(isRealPathCandidate);
  return fallbackCandidates.length === 0 || fallbackCandidates.some(pathExists);
}

function rowSourcePathCandidates(workspaceId: string, row: Record<string, unknown>): string[] {
  const raw = isRecord(row.raw) ? row.raw : {};
  const sourcePath = stringValue(row.sourcePath);
  const cachedPaths = [stringValue(raw.cachedPath), stringValue(raw.cached_path)];
  switch (workspaceId) {
    case "overview":
      return [stringValue(raw.absolute_path), sourcePath, ...cachedPaths];
    case "training":
      return [stringValue(raw.datasetPath), stringValue(raw.dataset_path), stringValue(raw.inputPath), stringValue(raw.input_path), stringValue(raw.checkpointPath), stringValue(raw.checkpoint_path), sourcePath, ...cachedPaths];
    case "inference":
      return [stringValue(raw.referenceAudioPath), stringValue(raw.reference_audio_path), stringValue(raw.outputAudioPath), stringValue(raw.output_audio_path), stringValue(raw.outputPath), sourcePath, ...cachedPaths];
    default:
      return [stringValue(raw.originalPath), stringValue(raw.original_path), stringValue(raw.absolute_path), stringValue(raw.inputPath), stringValue(raw.input_path), sourcePath, ...cachedPaths];
  }
}

function rowAnyPathCandidates(row: Record<string, unknown>): string[] {
  const raw = isRecord(row.raw) ? rawPathValues(row.raw) : [];
  return [stringValue(row.sourcePath), ...raw];
}

function rawPathValues(raw: Record<string, unknown>): string[] {
  return [
    "originalPath",
    "original_path",
    "absolute_path",
    "inputPath",
    "input_path",
    "outputPath",
    "output_path",
    "outputAudioPath",
    "output_audio_path",
    "finalOutputPath",
    "sidonOutputPath",
    "resembleOutputPath",
    "voiceFixerOutputPath",
    "cachedPath",
    "cached_path",
    "referenceAudioPath",
    "reference_audio_path",
    "checkpointPath",
    "checkpoint_path",
    "datasetPath",
    "dataset_path",
  ].map((key) => stringValue(raw[key]));
}

function sanitizeFileTree(tree: unknown, rowIds: Set<string>, audioMappings: AudioSourceMapping[] = []): unknown {
  if (!isRecord(tree)) {
    return undefined;
  }

  const rootPath = stringValue(tree.rootPath);
  if (rootPath && !isVirtualPath(rootPath) && !pathExists(rootPath) && audioMappings.length === 0) {
    return undefined;
  }

  const nodes = Array.isArray(tree.nodes)
    ? tree.nodes.flatMap((node) => sanitizeFileTreeNode(node, rowIds, audioMappings))
    : [];

  return {
    ...tree,
    rootPath: resolveSanitizedTreeRoot(rootPath, nodes, audioMappings),
    nodes,
  };
}

function sanitizeFileTreeNode(node: unknown, rowIds: Set<string>, audioMappings: AudioSourceMapping[] = []): unknown[] {
  if (!isRecord(node)) {
    return [];
  }

  const originalPath = stringValue(node.path);
  const mappedPath = resolveMappedAudioPath(originalPath, audioMappings);
  const path = mappedPath || originalPath;
  const kind = stringValue(node.kind);
  const children = Array.isArray(node.children)
    ? node.children.flatMap((child) => sanitizeFileTreeNode(child, rowIds, audioMappings))
    : undefined;

  if (kind === "directory") {
    if (path && !isVirtualPath(path) && !pathExists(path)) {
      return [];
    }

    return children && children.length === 0
      ? []
      : [{ ...node, path, id: mappedPath || stringValue(node.id) || path, name: mappedPath ? basename(mappedPath) : node.name, children }];
  }

  if (isVirtualPath(path)) {
    const exportRowId = stringValue(node.exportRowId) || virtualRowId(path);
    return exportRowId && rowIds.has(exportRowId) ? [node] : [];
  }

  if (!pathExists(path)) {
    return [];
  }

  return mappedPath
    ? [{ ...node, id: mappedPath, name: basename(mappedPath), path: mappedPath, meta: fileSizeMeta(mappedPath) ?? node.meta }]
    : [node];
}

function sanitizeSelectedPath(value: unknown, rowIds: Set<string>, audioMappings: AudioSourceMapping[] = []): string | undefined {
  const path = stringValue(value);
  if (!path) {
    return undefined;
  }

  if (isVirtualPath(path)) {
    const rowId = virtualRowId(path);
    return rowId && rowIds.has(rowId) ? path : undefined;
  }

  const mappedPath = resolveMappedAudioPath(path, audioMappings);
  const resolvedPath = mappedPath || path;
  return pathExists(resolvedPath) ? resolvedPath : undefined;
}

function collectTableRowIds(table: Record<string, unknown>): Set<string> {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  return new Set(rows.filter(isRecord).map((row) => stringValue(row.id)).filter(Boolean));
}

function filterRecordByKeys(value: unknown, allowedKeys: Set<string>): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).filter(([key]) => allowedKeys.has(key)));
}

function filterBatchSpeakerChecks(value: unknown, table: Record<string, unknown>): unknown {
  if (!isRecord(value)) {
    return {};
  }

  const rows = Array.isArray(table.rows) ? table.rows.filter(isRecord) : [];
  if (rows.length === 0) {
    return {};
  }

  const speakers = new Set(rows.map(readRowSpeaker).filter(Boolean));
  if (speakers.size === 0) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).filter(([key]) => speakers.has(key)));
}

function readRowSpeaker(row: Record<string, unknown>): string {
  const raw = isRecord(row.raw) ? row.raw : {};
  const cells = isRecord(row.cells) ? row.cells : {};
  return stringValue(raw.speaker) || stringValue(raw.speaker_groups) || stringValue(cells.speaker);
}

function emptyDataTable(table: unknown): Record<string, unknown> {
  const columns = isRecord(table) && Array.isArray(table.columns) ? table.columns : [];
  return { columns, rows: [] };
}

function detailsForTable(table: Record<string, unknown>): Array<Record<string, string>> {
  const columns = Array.isArray(table.columns) ? table.columns.filter(isRecord) : [];
  return columns.map((column) => ({
    label: stringValue(column.label),
    value: "-",
  }));
}

function virtualRowId(path: string): string {
  const prefix = `${virtualPathPrefix}row/`;
  if (!path.startsWith(prefix)) {
    return "";
  }

  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return "";
  }
}

function normalizeStatePath(path: string | undefined): string {
  return (path ?? "").trim().replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
