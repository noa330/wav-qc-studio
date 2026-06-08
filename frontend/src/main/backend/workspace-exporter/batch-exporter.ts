import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceExportRequest, WorkspaceExportResult, WorkspaceProgress } from "@shared/ipc";
import { scanFileTree } from "../files/file-tree";
import { runPythonPlan } from "../process/python-runner";
import { createBackendLayout } from "../project/layout";
import { readWorkspaceDetails, readWorkspaceTable } from "../workspace-results/readers";
import { fileName, resolveEditedExportPath, resolveOutputDirectory, resolveRowAudioPath, timestamp } from "./export-paths";
import type { WorkspaceExportProgressHandler } from "./types";

export async function exportBatchWorkspace(request: WorkspaceExportRequest, expectedLeafName: string, onProgress?: WorkspaceExportProgressHandler, signal?: AbortSignal): Promise<WorkspaceExportResult> {
  const outputRoot = resolveOutputDirectory(request.workspaceId, request.paths.inputPath, request.paths.outputPath, request.paths.projectRoot, expectedLeafName, request.paths.sheetId);
  const runStamp = timestamp();
  const requestPath = join(outputRoot, `batch_qc_export_request_${runStamp}.json`);
  const manifestPath = join(outputRoot, `batch_qc_export_${runStamp}.json`);
  const logPath = join(outputRoot, `batch_qc_export_${runStamp}.log`);
  const jobs = buildBatchExportJobs(request);
  const initialDetails = await readWorkspaceDetails(request.workspaceId, request.table);

  if (jobs.length === 0) {
    throw new Error("Script export has no checked rows.");
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    requestPath,
    JSON.stringify(
      {
        exportFormat: normalizeBatchExportFormat(request.settings.batch.exportFormat),
        inputFolder: request.paths.inputPath,
        jobs,
      },
      null,
      2,
    ),
    "utf8",
  );

  onProgress?.({
    workspaceId: request.workspaceId,
    outputPath: outputRoot,
    table: request.table,
    details: initialDetails,
    progress: normalizeExportProgress({ total: jobs.length, completed: 0, failed: 0 }),
  });

  const layout = createBackendLayout({ markerScript: "batch_qc_main.py", venvFolder: ".venv" });
  const outcome = await runPythonPlan({
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath: request.paths.inputPath,
    outputPath: outputRoot,
    manifestPath,
    logPath,
    args: [layout.scriptPath, "export", "--request", requestPath, "--output-dir", outputRoot, "--manifest", manifestPath, "--log", logPath],
    signal,
  });

  const manifest = await readJsonRecordIfExists(manifestPath);
  const datasetDir = stringValue(manifest.datasetDir) || outputRoot;
  const table = existsSync(manifestPath) ? await readWorkspaceTable(request.workspaceId, outputRoot, manifestPath) : request.table;
  const details = await readWorkspaceDetails(request.workspaceId, table);
  const outputTree = existsSync(datasetDir) ? await scanFileTree(datasetDir, { workspaceId: request.workspaceId, purpose: "output" }) : undefined;
  const progress = readBatchExportProgress(manifest, jobs.length);
  const cancelled = Boolean(signal?.aborted) || outcome.exitCode === 130;
  const ok = !cancelled && outcome.exitCode === 0 && progress.failed === 0;

  onProgress?.({
    workspaceId: request.workspaceId,
    outputPath: datasetDir,
    outputTree,
    table,
    details,
    progress,
  });

  return {
    ok,
    workspaceId: request.workspaceId,
    error: ok || cancelled ? undefined : outcome.stderr || "Script export failed. Check the log file.",
    cancelled,
    outputPath: datasetDir,
    logPath,
    table,
    details,
    outputTree,
    progress,
  };
}

function buildBatchExportJobs(request: WorkspaceExportRequest): Array<{
  id: string;
  fileName: string;
  originalPath: string;
  transcript: string;
  language: string;
  speaker: string;
}> {
  const decisions = new Map(request.rowDecisions.map((decision) => [decision.rowId, decision.includeAudio]));
  return request.table.rows
    .filter((row) => decisions.get(row.id) !== false)
    .map((row, index) => {
      const sourcePath = resolveRowAudioPath(request.workspaceId, row, request.paths.inputPath);
      const exportSourcePath = resolveEditedExportPath(request, sourcePath) || sourcePath;
      return {
        id: row.id || `${index + 1}`,
        fileName: row.raw?.fileName || row.raw?.file_name || row.cells.fileName || row.cells.file_name || fileName(sourcePath) || `row_${index + 1}.wav`,
        originalPath: exportSourcePath,
        transcript: row.cells.editedTranscript || row.raw?.editedTranscript || row.raw?.edited_transcript || row.raw?.transcript || row.cells.autoTranscript || row.cells.transcript || "",
        language: row.raw?.language || row.cells.language || "",
        speaker: row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "speaker_unknown",
      };
    });
}

function normalizeBatchExportFormat(value: string): "gsv" | "omni" {
  const normalized = value.trim().toLowerCase();
  return normalized === "omni" || normalized === "omnivoice" ? "omni" : "gsv";
}

function readBatchExportProgress(manifest: Record<string, unknown>, totalJobs: number): WorkspaceProgress {
  const summary = isRecord(manifest.summary) ? manifest.summary : {};
  return normalizeExportProgress({
    total: numberValue(summary.totalFiles, totalJobs),
    completed: numberValue(summary.completed, 0),
    failed: numberValue(summary.failed, 0),
    percent: numberValue(summary.progress, Number.NaN) * 100,
  });
}

function normalizeExportProgress(progress: { total: number; completed: number; failed: number; percent?: number }): WorkspaceProgress {
  const total = Math.max(0, Math.trunc(progress.total));
  const completed = Math.max(0, Math.trunc(progress.completed));
  const failed = Math.max(0, Math.trunc(progress.failed));
  const finished = Math.min(total || completed + failed, completed + failed);
  const rawPercent = Number.isFinite(progress.percent) ? progress.percent ?? 0 : total > 0 ? (finished / total) * 100 : 0;
  return {
    total,
    completed,
    failed,
    percent: Math.max(0, Math.min(100, Math.round(rawPercent))),
  };
}

async function readJsonRecordIfExists(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) {
    return {};
  }

  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text.replace(/^\uFEFF/u, "")) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
