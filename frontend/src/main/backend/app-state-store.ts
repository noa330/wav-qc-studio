import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppStateLoadResult, AppStateSaveRequest, AppStateSaveResult, AppStateSnapshot, ProjectStateLoadRequest, ProjectStateLoadResult } from "@shared/ipc";
import { sanitizePersistedAppState, sanitizeProjectRecord } from "./app-state-sanitizer";
import { isNotFoundError, isRecord, pathIsDirectory, stringValue, toJsonValue } from "./app-state-store-utils";
import { defaultManagedProjectName, resolveManagedProjectsRoot } from "./project-workspaces";

const activeProjectFileName = "active-project.json";
const projectStateFileName = "project-state.json";
const appStateSchemaVersion = 1;
const activeProjectSchemaVersion = 1;
const projectStateSchemaVersion = 1;
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
