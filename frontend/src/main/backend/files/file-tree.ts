import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { AUDIO_INPUT_EXTENSIONS } from "@shared/ipc";
import type { FileTreeNode, FileTreeResult, FileTreeScanOptions, WorkspaceId } from "@shared/ipc";

const DEFAULT_WINDOW_LIMIT = 50;
const MAX_WINDOW_LIMIT = 100;
const MAX_DEPTH = 6;
const GENERATED_OUTPUT_FOLDERS = new Set(["_slicer_results", "_tagging_results", "_spica_results", "_wav_qc_results", "_batch_qc_results", "_spica_cache", "_audio_input_cache", "_converted_audio", "converted-audio"]);
const OUTPUT_EXTENSIONS = new Set([".wav", ".list", ".jsonl", ".json", ".csv", ".ckpt", ".pth", ".safetensors", ".bin"]);

export async function scanFileTree(rootPath: string, options: FileTreeScanOptions = {}): Promise<FileTreeResult> {
  const normalizedOptions = normalizeOptions(options);
  const rootStat = await stat(rootPath);

  if (!rootStat.isDirectory()) {
    return {
      rootPath,
      nodes: isAllowedFile(rootPath, normalizedOptions)
        ? [
            {
              id: rootPath,
              name: basename(rootPath),
              path: rootPath,
              kind: "file",
              meta: formatFileSize(rootStat.size),
            },
          ]
        : [],
    };
  }

  return {
    rootPath,
    ...(await readDirectoryWindow(rootPath, normalizedOptions)),
  };
}

async function readDirectoryWindow(directoryPath: string, options: Required<FileTreeScanOptions>): Promise<Pick<FileTreeResult, "nodes" | "window">> {
  const entries = await listVisibleEntries(directoryPath, options);
  const limit = clampInt(options.limit, 1, MAX_WINDOW_LIMIT);
  const targetIndex = findTargetEntryIndex(directoryPath, entries, options.targetPath);
  const requestedOffset = targetIndex >= 0
    ? targetIndex - Math.floor(limit / 2)
    : options.offset;
  const offset = clampInt(requestedOffset, 0, Math.max(0, entries.length - limit));
  const nodes = await entriesToNodes(directoryPath, entries.slice(offset, offset + limit), 0, options);
  return {
    nodes,
    window: {
      offset,
      limit,
      total: entries.length,
      hasPrevious: offset > 0,
      hasMore: offset + limit < entries.length,
    },
  };
}

async function readDirectory(directoryPath: string, depth: number, options: Required<FileTreeScanOptions>): Promise<FileTreeNode[]> {
  const visibleEntries = await listVisibleEntries(directoryPath, options);
  return entriesToNodes(directoryPath, visibleEntries.slice(0, MAX_WINDOW_LIMIT), depth, options);
}

async function listVisibleEntries(directoryPath: string, options: Required<FileTreeScanOptions>) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => options.purpose !== "input" || !GENERATED_OUTPUT_FOLDERS.has(entry.name.toLowerCase()))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "ko");
    });
}

async function entriesToNodes(directoryPath: string, entries: Awaited<ReturnType<typeof listVisibleEntries>>, depth: number, options: Required<FileTreeScanOptions>): Promise<FileTreeNode[]> {
  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    const fullPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (options.purpose === "input") {
        continue;
      }

      if (depth >= MAX_DEPTH) {
        continue;
      }

      const children = await readDirectory(fullPath, depth + 1, options);
      if (children.length === 0) {
        continue;
      }

      nodes.push({
        id: fullPath,
        name: entry.name,
        path: fullPath,
        kind: "directory",
        children,
      });
      continue;
    }

    if (!isAllowedFile(fullPath, options)) {
      continue;
    }

    const entryStat = await stat(fullPath);
    nodes.push({
      id: fullPath,
      name: entry.name,
      path: fullPath,
      kind: "file",
      meta: formatFileSize(entryStat.size),
    });
  }

  return nodes;
}

function normalizeOptions(options: FileTreeScanOptions): Required<FileTreeScanOptions> {
  return {
    workspaceId: options.workspaceId ?? "overview",
    purpose: options.purpose ?? "input",
    offset: options.offset ?? 0,
    limit: options.limit ?? DEFAULT_WINDOW_LIMIT,
    targetPath: options.targetPath ?? "",
  };
}

function findTargetEntryIndex(directoryPath: string, entries: Awaited<ReturnType<typeof listVisibleEntries>>, targetPath: string): number {
  const normalizedTarget = normalizePath(targetPath);
  if (!normalizedTarget) {
    return -1;
  }

  return entries.findIndex((entry) => {
    const entryPath = normalizePath(join(directoryPath, entry.name));
    return normalizedTarget === entryPath || normalizedTarget.startsWith(`${entryPath}${normalizePath(sep)}`);
  });
}

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").toLowerCase();
}

function clampInt(value: number, min: number, max: number): number {
  const parsed = Number(value);
  return Math.trunc(Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min)));
}

function isAllowedFile(path: string, options: Required<FileTreeScanOptions>): boolean {
  const extension = extname(path).toLowerCase();
  if (options.purpose === "output") {
    return OUTPUT_EXTENSIONS.has(extension);
  }

  return getInputExtensions(options.workspaceId).has(extension);
}

function getInputExtensions(workspaceId: WorkspaceId): Set<string> {
  if (workspaceId === "training") {
    return new Set([".list", ".jsonl", ".json"]);
  }

  return new Set(AUDIO_INPUT_EXTENSIONS);
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
