import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { isRecord, pathExists, pathIsDirectory, stringValue } from "./store-utils";

export type AudioSourceMapping = {
  sourcePath: string;
  cachedPath: string;
  isWav: boolean;
};

export function readProjectAudioSourceMappings(projectRoot: string | undefined, workspaceId: string, inputPath: string): AudioSourceMapping[] {
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

export function resolveMappedAudioPath(path: string, audioMappings: AudioSourceMapping[]): string {
  const mapping = findAudioSourceMapping(audioMappings, path);
  if (!mapping || !pathExists(mapping.cachedPath)) {
    return "";
  }

  return mapping.cachedPath;
}

export function resolveSanitizedTreeRoot(rootPath: string, nodes: unknown[], audioMappings: AudioSourceMapping[]): string {
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

export function isRealPathCandidate(value: string): boolean {
  const path = value.trim();
  return Boolean(path && !isVirtualPath(path));
}

export function isVirtualPath(path: string): boolean {
  return path.trim().toLowerCase().startsWith("wqcs://");
}

export function fileSizeMeta(path: string): string | undefined {
  try {
    return formatFileSize(statSync(path).size);
  } catch {
    return undefined;
  }
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

export function findAudioSourceMapping(audioMappings: AudioSourceMapping[], sourcePath: string): AudioSourceMapping | undefined {
  const normalizedSourcePath = normalizeStatePath(sourcePath);
  const sourceName = basename(sourcePath).toLowerCase();
  return audioMappings.find((mapping) => normalizeStatePath(mapping.sourcePath) === normalizedSourcePath)
    ?? audioMappings.find((mapping) => normalizeStatePath(mapping.cachedPath) === normalizedSourcePath)
    ?? audioMappings.find((mapping) => basename(mapping.sourcePath).toLowerCase() === sourceName)
    ?? audioMappings.find((mapping) => basename(mapping.cachedPath).toLowerCase() === sourceName);
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
