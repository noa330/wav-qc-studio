import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppStateLoadResult, AppStateSaveRequest, AppStateSaveResult, AppStateSnapshot, ProjectStateLoadRequest, ProjectStateLoadResult } from "@shared/ipc";
import { projectRelativePath, resolveProjectSheetStatePath } from "../project/sheet-layout";
import { defaultManagedProjectName, resolveManagedProjectsRoot } from "../project/workspaces";
import { sanitizePersistedAppState, sanitizeProjectRecord } from "./sanitizer";
import { isNotFoundError, isRecord, pathIsDirectory, stringValue, toJsonValue } from "./store-utils";

const activeProjectFileName = "active-project.json";
const projectStateFileName = "project-state.json";
const appStateSchemaVersion = 1;
const activeProjectSchemaVersion = 1;
const projectStateSchemaVersion = 1;
const sheetStateSchemaVersion = 1;
const appStateReadChunkBytes = 16 * 1024;

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
    return hydrateProjectSheetStates(rootPath, unwrapProjectStateFile(parsed));
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

  await writeProjectStateFile(rootPath, await projectStatePayloadForWrite(snapshot, project, rootPath));
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

  writeProjectStateFileSync(rootPath, projectStatePayloadForWriteSync(snapshot, project, rootPath));
}

function writeProjectStateFileSync(rootPath: string, payload: unknown): void {
  const filePath = resolveProjectStatePath(rootPath);
  const tempPath = resolveTempProjectStatePath(rootPath);
  writeFileSync(tempPath, JSON.stringify(payload), "utf8");
  renameSync(tempPath, filePath);
}

async function projectStatePayloadForWrite(snapshot: AppStateSnapshot, project: Record<string, unknown>, rootPath: string): Promise<Record<string, unknown>> {
  const state = sanitizePersistedAppState(project.state, rootPath);
  return {
    schemaVersion: projectStateSchemaVersion,
    savedAt: snapshot.savedAt,
    projectId: stringValue(project.id),
    state: await writeProjectSheetStateFiles(rootPath, state, snapshot.savedAt),
  };
}

function projectStatePayloadForWriteSync(snapshot: AppStateSnapshot, project: Record<string, unknown>, rootPath: string): Record<string, unknown> {
  const state = sanitizePersistedAppState(project.state, rootPath);
  return {
    schemaVersion: projectStateSchemaVersion,
    savedAt: snapshot.savedAt,
    projectId: stringValue(project.id),
    state: writeProjectSheetStateFilesSync(rootPath, state, snapshot.savedAt),
  };
}

async function writeProjectSheetStateFiles(rootPath: string, state: unknown, savedAt: string): Promise<unknown> {
  if (!isRecord(state) || !isRecord(state.runtime) || !isRecord(state.runtime.states)) {
    return state;
  }

  const nextStates: Record<string, unknown> = {};
  for (const [workspaceId, workspaceState] of Object.entries(state.runtime.states)) {
    nextStates[workspaceId] = await writeWorkspaceSheetStateFiles(rootPath, savedAt, workspaceId, workspaceState);
  }

  return {
    ...state,
    runtime: {
      ...state.runtime,
      states: nextStates,
    },
  };
}

function writeProjectSheetStateFilesSync(rootPath: string, state: unknown, savedAt: string): unknown {
  if (!isRecord(state) || !isRecord(state.runtime) || !isRecord(state.runtime.states)) {
    return state;
  }

  const nextStates: Record<string, unknown> = {};
  for (const [workspaceId, workspaceState] of Object.entries(state.runtime.states)) {
    nextStates[workspaceId] = writeWorkspaceSheetStateFilesSync(rootPath, savedAt, workspaceId, workspaceState);
  }

  return {
    ...state,
    runtime: {
      ...state.runtime,
      states: nextStates,
    },
  };
}

async function writeWorkspaceSheetStateFiles(rootPath: string, savedAt: string, workspaceId: string, workspaceState: unknown): Promise<unknown> {
  if (!isRecord(workspaceState) || !Array.isArray(workspaceState.sheets)) {
    return workspaceState;
  }

  const sheets = [];
  for (const sheet of workspaceState.sheets) {
    if (!isRecord(sheet)) {
      continue;
    }

    const sheetId = stringValue(sheet.id);
    if (!sheetId) {
      sheets.push(sheet);
      continue;
    }

    const statePath = resolveProjectSheetStatePath(rootPath, workspaceId, sheetId);
    const stateFile = projectRelativePath(rootPath, statePath);
    await writeSheetStateFile(statePath, sheetStatePayload(savedAt, workspaceId, sheetId, sheet));
    sheets.push(sheetReference(sheet, stateFile));
  }

  return workspaceStateReference(workspaceState, sheets);
}

function writeWorkspaceSheetStateFilesSync(rootPath: string, savedAt: string, workspaceId: string, workspaceState: unknown): unknown {
  if (!isRecord(workspaceState) || !Array.isArray(workspaceState.sheets)) {
    return workspaceState;
  }

  const sheets = workspaceState.sheets.flatMap((sheet) => {
    if (!isRecord(sheet)) {
      return [];
    }

    const sheetId = stringValue(sheet.id);
    if (!sheetId) {
      return [sheet];
    }

    const statePath = resolveProjectSheetStatePath(rootPath, workspaceId, sheetId);
    const stateFile = projectRelativePath(rootPath, statePath);
    writeSheetStateFileSync(statePath, sheetStatePayload(savedAt, workspaceId, sheetId, sheet));
    return [sheetReference(sheet, stateFile)];
  });

  return workspaceStateReference(workspaceState, sheets);
}

async function writeSheetStateFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload), "utf8");
  await rename(tempPath, filePath);
}

function writeSheetStateFileSync(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload), "utf8");
  renameSync(tempPath, filePath);
}

function sheetStatePayload(savedAt: string, workspaceId: string, sheetId: string, sheet: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: sheetStateSchemaVersion,
    savedAt,
    workspaceId,
    sheetId,
    sheet,
  };
}

function sheetReference(sheet: Record<string, unknown>, stateFile: string): Record<string, unknown> {
  return {
    id: stringValue(sheet.id),
    label: stringValue(sheet.label),
    inputPath: stringValue(sheet.inputPath),
    originalInputPath: stringValue(sheet.originalInputPath),
    outputPath: stringValue(sheet.outputPath),
    stateFile,
  };
}

function workspaceStateReference(workspaceState: Record<string, unknown>, sheets: Record<string, unknown>[]): Record<string, unknown> {
  const activeSheetId = stringValue(workspaceState.activeSheetId);
  const activeSheet = sheets.find((sheet) => stringValue(sheet.id) === activeSheetId) ?? sheets[0];
  return {
    ...workspaceState,
    inputPath: stringValue(activeSheet?.inputPath),
    originalInputPath: stringValue(activeSheet?.originalInputPath),
    outputPath: stringValue(activeSheet?.outputPath),
    inputTree: undefined,
    outputTree: undefined,
    table: { columns: [], rows: [] },
    details: [],
    selectedRowId: undefined,
    selectedRowIds: [],
    selectedFilePath: undefined,
    selectedAudioPath: undefined,
    selectedResultAudioPath: undefined,
    reviewedFilePaths: [],
    rowExportChecks: {},
    batchSpeakerChecks: {},
    lastRun: undefined,
    sheets,
  };
}

function hydrateProjectSheetStates(rootPath: string, state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.runtime) || !isRecord(state.runtime.states)) {
    return state;
  }

  const nextStates = Object.fromEntries(Object.entries(state.runtime.states).map(([workspaceId, workspaceState]) => [
    workspaceId,
    hydrateWorkspaceSheetStates(rootPath, workspaceState),
  ]));

  return {
    ...state,
    runtime: {
      ...state.runtime,
      states: nextStates,
    },
  };
}

function hydrateWorkspaceSheetStates(rootPath: string, workspaceState: unknown): unknown {
  if (!isRecord(workspaceState) || !Array.isArray(workspaceState.sheets)) {
    return workspaceState;
  }

  const sheets = workspaceState.sheets.map((sheet) => hydrateSheetState(rootPath, sheet));
  const activeSheetId = stringValue(workspaceState.activeSheetId);
  const activeSheet = sheets.find((sheet) => isRecord(sheet) && stringValue(sheet.id) === activeSheetId) ?? sheets.find(isRecord);
  return isRecord(activeSheet)
    ? {
      ...workspaceState,
      ...activeSheet,
      statusText: workspaceState.statusText,
      progressPercent: workspaceState.progressPercent,
      progress: workspaceState.progress,
      error: workspaceState.error,
      isRunning: false,
      isExporting: false,
      isBatchSpeakerRunning: false,
      terminal: workspaceState.terminal,
      terminalOpenRequestId: workspaceState.terminalOpenRequestId,
      batchFilter: workspaceState.batchFilter,
      sheets,
      activeSheetId: stringValue(activeSheet.id),
    }
    : { ...workspaceState, sheets };
}

function hydrateSheetState(rootPath: string, sheet: unknown): unknown {
  if (!isRecord(sheet)) {
    return sheet;
  }

  const stateFile = stringValue(sheet.stateFile);
  if (!stateFile) {
    return sheet;
  }

  try {
    const parsed = JSON.parse(readFileSync(join(rootPath, stateFile), "utf8")) as unknown;
    const fullSheet = isRecord(parsed) && isRecord(parsed.sheet) ? parsed.sheet : parsed;
    return isRecord(fullSheet) ? { ...sheet, ...fullSheet } : sheet;
  } catch {
    return sheet;
  }
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
