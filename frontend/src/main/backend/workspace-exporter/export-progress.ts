import { basename, join } from "node:path";
import type { FileTreeNode, FileTreeResult, WorkspaceId, WorkspaceProgress } from "@shared/ipc";
import { fileName } from "./export-paths";
import type { ExportRowOutcome } from "./types";

export function buildExportProgress(totalRows: number, outcomes: ExportRowOutcome[]): WorkspaceProgress {
  const total = Math.max(0, totalRows);
  const completed = outcomes.filter((outcome) => outcome.copied).length;
  const failed = outcomes.filter((outcome) => outcome.error).length;
  const finished = completed + failed;
  return {
    total,
    completed,
    failed,
    percent: total > 0 ? Math.round((finished / total) * 100) : 0,
  };
}

export function buildExportTree(workspaceId: WorkspaceId, rootPath: string, outcomes: ExportRowOutcome[]): FileTreeResult {
  if (workspaceId === "slice") {
    return {
      rootPath,
      nodes: groupOutcomes(outcomes, (outcome) => fileName(outcome.sourcePath) || "audio").map(([groupName, groupOutcomes]) => ({
        id: `wqcs://export/slice/${encodeURIComponent(groupName)}`,
        name: groupName,
        path: `wqcs://export/slice/${encodeURIComponent(groupName)}`,
        kind: "directory" as const,
        children: groupOutcomes.map((outcome) => buildOutcomeNode(outcome)),
      })),
    };
  }

  if (workspaceId === "batch") {
    return {
      rootPath,
      nodes: groupOutcomes(outcomes, (outcome) => outcome.row.raw?.speaker || outcome.row.raw?.speaker_groups || outcome.row.cells.speaker || "speaker_unknown").map(([groupName, groupOutcomes]) => ({
        id: `wqcs://export/batch/${encodeURIComponent(groupName)}`,
        name: groupName,
        path: `wqcs://export/batch/${encodeURIComponent(groupName)}`,
        kind: "directory" as const,
        children: groupOutcomes.map((outcome) => buildOutcomeNode(outcome)),
      })),
    };
  }

  return {
    rootPath,
    nodes: ["audio", "ng"]
      .map((bucket) => ({
        id: join(rootPath, bucket),
        name: bucket,
        path: join(rootPath, bucket),
        kind: "directory" as const,
        children: outcomes.filter((outcome) => (outcome.includeAudio ? "audio" : "ng") === bucket).map((outcome) => buildOutcomeNode(outcome)),
      }))
      .filter((node) => node.children.length > 0),
  };
}

function groupOutcomes(outcomes: ExportRowOutcome[], keyFn: (outcome: ExportRowOutcome) => string): Array<[string, ExportRowOutcome[]]> {
  const groups = new Map<string, ExportRowOutcome[]>();
  for (const outcome of outcomes) {
    const key = keyFn(outcome).trim() || "audio";
    groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }

  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, "ko"));
}

function buildOutcomeNode(outcome: ExportRowOutcome): FileTreeNode {
  return {
    id: outcome.outputPath || outcome.row.id,
    name: outcome.outputPath ? basename(outcome.outputPath) : outcome.row.cells.fileName || outcome.row.cells.file_name || outcome.row.id,
    path: outcome.outputPath || outcome.sourcePath || outcome.row.id,
    kind: "file",
    exportRowId: outcome.row.id,
    meta: outcome.includeAudio ? "audio" : "ng",
  };
}
