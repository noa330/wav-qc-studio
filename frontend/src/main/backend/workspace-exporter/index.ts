import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DetailField, WorkspaceExportRequest, WorkspaceExportResult, WorkspaceId } from "@shared/ipc";
import { cropWaveFileToPath } from "../audio/audio-crop";
import { readWorkspaceDetails } from "../workspace-results/readers";
import { exportBatchWorkspace } from "./batch-exporter";
import { buildCsv, buildLog } from "./export-formatters";
import { createExportFileName, hasSliceRange, readRowSeconds, resolveEditedExportPath, resolveOutputDirectory, resolveRowAudioPath, timestamp } from "./export-paths";
import { buildExportProgress, buildExportTree } from "./export-progress";
import type { ExportRowOutcome, WorkspaceExportProgressHandler } from "./types";

const OUTPUT_FOLDERS: Record<WorkspaceId, string> = {
  slice: "_slicer_results",
  tagging: "_tagging_results",
  speaker: "_spica_results",
  overview: "_wav_qc_results",
  batch: "_batch_qc_results",
  training: "_training_results",
  inference: "_voice_inference_results",
};

export async function exportWorkspace(request: WorkspaceExportRequest, onProgress?: WorkspaceExportProgressHandler, signal?: AbortSignal): Promise<WorkspaceExportResult> {
  if (request.workspaceId === "batch") {
    return exportBatchWorkspace(request, OUTPUT_FOLDERS.batch, onProgress, signal);
  }

  const outputRoot = resolveOutputDirectory(request.workspaceId, request.paths.inputPath, request.paths.outputPath, request.paths.projectRoot, OUTPUT_FOLDERS[request.workspaceId]);
  const sessionName = timestamp();
  const sessionPath = join(outputRoot, sessionName);
  const audioDir = join(sessionPath, "audio");
  const ngDir = join(sessionPath, "ng");
  const csvPath = join(sessionPath, `${request.workspaceId}_results.csv`);
  const logPath = join(sessionPath, `${request.workspaceId}_export.log`);
  const decisions = new Map(request.rowDecisions.map((decision) => [decision.rowId, decision.includeAudio]));
  const usedNames = new Set<string>();
  const details = await readWorkspaceDetails(request.workspaceId, request.table);
  const totalRows = request.table.rows.length;

  await mkdir(audioDir, { recursive: true });
  await mkdir(ngDir, { recursive: true });

  const outcomes: ExportRowOutcome[] = [];
  for (const [index, row] of request.table.rows.entries()) {
    if (signal?.aborted) {
      break;
    }

    const includeAudio = decisions.get(row.id) !== false;
    const sourcePath = resolveRowAudioPath(request.workspaceId, row, request.paths.inputPath);
    const exportSourcePath = resolveEditedExportPath(request, sourcePath);
    const targetDir = includeAudio ? audioDir : ngDir;
    const targetPath = sourcePath ? join(targetDir, createExportFileName(request.workspaceId, row, index + 1, sourcePath, usedNames)) : "";
    const outcome: ExportRowOutcome = {
      row,
      includeAudio,
      sourcePath,
      outputPath: targetPath,
      copied: false,
    };

    try {
      if (!exportSourcePath || !existsSync(exportSourcePath)) {
        throw new Error("Audio file was not found.");
      }

      if (request.workspaceId === "slice" && hasSliceRange(row)) {
        await cropWaveFileToPath(exportSourcePath, targetPath, readRowSeconds(row, "startSec"), readRowSeconds(row, "endSec"));
      } else {
        await mkdir(dirname(targetPath), { recursive: true });
        await copyFile(exportSourcePath, targetPath);
      }

      outcome.copied = true;
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      outcome.outputPath = "";
    }

    outcomes.push(outcome);
    emitExportProgress(request, outputRoot, sessionPath, outcomes, details, totalRows, onProgress);
  }

  await writeFile(csvPath, buildCsv(request.table, outcomes), "utf8");
  await writeFile(logPath, buildLog(request, outcomes, sessionPath, csvPath), "utf8");

  const outputTree = buildExportTree(request.workspaceId, outputRoot, outcomes);
  const failed = outcomes.filter((outcome) => outcome.error);
  const progress = buildExportProgress(totalRows, outcomes);
  const cancelled = Boolean(signal?.aborted);

  return {
    ok: !cancelled && failed.length === 0,
    workspaceId: request.workspaceId,
    error: !cancelled && failed.length > 0 ? `${failed.length}媛??됱쓽 ?ㅻ뵒?ㅻ? ?대낫?댁? 紐삵뻽?듬땲?? 濡쒓렇瑜??뺤씤?섏꽭??` : undefined,
    cancelled,
    outputPath: sessionPath,
    outputCsvPath: csvPath,
    logPath,
    table: request.table,
    details,
    outputTree,
    progress,
  };
}

function emitExportProgress(request: WorkspaceExportRequest, outputRoot: string, sessionPath: string, outcomes: ExportRowOutcome[], details: DetailField[], totalRows: number, onProgress?: WorkspaceExportProgressHandler): void {
  onProgress?.({
    workspaceId: request.workspaceId,
    outputPath: sessionPath,
    outputTree: buildExportTree(request.workspaceId, outputRoot, outcomes),
    table: request.table,
    details,
    progress: buildExportProgress(totalRows, outcomes),
  });
}
