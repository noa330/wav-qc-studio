import { createReadStream, existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { AppStateLoadResult, AppStateSaveRequest, AppStateSaveResult, AppStateSnapshot, JsonValue, ProjectStateLoadRequest, ProjectStateLoadResult } from "@shared/ipc";
import { defaultManagedProjectName, resolveManagedProjectsRoot } from "./project-workspaces";

const activeProjectFileName = "active-project.json";
const projectStateFileName = "project-state.json";
const appStateSchemaVersion = 1;
const activeProjectSchemaVersion = 1;
const projectStateSchemaVersion = 1;
const appStateReadChunkBytes = 16 * 1024;
const virtualPathPrefix = "wqcs://";

export type AppStateLoadProgress = {
  bytesRead: number;
  totalBytes: number;
  percent: number;
};

export async function loadAppStateSnapshot(onProgress?: (progress: AppStateLoadProgress) => void): Promise<AppStateLoadResult> {
  try {
    const payload = await loadProjectStorePayload(onProgress);
    return {
      ok: true,
      snapshot: {
        schemaVersion: appStateSchemaVersion,
        savedAt: new Date().toISOString(),
        payload: toJsonValue(payload),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readStateFile(filePath: string, onProgress?: (progress: AppStateLoadProgress) => void): Promise<string> {
  const fileStat = await stat(filePath);
  if (fileStat.size === 0) {
    onProgress?.({ bytesRead: 0, totalBytes: 0, percent: 100 });
    return "";
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    const stream = createReadStream(filePath, { highWaterMark: appStateReadChunkBytes });

    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      bytesRead += chunk.length;
      onProgress?.({
        bytesRead,
        totalBytes: fileStat.size,
        percent: (bytesRead / fileStat.size) * 100,
      });
    });

    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export async function saveAppStateSnapshot(request: AppStateSaveRequest): Promise<AppStateSaveResult> {
  try {
    const projectsRoot = resolveManagedProjectsRoot();
    await mkdir(projectsRoot, { recursive: true });
    const activeProject = activeProjectRecord(request.snapshot);
    if (activeProject) {
      await writeActiveProjectFile(projectsRoot, stringValue(activeProject.name));
      await writeActiveProjectStateFile(request.snapshot, activeProject);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function saveAppStateSnapshotSync(request: AppStateSaveRequest): AppStateSaveResult {
  try {
    const projectsRoot = resolveManagedProjectsRoot();
    mkdirSync(projectsRoot, { recursive: true });
    const activeProject = activeProjectRecord(request.snapshot);
    if (activeProject) {
      writeActiveProjectFileSync(projectsRoot, stringValue(activeProject.name));
      writeActiveProjectStateFileSync(request.snapshot, activeProject);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadProjectStateSnapshot(request: ProjectStateLoadRequest): Promise<ProjectStateLoadResult> {
  try {
    const rootPath = stringValue(request.rootPath);
    if (!rootPath || !pathIsDirectory(rootPath)) {
      return { ok: false, error: "Project folder is not available." };
    }

    const state = await readProjectStateFile(rootPath);
    return state === undefined
      ? { ok: true }
      : { ok: true, state: toJsonValue(sanitizePersistedAppState(state, rootPath)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadProjectStorePayload(onProgress?: (progress: AppStateLoadProgress) => void): Promise<Record<string, unknown>> {
  const projectsRoot = resolveManagedProjectsRoot();
  await mkdir(projectsRoot, { recursive: true });
  await ensureDefaultProjectFolder(projectsRoot);

  const projects = await discoverProjectRecords(projectsRoot);
  const activeProjectName = await readActiveProjectName(projectsRoot);
  const activeProject = chooseActiveProject(projects, activeProjectName);
  const activeState = activeProject?.rootPath ? await readProjectStateFile(activeProject.rootPath, onProgress) : undefined;
  const activeProjectId = activeProject?.id ?? "";

  if (activeState === undefined) {
    onProgress?.({ bytesRead: 0, totalBytes: 0, percent: 100 });
  }

  return {
    activeProjectId,
    projects: projects.map((project) => {
      if (project.id !== activeProjectId || activeState === undefined) {
        return project;
      }

      return sanitizeProjectRecord({
        ...project,
        state: activeState,
      });
    }),
  };
}

type AudioSourceMapping = {
  sourcePath: string;
  cachedPath: string;
  isWav: boolean;
};

type ProjectRecord = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  state?: unknown;
};

async function discoverProjectRecords(projectsRoot: string): Promise<ProjectRecord[]> {
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const records = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const rootPath = join(projectsRoot, entry.name);
      const folderStat = await stat(rootPath);
      return {
        id: projectIdFromRoot(rootPath),
        name: entry.name,
        rootPath,
        createdAt: folderStat.birthtime.toISOString(),
        updatedAt: folderStat.mtime.toISOString(),
      };
    }));

  return records.sort(compareProjectRecords);
}

function compareProjectRecords(left: ProjectRecord, right: ProjectRecord): number {
  if (sameProjectName(left.name, defaultManagedProjectName)) {
    return -1;
  }
  if (sameProjectName(right.name, defaultManagedProjectName)) {
    return 1;
  }

  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

async function ensureDefaultProjectFolder(projectsRoot: string): Promise<void> {
  await mkdir(join(projectsRoot, defaultManagedProjectName), { recursive: true });
}

function chooseActiveProject(projects: ProjectRecord[], activeProjectName: string): ProjectRecord | undefined {
  return projects.find((project) => sameProjectName(project.name, activeProjectName))
    ?? projects.find((project) => sameProjectName(project.name, defaultManagedProjectName))
    ?? projects[0];
}

async function readActiveProjectName(projectsRoot: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(resolveActiveProjectPath(projectsRoot), "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return defaultManagedProjectName;
    }

    return stringValue(parsed.activeProjectName)
      || stringValue(parsed.projectName)
      || defaultManagedProjectName;
  } catch (error) {
    if (isNotFoundError(error)) {
      return defaultManagedProjectName;
    }

    throw error;
  }
}

async function readProjectStateFile(rootPath: string, onProgress?: (progress: AppStateLoadProgress) => void): Promise<unknown> {
  try {
    const parsed = JSON.parse(await readStateFile(resolveProjectStatePath(rootPath), onProgress)) as unknown;
    return unwrapProjectStateFile(parsed);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function writeActiveProjectStateFile(snapshot: AppStateSnapshot, project: Record<string, unknown>): Promise<void> {
  const rootPath = stringValue(project.rootPath);
  if (!rootPath || project.state === undefined || !pathIsDirectory(rootPath)) {
    return;
  }

  await writeProjectStateFile(rootPath, projectStatePayload(snapshot, project));
}

async function writeProjectStateFile(rootPath: string, payload: unknown): Promise<void> {
  const filePath = resolveProjectStatePath(rootPath);
  const tempPath = resolveTempProjectStatePath(rootPath);
  await writeFile(tempPath, JSON.stringify(payload), "utf8");
  await rename(tempPath, filePath);
}

function writeActiveProjectStateFileSync(snapshot: AppStateSnapshot, project: Record<string, unknown>): void {
  const rootPath = stringValue(project.rootPath);
  if (!rootPath || project.state === undefined || !pathIsDirectory(rootPath)) {
    return;
  }

  writeProjectStateFileSync(rootPath, projectStatePayload(snapshot, project));
}

function writeProjectStateFileSync(rootPath: string, payload: unknown): void {
  const filePath = resolveProjectStatePath(rootPath);
  const tempPath = resolveTempProjectStatePath(rootPath);
  writeFileSync(tempPath, JSON.stringify(payload), "utf8");
  renameSync(tempPath, filePath);
}

function projectStatePayload(snapshot: AppStateSnapshot, project: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: projectStateSchemaVersion,
    savedAt: snapshot.savedAt,
    projectId: stringValue(project.id),
    state: sanitizePersistedAppState(project.state),
  };
}

async function writeActiveProjectFile(projectsRoot: string, activeProjectName: string): Promise<void> {
  const payload = activeProjectPayload(activeProjectName);
  const filePath = resolveActiveProjectPath(projectsRoot);
  const tempPath = resolveTempActiveProjectPath(projectsRoot);
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, filePath);
}

function writeActiveProjectFileSync(projectsRoot: string, activeProjectName: string): void {
  const payload = activeProjectPayload(activeProjectName);
  const filePath = resolveActiveProjectPath(projectsRoot);
  const tempPath = resolveTempActiveProjectPath(projectsRoot);
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

function activeProjectPayload(activeProjectName: string): Record<string, unknown> {
  return {
    schemaVersion: activeProjectSchemaVersion,
    savedAt: new Date().toISOString(),
    activeProjectName: activeProjectName || defaultManagedProjectName,
  };
}

function activeProjectRecord(snapshot: AppStateSnapshot): Record<string, unknown> | undefined {
  const payload = snapshot.payload;
  if (!isRecord(payload) || !Array.isArray(payload.projects)) {
    return undefined;
  }

  const activeProjectId = stringValue(payload.activeProjectId);
  return projectRecords(snapshot).find((project) => stringValue(project.id) === activeProjectId)
    ?? projectRecords(snapshot)[0];
}

function projectIdFromRoot(rootPath: string): string {
  return `project:${encodeURIComponent(rootPath.trim().replace(/\\/gu, "/").replace(/\/+$/u, "").toLocaleLowerCase())}`;
}

function sameProjectName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function sanitizeProjectRecord(project: unknown): unknown {
  if (!isRecord(project) || project.state === undefined) {
    return project;
  }

  return {
    ...project,
    state: sanitizePersistedAppState(project.state, stringValue(project.rootPath)),
  };
}

function sanitizePersistedAppState(state: unknown, projectRoot?: string): unknown {
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

function readProjectAudioSourceMappings(projectRoot: string | undefined, workspaceId: string, inputPath: string): AudioSourceMapping[] {
  const root = stringValue(projectRoot);
  if (!root || !workspaceId || !pathIsDirectory(root)) {
    return [];
  }

  const convertedRoot = join(root, "converted-audio", workspaceId);
  if (!pathIsDirectory(convertedRoot)) {
    return [];
  }

  const normalizedInputPath = normalizeStatePath(inputPath);
  const mappings: AudioSourceMapping[] = [];
  for (const sourceMapPath of findAudioSourceMapFiles(convertedRoot)) {
    const parsed = readAudioSourceMap(sourceMapPath);
    if (!parsed || !audioSourceMapMatchesInput(parsed, normalizedInputPath)) {
      continue;
    }

    mappings.push(...parsed.mappings);
  }

  return dedupeAudioSourceMappings(mappings);
}

function findAudioSourceMapFiles(rootPath: string): string[] {
  const results: string[] = [];
  const stack = [rootPath];
  let visited = 0;
  while (stack.length > 0 && visited < 1000) {
    const directory = stack.pop();
    if (!directory) {
      continue;
    }

    visited += 1;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "audio_source_map.json") {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function readAudioSourceMap(sourceMapPath: string): { inputPath: string; originalInputPath: string; mappings: AudioSourceMapping[] } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(sourceMapPath, "utf8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.mappings)) {
      return undefined;
    }

    const mappings = parsed.mappings.flatMap((item): AudioSourceMapping[] => {
      if (!isRecord(item)) {
        return [];
      }

      const sourcePath = stringValue(item.sourcePath) || stringValue(item.originalPath);
      const cachedPath = stringValue(item.cachedPath);
      if (!sourcePath || !cachedPath) {
        return [];
      }

      return [{
        sourcePath,
        cachedPath,
        isWav: stringValue(item.isWav).toLowerCase() === "true" || isWavAudioPath(sourcePath),
      }];
    });

    return mappings.length > 0
      ? {
        inputPath: stringValue(parsed.inputPath),
        originalInputPath: stringValue(parsed.originalInputPath),
        mappings,
      }
      : undefined;
  } catch {
    return undefined;
  }
}

function audioSourceMapMatchesInput(sourceMap: { inputPath: string; originalInputPath: string; mappings: AudioSourceMapping[] }, normalizedInputPath: string): boolean {
  if (!normalizedInputPath) {
    return true;
  }

  if (normalizeStatePath(sourceMap.inputPath) === normalizedInputPath || normalizeStatePath(sourceMap.originalInputPath) === normalizedInputPath) {
    return true;
  }

  return sourceMap.mappings.some((mapping) => normalizeStatePath(dirname(mapping.sourcePath)) === normalizedInputPath || normalizeStatePath(dirname(mapping.cachedPath)) === normalizedInputPath);
}

function dedupeAudioSourceMappings(mappings: AudioSourceMapping[]): AudioSourceMapping[] {
  const seen = new Set<string>();
  return mappings.filter((mapping) => {
    const key = normalizeStatePath(mapping.sourcePath);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function resolveMappedAudioPath(path: string, audioMappings: AudioSourceMapping[]): string {
  const mapping = findAudioSourceMapping(audioMappings, path);
  if (!mapping || !pathExists(mapping.cachedPath)) {
    return "";
  }

  return mapping.cachedPath;
}

function findAudioSourceMapping(audioMappings: AudioSourceMapping[], sourcePath: string): AudioSourceMapping | undefined {
  const normalizedSourcePath = normalizeStatePath(sourcePath);
  const sourceName = basename(sourcePath).toLowerCase();
  return audioMappings.find((mapping) => normalizeStatePath(mapping.sourcePath) === normalizedSourcePath)
    ?? audioMappings.find((mapping) => normalizeStatePath(mapping.cachedPath) === normalizedSourcePath)
    ?? audioMappings.find((mapping) => basename(mapping.sourcePath).toLowerCase() === sourceName)
    ?? audioMappings.find((mapping) => basename(mapping.cachedPath).toLowerCase() === sourceName);
}

function resolveSanitizedTreeRoot(rootPath: string, nodes: unknown[], audioMappings: AudioSourceMapping[]): string {
  if (audioMappings.length === 0) {
    return rootPath;
  }

  const nodePaths = collectFileTreePaths(nodes);
  const commonNodeRoot = commonParentPath(nodePaths);
  if (commonNodeRoot) {
    return commonNodeRoot;
  }

  const mappedRoot = commonParentPath(audioMappings.filter((mapping) => pathExists(mapping.cachedPath)).map((mapping) => mapping.cachedPath));
  if (mappedRoot) {
    return mappedRoot;
  }

  return rootPath;
}

function collectFileTreePaths(nodes: unknown[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }

    if (stringValue(node.kind) === "file") {
      paths.push(stringValue(node.path));
      continue;
    }

    if (Array.isArray(node.children)) {
      paths.push(...collectFileTreePaths(node.children));
    }
  }

  return paths.filter(Boolean);
}

function commonParentPath(paths: string[]): string {
  const parentParts = paths
    .map((path) => dirname(path).replace(/\\/gu, "/").split("/").filter(Boolean))
    .filter((parts) => parts.length > 0);
  if (parentParts.length === 0) {
    return "";
  }

  const common = [...parentParts[0]];
  for (const parts of parentParts.slice(1)) {
    while (common.length > 0 && !common.every((part, index) => part.toLowerCase() === parts[index]?.toLowerCase())) {
      common.pop();
    }
  }

  return common.length > 0 ? common.join("\\") : "";
}

function fileSizeMeta(path: string): string | undefined {
  try {
    return formatFileSize(statSync(path).size);
  } catch {
    return undefined;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isWavAudioPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".wav" || extension === ".wave";
}

function normalizeStatePath(path: string | undefined): string {
  return (path ?? "").trim().replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function isRealPathCandidate(value: string): boolean {
  const path = value.trim();
  return Boolean(path && !isVirtualPath(path));
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

function isVirtualPath(path: string): boolean {
  return path.trim().toLowerCase().startsWith(virtualPathPrefix);
}

function pathExists(path: string): boolean {
  try {
    return Boolean(path && existsSync(path));
  } catch {
    return false;
  }
}

function pathIsDirectory(path: string): boolean {
  try {
    return Boolean(path && statSync(path).isDirectory());
  } catch {
    return false;
  }
}

function projectRecords(snapshot: AppStateSnapshot): Array<Record<string, unknown>> {
  const payload = snapshot.payload;
  if (!isRecord(payload) || !Array.isArray(payload.projects)) {
    return [];
  }

  return payload.projects.flatMap((project) => (isRecord(project) ? [project] : []));
}

function unwrapProjectStateFile(value: unknown): unknown {
  return isRecord(value) && value.state !== undefined ? value.state : value;
}

function resolveActiveProjectPath(projectsRoot: string): string {
  return join(projectsRoot, activeProjectFileName);
}

function resolveTempActiveProjectPath(projectsRoot: string): string {
  const token = `${Date.now()}-${process.hrtime.bigint().toString(36)}`;
  return join(projectsRoot, `${activeProjectFileName}.${process.pid}.${token}.tmp`);
}

function resolveProjectStatePath(rootPath: string): string {
  return join(rootPath, projectStateFileName);
}

function resolveTempProjectStatePath(rootPath: string): string {
  const token = `${Date.now()}-${process.hrtime.bigint().toString(36)}`;
  return join(rootPath, `${projectStateFileName}.${process.pid}.${token}.tmp`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
