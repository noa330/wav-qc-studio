import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { WorkspaceId } from "@shared/ipc";
import { resolveManagedProjectsRoot } from "../project-workspaces";
import { resolveFallbackInputFolder } from "./workspace-paths";

const AUDIO_INPUT_CONVERSION_FOLDER = "converted-audio";
const LOCAL_AUDIO_INPUT_CONVERSION_FOLDER = "_converted_audio";
const activeAudioCachesFileName = "active-audio-caches.json";
const activeAudioCachesSchemaVersion = 1;
const audioConversionSelections = new Map<WorkspaceId, ActiveAudioCacheRecord>();
const audioConversionWorkspaceIds = new Set<WorkspaceId>(["slice", "tagging", "speaker", "overview", "batch", "training", "inference"]);

type ActiveAudioCacheRecord = {
  workspaceId: WorkspaceId;
  projectRoot: string;
  inputRoot: string;
  cacheRoot: string;
  activeCachePath: string;
  updatedAt: string;
};

export function cleanupInactiveAudioConversionCaches(): void {
  const records = mergeActiveAudioCacheRecords(readActiveAudioCacheRecordsSync(), Array.from(audioConversionSelections.values()));
  const activeByCacheRoot = new Map<string, Set<string>>();
  for (const record of records) {
    const cacheRoot = resolve(record.cacheRoot);
    const activeCachePath = resolve(record.activeCachePath);
    if (!isSafeAudioConversionCacheRoot(cacheRoot) || !pathIsInside(activeCachePath, cacheRoot)) {
      continue;
    }

    const key = normalizeCachePath(cacheRoot);
    activeByCacheRoot.set(key, activeByCacheRoot.get(key) ?? new Set<string>());
    activeByCacheRoot.get(key)?.add(normalizeCachePath(activeCachePath));
  }

  for (const cacheRoot of collectKnownAudioConversionRoots(records)) {
    cleanupInactiveAudioConversionRoot(cacheRoot, activeByCacheRoot.get(normalizeCachePath(cacheRoot)) ?? new Set<string>());
  }
}

export async function recordActiveAudioConversionCache(workspaceId: WorkspaceId, inputPath: string, activeCachePath: string, projectRoot?: string): Promise<void> {
  const inputRoot = resolveFallbackInputFolder(inputPath);
  const cacheRoot = resolveAudioInputConversionRoot(workspaceId, inputPath, projectRoot);
  const record: ActiveAudioCacheRecord = {
    workspaceId,
    projectRoot: projectRoot?.trim() || "",
    inputRoot,
    cacheRoot,
    activeCachePath,
    updatedAt: new Date().toISOString(),
  };
  audioConversionSelections.set(workspaceId, record);
  await writeActiveAudioCacheRecords(mergeActiveAudioCacheRecords(readActiveAudioCacheRecordsSync(), [record]));
}

export function resolveAudioInputConversionDirectory(workspaceId: WorkspaceId, inputPath: string, projectRoot?: string): string {
  const inputRoot = resolveFallbackInputFolder(inputPath);
  const name = sanitizeCacheFolderName(basename(inputRoot) || "input");
  const key = createHash("sha1").update(inputRoot.replace(/\\/gu, "/").toLowerCase()).digest("hex").slice(0, 12);
  return join(resolveAudioInputConversionRoot(workspaceId, inputPath, projectRoot), `${name}_${key}`);
}

function resolveAudioInputConversionRoot(workspaceId: WorkspaceId, inputPath: string, projectRoot?: string): string {
  const inputRoot = resolveFallbackInputFolder(inputPath);
  const projectConversionRoot = projectRoot?.trim()
    ? join(projectRoot.trim(), AUDIO_INPUT_CONVERSION_FOLDER)
    : join(inputRoot, LOCAL_AUDIO_INPUT_CONVERSION_FOLDER);
  return join(projectConversionRoot, workspaceId);
}

function isSafeAudioConversionCacheRoot(cacheRoot: string): boolean {
  const leaf = basename(cacheRoot).toLowerCase();
  const parent = basename(dirname(cacheRoot)).toLowerCase();
  return audioConversionWorkspaceIds.has(leaf as WorkspaceId) && (parent === AUDIO_INPUT_CONVERSION_FOLDER || parent === LOCAL_AUDIO_INPUT_CONVERSION_FOLDER);
}

function collectKnownAudioConversionRoots(records: ActiveAudioCacheRecord[]): string[] {
  const roots = new Set(records.map((record) => record.cacheRoot).filter(Boolean));
  const projectRoots = new Set(records.map((record) => record.projectRoot).filter(Boolean));

  try {
    for (const entry of readdirSync(resolveManagedProjectsRoot(), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        projectRoots.add(join(resolveManagedProjectsRoot(), entry.name));
      }
    }
  } catch {
    // Project discovery is best-effort during shutdown.
  }

  for (const projectRoot of projectRoots) {
    for (const workspaceId of audioConversionWorkspaceIds) {
      roots.add(join(projectRoot, AUDIO_INPUT_CONVERSION_FOLDER, workspaceId));
    }
  }

  return Array.from(roots)
    .map((root) => resolve(root))
    .filter((root) => isSafeAudioConversionCacheRoot(root));
}

function cleanupInactiveAudioConversionRoot(cacheRoot: string, activeCachePaths: Set<string>): void {
  const resolvedRoot = resolve(cacheRoot);
  if (!isSafeAudioConversionCacheRoot(resolvedRoot) || !existsSync(resolvedRoot)) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(resolvedRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const cachePath = resolve(resolvedRoot, entry.name);
    if (activeCachePaths.has(normalizeCachePath(cachePath))) {
      continue;
    }

    try {
      rmSync(cachePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } catch {
      // Shutdown cleanup must never block app exit; locked caches are retried next run.
    }
  }
}

function readActiveAudioCacheRecordsSync(): ActiveAudioCacheRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(resolveActiveAudioCachesPath(), "utf8")) as unknown;
    const records = isRecord(parsed) && Array.isArray(parsed.records) ? parsed.records : [];
    return records.flatMap((record): ActiveAudioCacheRecord[] => {
      if (!isRecord(record)) {
        return [];
      }

      const workspaceId = stringValue(record.workspaceId) as WorkspaceId;
      const cacheRoot = stringValue(record.cacheRoot);
      const activeCachePath = stringValue(record.activeCachePath);
      if (!audioConversionWorkspaceIds.has(workspaceId) || !cacheRoot || !activeCachePath) {
        return [];
      }

      return [{
        workspaceId,
        projectRoot: stringValue(record.projectRoot),
        inputRoot: stringValue(record.inputRoot),
        cacheRoot,
        activeCachePath,
        updatedAt: stringValue(record.updatedAt),
      }];
    });
  } catch {
    return [];
  }
}

async function writeActiveAudioCacheRecords(records: ActiveAudioCacheRecord[]): Promise<void> {
  const projectsRoot = resolveManagedProjectsRoot();
  await mkdir(projectsRoot, { recursive: true });
  const payload = {
    schemaVersion: activeAudioCachesSchemaVersion,
    savedAt: new Date().toISOString(),
    records,
  };
  const filePath = resolveActiveAudioCachesPath();
  const tempPath = join(projectsRoot, `${activeAudioCachesFileName}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, filePath);
}

function mergeActiveAudioCacheRecords(existing: ActiveAudioCacheRecord[], updates: ActiveAudioCacheRecord[]): ActiveAudioCacheRecord[] {
  const records = new Map(existing.map((record) => [activeAudioCacheRecordKey(record), record]));
  for (const update of updates) {
    records.set(activeAudioCacheRecordKey(update), update);
  }
  return Array.from(records.values());
}

function activeAudioCacheRecordKey(record: ActiveAudioCacheRecord): string {
  return `${normalizeCachePath(record.projectRoot)}|${record.workspaceId}`;
}

function resolveActiveAudioCachesPath(): string {
  return join(resolveManagedProjectsRoot(), activeAudioCachesFileName);
}

function pathIsInside(path: string, parentPath: string): boolean {
  const normalizedPath = normalizeCachePath(resolve(path));
  const normalizedParent = normalizeCachePath(resolve(parentPath));
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

function sanitizeCacheFolderName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/gu, "_").replace(/\s+/gu, "_").replace(/^\.+/u, "").slice(0, 48) || "input";
}

function normalizeCachePath(path: string): string {
  return path.trim().replace(/\\/gu, "/").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
