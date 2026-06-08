import { existsSync, readdirSync, type Dirent } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { WAV_AUDIO_EXTENSIONS } from "@shared/ipc";
import type { DataTableRow, WorkspaceExportRequest, WorkspaceId } from "@shared/ipc";
import { resolveProjectSheetOutputPath } from "../project/sheet-layout";
import type { ExportRowOutcome } from "./types";

export function formatExportStatus(outcome: ExportRowOutcome): string {
  if (outcome.mutedIntervals && outcome.mutedIntervals > 0) {
    return `OK muted=${outcome.mutedIntervals}`;
  }

  return "OK";
}

export function resolveEditedExportPath(request: WorkspaceExportRequest, sourcePath: string): string {
  if (!sourcePath) {
    return "";
  }

  const audioEdits = request.audioEdits ?? {};
  const normalizedSource = normalizeExportAudioPath(sourcePath);
  for (const [basePath, editedPath] of Object.entries(audioEdits)) {
    if (normalizeExportAudioPath(basePath) !== normalizedSource) {
      continue;
    }

    return editedPath && existsSync(editedPath) ? editedPath : sourcePath;
  }

  return sourcePath;
}

function normalizeExportAudioPath(path: string): string {
  return path.trim().replace(/\\/gu, "/").toLowerCase();
}

export function resolveRowAudioPath(workspaceId: WorkspaceId, row: DataTableRow, inputPath: string): string {
  const raw = row.raw ?? {};
  const cachedCandidates = [raw.cachedPath, raw.cached_path];
  const candidates =
    workspaceId === "speaker"
      ? [raw.finalOutputPath, raw.sidonOutputPath, raw.resembleOutputPath, raw.voiceFixerOutputPath, raw.outputPath, raw.outputAudioPath, ...cachedCandidates, row.sourcePath, raw.originalPath, raw.original_path, raw.absolute_path]
      : workspaceId === "slice"
        ? [...cachedCandidates, raw.originalPath, raw.original_path, raw.absolute_path, raw.inputPath, raw.input_path, row.sourcePath, raw.outputPath]
        : workspaceId === "tagging"
          ? [raw.outputPath, raw.outputAudioPath, ...cachedCandidates, row.sourcePath, raw.originalPath, raw.original_path, raw.absolute_path]
          : [raw.outputAudioPath, raw.outputPath, ...cachedCandidates, raw.absolute_path, raw.originalPath, raw.original_path, row.sourcePath];

  for (const candidate of candidates) {
    const resolved = resolveCandidatePath(candidate, inputPath);
    const wavPath = resolveUsableWavePath(resolved, inputPath);
    if (wavPath) {
      return wavPath;
    }
  }

  const fallback = resolveCandidatePath(candidates.find((candidate) => candidate && candidate.trim()), inputPath);
  return resolveUsableWavePath(fallback, inputPath) || fallback;
}

function resolveCandidatePath(value: string | undefined, inputPath: string): string {
  const candidate = value?.trim() ?? "";
  if (!candidate) {
    return "";
  }

  if (isAbsolute(candidate)) {
    return candidate;
  }

  return join(resolveFallbackInputFolder(inputPath), candidate);
}

function resolveUsableWavePath(candidatePath: string, inputPath: string): string {
  if (!candidatePath) {
    return "";
  }

  if (isWavAudioPath(candidatePath) && existsSync(candidatePath)) {
    return candidatePath;
  }

  return resolveCachedWavPath(candidatePath, inputPath);
}

function resolveCachedWavPath(sourcePath: string, inputPath: string): string {
  const expectedName = convertedWavFileName(sourcePath);
  if (!expectedName) {
    return "";
  }

  const roots = [resolveFallbackInputFolder(inputPath)];
  for (const root of roots) {
    if (!root || !existsSync(root)) {
      continue;
    }
    const found = findFileByName(root, expectedName);
    if (found) {
      return found;
    }
  }
  return "";
}

function convertedWavFileName(sourcePath: string): string {
  const extension = extname(sourcePath).toLowerCase();
  if (!extension || isWavAudioPath(sourcePath)) {
    return basename(sourcePath);
  }
  return `(${extension.slice(1)})${basename(sourcePath, extension)}.wav`;
}

function findFileByName(root: string, fileName: string): string {
  const wanted = fileName.toLowerCase();
  const stack = [root];
  let visited = 0;
  while (stack.length > 0 && visited < 50000) {
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
      if (entry.isFile() && entry.name.toLowerCase() === wanted) {
        return fullPath;
      }
    }
  }
  return "";
}

function isWavAudioPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return WAV_AUDIO_EXTENSIONS.includes(extension as (typeof WAV_AUDIO_EXTENSIONS)[number]);
}

export function createExportFileName(workspaceId: WorkspaceId, row: DataTableRow, index: number, sourcePath: string, usedNames: Set<string>): string {
  const extension = extname(sourcePath) || ".wav";
  const rawName = row.cells.fileName || row.cells.file_name || row.raw?.fileName || row.raw?.file_name || basename(sourcePath, extension);
  const stem = sanitizeFileName(basename(rawName, extname(rawName) || extension));
  const indexLabel = sanitizeFileName(row.raw?.index || row.cells.index || String(index));
  const prefix = indexLabel.padStart(6, "0");
  const sliceSuffix =
    workspaceId === "slice" && hasSliceRange(row)
      ? `_slice_${milliseconds(readRowSeconds(row, "startSec"))}_${milliseconds(readRowSeconds(row, "endSec"))}`
      : "";
  let candidate = `${prefix}_${stem}${sliceSuffix}${extension}`;
  let duplicateIndex = 1;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${prefix}_${stem}${sliceSuffix}_${duplicateIndex}${extension}`;
    duplicateIndex += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function hasSliceRange(row: DataTableRow): boolean {
  const startSec = readRowSeconds(row, "startSec");
  const endSec = readRowSeconds(row, "endSec");
  return endSec > startSec;
}

export function readRowSeconds(row: DataTableRow, key: string): number {
  return parseSeconds(row.raw?.[key] ?? row.cells[key]);
}

function parseSeconds(value: string | undefined): number {
  const text = value?.trim() ?? "";
  if (!text) {
    return 0;
  }

  const timeMatch = text.match(/^(\d+):(\d+(?:\.\d+)?)$/u);
  if (timeMatch) {
    return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }

  const numberMatch = text.match(/-?\d+(?:\.\d+)?/u);
  const parsed = numberMatch ? Number(numberMatch[0]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function milliseconds(seconds: number): string {
  return String(Math.max(0, Math.round(seconds * 1000))).padStart(8, "0");
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1f]+/gu, "_").replace(/\s+/gu, "_").replace(/^\.+/u, "").trim();
  return (cleaned || "audio").slice(0, 96);
}

export function fileName(path: string): string {
  return path ? basename(path) : "";
}

export function resolveOutputDirectory(workspaceId: WorkspaceId, inputPath: string, requestedOutputPath: string | undefined, projectRoot: string | undefined, expectedLeafName: string, sheetId?: string): string {
  const baseInput = resolveFallbackInputFolder(inputPath);
  const candidate = requestedOutputPath?.trim();
  if (!candidate) {
    const sheetOutputPath = resolveProjectSheetOutputPath(projectRoot, workspaceId, sheetId, expectedLeafName);
    if (sheetOutputPath) {
      return sheetOutputPath;
    }

    if (projectRoot?.trim()) {
      return join(projectRoot.trim(), "exports", workspaceId, expectedLeafName);
    }

    return join(baseInput, expectedLeafName);
  }

  const trimmed = candidate.replace(/[\\/]+$/u, "");
  return basename(trimmed).toLowerCase() === expectedLeafName.toLowerCase() ? trimmed : join(trimmed, expectedLeafName);
}

function resolveFallbackInputFolder(inputPath: string): string {
  if (!inputPath) {
    return process.cwd();
  }

  if (!existsSync(inputPath)) {
    return process.cwd();
  }

  return extname(inputPath) ? dirname(inputPath) : inputPath;
}

export function timestamp(): string {
  const now = new Date();
  const date = [now.getFullYear(), `${now.getMonth() + 1}`.padStart(2, "0"), `${now.getDate()}`.padStart(2, "0")].join("");
  const time = [`${now.getHours()}`.padStart(2, "0"), `${now.getMinutes()}`.padStart(2, "0"), `${now.getSeconds()}`.padStart(2, "0")].join("");
  return `${date}_${time}`;
}
