import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { DataTable, WorkspaceId, WorkspaceRunRequest } from "@shared/ipc";
import { isSupportedAudioPath, isWavAudioPath, normalizeRunAudioPath } from "./audio-paths";
import { resolveFallbackInputFolder } from "./workspace-paths";


type AudioSourceMapping = {
  sourcePath: string;
  cachedPath: string;
  isWav?: boolean;
};

type PreparedRunInput = {
  inputPath: string;
  displayInputPath: string;
  audioSourceMappings?: AudioSourceMapping[];
};

type PreparedAudioSourceMap = {
  inputPath?: string;
  originalInputPath?: string;
  mappings: AudioSourceMapping[];
};


export async function resolveRunInputPath(
  request: WorkspaceRunRequest,
  outputPath: string,
  runStamp: string,
): Promise<PreparedRunInput> {
  const sourcePaths = [...new Set((request.retry?.sourcePaths ?? []).filter((sourcePath) => sourcePath && existsSync(sourcePath) && isSupportedAudioPath(sourcePath)))];
  const displayInputPath = request.paths.inputPath;
  const audioEdits = normalizeRunAudioEdits(request.audioEdits);

  if (sourcePaths.length === 0) {
    const preparedAudioInput = audioEdits.size === 0 ? await readPreparedAudioSourceMap(request.paths.inputPath) : undefined;
    if (preparedAudioInput) {
      return {
        inputPath: request.paths.inputPath,
        displayInputPath: preparedAudioInput.originalInputPath || displayInputPath,
        audioSourceMappings: preparedAudioInput.mappings,
      };
    }

    const editedInput = audioEdits.size > 0 ? await stageEditedInputFolder(request.paths.inputPath, outputPath, runStamp, audioEdits) : undefined;
    return editedInput ?? { inputPath: request.paths.inputPath, displayInputPath };
  }

  const retryInputPath = join(outputPath, `_retry_input_${runStamp}`);
  await mkdir(retryInputPath, { recursive: true });
  const usedNames = new Set<string>();
  const retryMappings: AudioSourceMapping[] = [];
  for (const [index, sourcePath] of sourcePaths.entries()) {
    retryMappings.push(await stageRetryInputFile(sourcePath, retryInputPath, usedNames, index, resolveEditedRunSourcePath(sourcePath, audioEdits)));
  }
  return {
    inputPath: retryInputPath,
    displayInputPath,
    audioSourceMappings: retryMappings,
  };
}

async function readPreparedAudioSourceMap(inputPath: string): Promise<PreparedAudioSourceMap | undefined> {
  return readPreparedAudioSourceMapFile(join(inputPath, "audio_source_map.json"));
}

async function readPreparedAudioSourceMapFile(sourceMapPath: string): Promise<PreparedAudioSourceMap | undefined> {
  try {
    const parsed = JSON.parse(await readFile(sourceMapPath, "utf8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.mappings)) {
      return undefined;
    }

    const mappings = parsed.mappings.flatMap((item): AudioSourceMapping[] => {
      if (!isRecord(item)) {
        return [];
      }

      const sourcePath = stringValue(item.sourcePath) || stringValue(item.originalPath);
      const cachedPath = stringValue(item.cachedPath);
      const isWav = stringValue(item.isWav).toLowerCase() === "true" || isWavAudioPath(sourcePath);
      return sourcePath && cachedPath ? [{ sourcePath, cachedPath, isWav }] : [];
    });
    return mappings.length > 0
      ? { inputPath: stringValue(parsed.inputPath), originalInputPath: stringValue(parsed.originalInputPath), mappings }
      : undefined;
  } catch {
    return undefined;
  }
}

async function stageEditedInputFolder(inputPath: string, outputPath: string, runStamp: string, audioEdits: Map<string, string>): Promise<PreparedRunInput | undefined> {
  const inputRoot = resolveFallbackInputFolder(inputPath);
  let entries;
  try {
    entries = await readdir(inputRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const audioEntries = entries.filter((entry) => !entry.name.startsWith(".") && entry.isFile() && isSupportedAudioPath(join(inputRoot, entry.name)));
  if (!audioEntries.some((entry) => hasEditedRunSource(join(inputRoot, entry.name), audioEdits))) {
    return undefined;
  }

  const editedInputPath = join(outputPath, `_edited_input_${runStamp}`);
  await mkdir(editedInputPath, { recursive: true });
  const usedNames = new Set<string>();
  const mappings: AudioSourceMapping[] = [];
  for (const [index, entry] of audioEntries.entries()) {
    const sourcePath = join(inputRoot, entry.name);
    mappings.push(await stageRetryInputFile(sourcePath, editedInputPath, usedNames, index, resolveEditedRunSourcePath(sourcePath, audioEdits)));
  }

  return {
    inputPath: editedInputPath,
    displayInputPath: inputPath,
    audioSourceMappings: mappings,
  };
}

async function stageRetryInputFile(sourcePath: string, retryInputPath: string, usedNames: Set<string>, index: number, stagedSourcePath = sourcePath): Promise<AudioSourceMapping> {
  const fileName = uniqueRetryFileName(stagedAudioFileName(sourcePath, stagedSourcePath), usedNames, index);
  const targetPath = join(retryInputPath, fileName);
  try {
    await link(stagedSourcePath, targetPath);
  } catch {
    await copyFile(stagedSourcePath, targetPath);
  }
  return { sourcePath, cachedPath: targetPath };
}

function normalizeRunAudioEdits(audioEdits: WorkspaceRunRequest["audioEdits"]): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [sourcePath, editedPath] of Object.entries(audioEdits ?? {})) {
    const source = sourcePath.trim();
    const edited = editedPath.trim();
    if (!source || !edited || !existsSync(edited) || !isSupportedAudioPath(edited)) {
      continue;
    }

    normalized.set(normalizeRunAudioPath(source), edited);
  }
  return normalized;
}

function hasEditedRunSource(sourcePath: string, audioEdits: Map<string, string>): boolean {
  return audioEdits.has(normalizeRunAudioPath(sourcePath));
}

function resolveEditedRunSourcePath(sourcePath: string, audioEdits: Map<string, string>): string {
  return audioEdits.get(normalizeRunAudioPath(sourcePath)) ?? sourcePath;
}

function stagedAudioFileName(sourcePath: string, stagedSourcePath: string): string {
  const sourceExtension = extname(sourcePath);
  const stagedExtension = extname(stagedSourcePath) || sourceExtension;
  if (sourceExtension && stagedExtension && sourceExtension.toLowerCase() !== stagedExtension.toLowerCase()) {
    return `${basename(sourcePath, sourceExtension)}${stagedExtension}`;
  }
  return basename(sourcePath);
}

function uniqueRetryFileName(fileName: string, usedNames: Set<string>, index: number): string {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidate = `${stem}_${index + 1}${extension}`;
  let counter = index + 1;
  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${stem}_${counter}${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

export function restoreOriginalAudioSources(workspaceId: WorkspaceId, table: DataTable, mappings: AudioSourceMapping[] | undefined): DataTable {
  if (!mappings || mappings.length === 0) {
    return table;
  }

  return {
    ...table,
    rows: table.rows.map((row) => restoreOriginalAudioSourceRow(workspaceId, row, mappings)),
  };
}

function restoreOriginalAudioSourceRow(workspaceId: WorkspaceId, row: DataTable["rows"][number], mappings: AudioSourceMapping[]): DataTable["rows"][number] {
  const raw = { ...(row.raw ?? {}) };
  const cells = { ...row.cells };
  const mapping = findAudioSourceMapping(row, mappings);
  if (!mapping) {
    return row;
  }

  const cachedFileName = basename(mapping.cachedPath);
  const sourceFileName = basename(mapping.sourcePath);
  const restoredRaw = replaceCachedSourceValues(raw, mapping.cachedPath, mapping.sourcePath);
  const sourceKey = workspaceId === "overview" ? "absolute_path" : "originalPath";
  restoredRaw[sourceKey] = mapping.sourcePath;
  restoredRaw.cachedPath = mapping.cachedPath;
  restoredRaw.cached_path = mapping.cachedPath;
  if (restoredRaw.fileName === cachedFileName) {
    restoredRaw.fileName = sourceFileName;
  }
  if (restoredRaw.file_name === cachedFileName) {
    restoredRaw.file_name = sourceFileName;
  }

  for (const key of ["fileName", "file_name"] as const) {
    if (cells[key] === cachedFileName) {
      cells[key] = sourceFileName;
    }
  }

  const sourcePath = isSameAudioPath(row.sourcePath, mapping.cachedPath) ? mapping.sourcePath : row.sourcePath;
  return {
    ...row,
    id: isSameAudioPath(row.id, mapping.cachedPath) ? mapping.sourcePath : row.id,
    sourcePath,
    raw: restoredRaw,
    cells,
  };
}

function findAudioSourceMapping(row: DataTable["rows"][number], mappings: AudioSourceMapping[]): AudioSourceMapping | undefined {
  const raw = row.raw ?? {};
  const candidates = [
    row.sourcePath,
    raw.originalPath,
    raw.original_path,
    raw.absolute_path,
    raw.inputPath,
    raw.input_path,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return mappings.find((mapping) => candidates.some((candidate) => isSameAudioPath(candidate, mapping.cachedPath)))
    ?? mappings.find((mapping) => candidates.some((candidate) => basename(candidate) === basename(mapping.cachedPath)));
}

function replaceCachedSourceValues(raw: Record<string, string>, cachedPath: string, sourcePath: string): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, isSameAudioPath(value, cachedPath) ? sourcePath : value]));
}

function isSameAudioPath(left: string | undefined, right: string | undefined): boolean {
  return normalizeAudioPathKey(left) === normalizeAudioPathKey(right);
}

function normalizeAudioPathKey(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}