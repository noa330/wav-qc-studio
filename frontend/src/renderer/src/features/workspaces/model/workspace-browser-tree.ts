import type { DataTable, DataTableRow, FileTreeNode, FileTreeResult, WorkspaceId } from "@shared/ipc";
import { resolveInputAudioPath, rowSelectionPath } from "./workspace-runtime-selection";

export function resolveBrowserTree(workspaceId: WorkspaceId, purpose: "input" | "output", baseTree: FileTreeResult | undefined, table: DataTable, rootPath: string): FileTreeResult | undefined {
  if (purpose === "output") {
    return baseTree ?? (table.rows.length > 0
      ? {
          rootPath,
          nodes: workspaceId === "training" ? buildTrainingOutputNodes(table.rows) : buildOutputNodes(workspaceId, table.rows, rootPath),
        }
      : undefined);
  }

  const mixedInputTree = buildMixedInputTree(workspaceId, table.rows);
  if (mixedInputTree) {
    return mixedInputTree;
  }

  if (workspaceId === "slice" && table.rows.length > 0) {
    return {
      rootPath,
      nodes: buildSliceInputNodes(table.rows),
    };
  }

  if (workspaceId === "batch" && table.rows.length > 0) {
    return {
      rootPath,
      nodes: buildBatchSpeakerNodes(table.rows),
    };
  }

  return baseTree && table.rows.length > 0 ? attachExportRowIds(baseTree, table.rows) : baseTree;
}

function buildMixedInputTree(workspaceId: WorkspaceId, rows: DataTableRow[]): FileTreeResult | undefined {
  const groups = new Map<string, DataTableRow[]>();
  for (const row of rows) {
    const inputPath = resolveInputPath(row);
    const folderPath = parentPath(inputPath);
    if (!inputPath || !folderPath) {
      continue;
    }

    groups.set(folderPath, [...(groups.get(folderPath) ?? []), row]);
  }

  if (groups.size <= 1) {
    return undefined;
  }

  return {
    rootPath: "wqcs://mixed-input",
    nodes: Array.from(groups.entries())
      .sort(([left], [right]) => fileName(left).localeCompare(fileName(right), "ko"))
      .map(([folderPath, groupRows]) => ({
        id: `wqcs://mixed-input/folder/${encodeURIComponent(folderPath)}`,
        name: fileName(folderPath),
        path: folderPath,
        kind: "directory" as const,
        children: buildMixedInputFileNodes(workspaceId, groupRows),
      })),
  };
}

function buildMixedInputFileNodes(workspaceId: WorkspaceId, rows: DataTableRow[]): FileTreeNode[] {
  const groups = new Map<string, DataTableRow[]>();
  for (const row of rows) {
    const inputPath = resolveInputPath(row);
    if (!inputPath) {
      continue;
    }

    groups.set(inputPath, [...(groups.get(inputPath) ?? []), row]);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => fileName(left).localeCompare(fileName(right), "ko"))
    .map(([inputPath, groupRows]) => {
      if (workspaceId === "slice" && groupRows.length > 1) {
        return {
          id: `wqcs://mixed-input/file/${encodeURIComponent(inputPath)}`,
          name: fileName(inputPath),
          path: inputPath,
          kind: "directory" as const,
          children: groupRows
            .slice()
            .sort((left, right) => readSeconds(left, "startSec") - readSeconds(right, "startSec"))
            .map((row) => ({
              id: rowSelectionPath("slice", row) ?? row.id,
              name: `${formatTime(readSeconds(row, "startSec"))} - ${formatTime(readSeconds(row, "endSec"))}`,
              path: rowSelectionPath("slice", row) ?? inputPath,
              kind: "file" as const,
              exportRowId: row.id,
              meta: row.cells.durationSec || row.raw?.durationSec || undefined,
            })),
        };
      }

      const row = groupRows[0];
      return {
        id: inputPath,
        name: row?.cells.fileName || row?.raw?.file_name || fileName(inputPath),
        path: inputPath,
        kind: "file" as const,
        exportRowId: row?.id,
        meta: row?.cells.status || row?.cells.audioStatus || row?.raw?.status || undefined,
      };
    });
}

type OutputFileEntry = {
  path: string;
  pathParts: string[];
  row: DataTableRow;
};

function buildOutputNodes(workspaceId: WorkspaceId, rows: DataTableRow[], rootPath: string): FileTreeNode[] {
  const seen = new Set<string>();
  const entries: OutputFileEntry[] = [];

  for (const row of rows) {
    const outputPath = resolveOutputPath(workspaceId, row);
    const normalizedPath = normalizePath(outputPath);
    if (!outputPath || seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    entries.push({ path: outputPath, pathParts: pathParts(outputPath), row });
  }

  const rootParts = outputRootParts(entries, rootPath);
  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    const relativeParts = stripPathPrefix(entry.pathParts, rootParts);
    insertOutputNode(nodes, relativeParts.length > 0 ? relativeParts : [fileName(entry.path)], rootParts, entry, workspaceId);
  }
  return sortTreeNodes(nodes);
}

function buildTrainingOutputNodes(rows: DataTableRow[]): FileTreeNode[] {
  const seen = new Set<string>();
  const groups = new Map<string, DataTableRow[]>();

  for (const row of rows) {
    const outputPath = resolveOutputPath("training", row);
    const normalizedPath = normalizePath(outputPath);
    if (!outputPath || seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    const folderPath = parentPath(outputPath);
    groups.set(folderPath, [...(groups.get(folderPath) ?? []), row]);
  }

  if (groups.size <= 1) {
    return buildTrainingOutputFileNodes(rows);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => fileName(left).localeCompare(fileName(right), "ko"))
    .map(([folderPath, groupRows]) => ({
      id: `training-output-folder:${encodeURIComponent(folderPath)}`,
      name: fileName(folderPath) || "checkpoints",
      path: folderPath,
      kind: "directory" as const,
      children: buildTrainingOutputFileNodes(groupRows),
    }));
}

function buildTrainingOutputFileNodes(rows: DataTableRow[]): FileTreeNode[] {
  const seen = new Set<string>();
  const nodes: FileTreeNode[] = [];

  for (const row of rows) {
    const outputPath = resolveOutputPath("training", row);
    const normalizedPath = normalizePath(outputPath);
    if (!outputPath || seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    nodes.push({
      id: rowSelectionPath("training", row) ?? outputPath,
      name: row.cells.checkpoint || fileName(outputPath),
      path: outputPath,
      kind: "file",
      exportRowId: row.id,
      meta: trainingOutputMeta(row),
    });
  }

  return nodes.sort((left, right) => left.name.localeCompare(right.name, "ko"));
}

function trainingOutputMeta(row: DataTableRow): string {
  const unit = trainingRowUnit(row);
  return [
    row.cells.stage || row.raw?.stage,
    unit.epoch ? `epoch ${unit.epoch}` : "",
    unit.step ? `step ${unit.step}` : "",
    row.cells.status || row.raw?.status,
  ].filter(Boolean).join(" | ");
}

function trainingRowUnit(row: DataTableRow): { epoch: string; step: string } {
  const normalized = `${row.raw?.modelType ?? ""} ${row.raw?.stage ?? ""} ${row.cells.stage ?? ""}`.toLowerCase();
  if (normalized.includes("omnivoice")) {
    return { epoch: "", step: row.cells.step || row.raw?.step || "" };
  }
  if (normalized.includes("gpt-sovits") || normalized.includes("gpt") || normalized.includes("sovits")) {
    return { epoch: row.cells.epoch || row.raw?.epoch || "", step: "" };
  }
  return { epoch: row.cells.epoch || row.raw?.epoch || "", step: row.cells.step || row.raw?.step || "" };
}

function outputRootParts(entries: OutputFileEntry[], rootPath: string): string[] {
  const explicitRootParts = pathParts(rootPath);
  if (explicitRootParts.length > 0 && entries.every((entry) => hasPathPrefix(entry.pathParts, explicitRootParts))) {
    return explicitRootParts;
  }

  const parentParts = entries.map((entry) => entry.pathParts.slice(0, -1)).filter((parts) => parts.length > 0);
  if (parentParts.length === 0) {
    return [];
  }

  const common = [...parentParts[0]];
  for (const parts of parentParts.slice(1)) {
    while (common.length > 0 && !hasPathPrefix(parts, common)) {
      common.pop();
    }
  }
  return common;
}

function insertOutputNode(nodes: FileTreeNode[], relativeParts: string[], rootParts: string[], entry: OutputFileEntry, workspaceId: WorkspaceId): void {
  let current = nodes;
  for (let index = 0; index < relativeParts.length - 1; index += 1) {
    const name = relativeParts[index];
    const directoryParts = [...rootParts, ...relativeParts.slice(0, index + 1)];
    let directory = current.find((node) => node.kind === "directory" && node.name === name);
    if (!directory) {
      directory = {
        id: `output-folder:${makePath(directoryParts)}`,
        name,
        path: makePath(directoryParts),
        kind: "directory",
        children: [],
      };
      current.push(directory);
    }
    current = directory.children ?? [];
    directory.children = current;
  }

  const row = entry.row;
  const outputPath = entry.path;
  current.push({
    id: rowSelectionPath(workspaceId, row) ?? outputPath,
    name: workspaceId === "training" ? row.cells.checkpoint || fileName(outputPath) : row.cells.fileName || row.raw?.fileName || fileName(outputPath),
    path: outputPath,
    kind: "file",
    exportRowId: row.id,
    meta: row.cells.status || row.cells.audioStatus || row.raw?.status || undefined,
  });
}

function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .map((node) => node.kind === "directory" ? { ...node, children: sortTreeNodes(node.children ?? []) } : node)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "ko");
    });
}

function stripPathPrefix(parts: string[], prefix: string[]): string[] {
  return hasPathPrefix(parts, prefix) ? parts.slice(prefix.length) : parts;
}

function hasPathPrefix(parts: string[], prefix: string[]): boolean {
  return prefix.length <= parts.length && prefix.every((part, index) => part.toLowerCase() === parts[index].toLowerCase());
}

function pathParts(path: string): string[] {
  return path.replace(/\\/gu, "/").split("/").filter(Boolean);
}

function makePath(parts: string[]): string {
  return parts.join("/");
}

function buildSliceInputNodes(rows: DataTableRow[]): FileTreeNode[] {
  const groups = new Map<string, DataTableRow[]>();
  for (const row of rows) {
    const inputPath = resolveInputPath(row);
    if (!inputPath) {
      continue;
    }

    groups.set(inputPath, [...(groups.get(inputPath) ?? []), row]);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => fileName(left).localeCompare(fileName(right), "ko"))
    .map(([inputPath, groupRows]) => ({
      id: `wqcs://slice/file/${encodeURIComponent(inputPath)}`,
      name: fileName(inputPath),
      path: inputPath,
      kind: "directory" as const,
      children: groupRows
        .slice()
        .sort((left, right) => readSeconds(left, "startSec") - readSeconds(right, "startSec"))
        .map((row) => ({
          id: rowSelectionPath("slice", row) ?? row.id,
          name: `${formatTime(readSeconds(row, "startSec"))} - ${formatTime(readSeconds(row, "endSec"))}`,
          path: rowSelectionPath("slice", row) ?? inputPath,
          kind: "file" as const,
          exportRowId: row.id,
          meta: row.cells.durationSec || row.raw?.durationSec || undefined,
        })),
    }));
}

function buildBatchSpeakerNodes(rows: DataTableRow[]): FileTreeNode[] {
  const groups = new Map<string, DataTableRow[]>();
  for (const row of rows) {
    const speaker = row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "speaker_unknown";
    groups.set(speaker, [...(groups.get(speaker) ?? []), row]);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right, "ko"))
    .map(([speaker, groupRows]) => ({
      id: `wqcs://batch/speaker/${encodeURIComponent(speaker)}`,
      name: speaker,
      path: `wqcs://batch/speaker/${encodeURIComponent(speaker)}`,
      kind: "directory" as const,
      children: groupRows
        .slice()
        .sort((left, right) => (left.cells.fileName || "").localeCompare(right.cells.fileName || "", "ko"))
        .map((row) => {
          const inputPath = resolveInputPath(row);
          return {
            id: inputPath || row.id,
            name: row.cells.fileName || row.raw?.file_name || fileName(inputPath) || row.id,
            path: inputPath || rowSelectionPath("batch", row) || row.id,
            kind: "file" as const,
            exportRowId: row.id,
            meta: row.cells.language || row.raw?.language || undefined,
          };
        }),
    }));
}

function resolveInputPath(row: DataTableRow): string {
  return resolveInputAudioPath(row);
}

function resolveOutputPath(workspaceId: WorkspaceId, row: DataTableRow): string {
  if (workspaceId === "training") {
    return row.raw?.checkpointPath || row.raw?.checkpoint_path || row.raw?.outputPath || "";
  }

  if (workspaceId === "batch") {
    return row.raw?.outputAudioPath || row.raw?.output_audio_path || "";
  }

  if (workspaceId === "speaker") {
    return row.raw?.finalOutputPath || row.raw?.sidonOutputPath || row.raw?.resembleOutputPath || row.raw?.voiceFixerOutputPath || "";
  }

  if (workspaceId === "slice" || workspaceId === "tagging") {
    return row.raw?.outputPath || row.raw?.output_path || "";
  }

  return "";
}

function attachExportRowIds(tree: FileTreeResult, rows: DataTableRow[]): FileTreeResult {
  return {
    ...tree,
    nodes: tree.nodes.map((node) => attachExportRowId(node, rows)),
  };
}

function attachExportRowId(node: FileTreeNode, rows: DataTableRow[]): FileTreeNode {
  if (node.kind === "directory") {
    return {
      ...node,
      children: node.children?.map((child) => attachExportRowId(child, rows)),
    };
  }

  const matchingRow = rows.find((row) => normalizePath(resolveInputPath(row)) === normalizePath(node.path) || fileName(resolveInputPath(row)) === fileName(node.path));
  return matchingRow ? { ...node, exportRowId: matchingRow.id } : node;
}

function readSeconds(row: DataTableRow, key: string): number {
  const value = row.raw?.[key] || row.cells[key] || "";
  const timeMatch = value.match(/^(\d+):(\d+(?:\.\d+)?)$/u);
  if (timeMatch) {
    return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }

  const parsed = Number(value.replace(/[^0-9.+-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").toLowerCase();
}
