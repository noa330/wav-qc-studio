import { app } from "electron";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppStateLoadResult, AppStateSaveRequest, AppStateSaveResult, AppStateSnapshot } from "@shared/ipc";

const appStateFileName = "app-state.json";
const appStateReadChunkBytes = 16 * 1024;

export type AppStateLoadProgress = {
  bytesRead: number;
  totalBytes: number;
  percent: number;
};

export async function loadAppStateSnapshot(onProgress?: (progress: AppStateLoadProgress) => void): Promise<AppStateLoadResult> {
  try {
    const raw = await readStateFile(resolveAppStatePath(), onProgress);
    const parsed = JSON.parse(raw) as unknown;
    if (!isAppStateSnapshot(parsed)) {
      return { ok: false, error: "Stored app state has an unsupported shape." };
    }

    return { ok: true, snapshot: parsed };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ok: true };
    }

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
    await writeSnapshotAtomically(request.snapshot);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function saveAppStateSnapshotSync(request: AppStateSaveRequest): AppStateSaveResult {
  try {
    writeSnapshotAtomicallySync(request.snapshot);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeSnapshotAtomically(snapshot: AppStateSnapshot): Promise<void> {
  const filePath = resolveAppStatePath();
  const tempPath = resolveTempStatePath();
  await mkdir(resolveAppStateDir(), { recursive: true });
  await writeFile(tempPath, JSON.stringify(snapshot), "utf8");
  await rename(tempPath, filePath);
}

function writeSnapshotAtomicallySync(snapshot: AppStateSnapshot): void {
  const filePath = resolveAppStatePath();
  const tempPath = resolveTempStatePath();
  mkdirSync(resolveAppStateDir(), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(snapshot), "utf8");
  renameSync(tempPath, filePath);
}

function resolveAppStateDir(): string {
  return app.getPath("userData");
}

function resolveAppStatePath(): string {
  return join(resolveAppStateDir(), appStateFileName);
}

function resolveTempStatePath(): string {
  const token = `${Date.now()}-${process.hrtime.bigint().toString(36)}`;
  return join(resolveAppStateDir(), `${appStateFileName}.${process.pid}.${token}.tmp`);
}

function isAppStateSnapshot(value: unknown): value is AppStateSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.schemaVersion === "number"
    && typeof value.savedAt === "string"
    && value.payload !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
