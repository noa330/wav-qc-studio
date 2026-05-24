import { existsSync, readdirSync, type Dirent } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { WAV_AUDIO_EXTENSIONS } from "@shared/ipc";
import type { DataTable, DataTableColumn, DataTableRow, DetailField, FileTreeNode, FileTreeResult, WorkspaceExportProgressEvent, WorkspaceExportRequest, WorkspaceExportResult, WorkspaceId, WorkspaceProgress } from "@shared/ipc";
import { cropWaveFileToPath } from "./audio-crop";
import { scanFileTree } from "./file-tree";
import { createBackendLayout } from "./project-layout";
import { runPythonPlan } from "./python-runner";
import { readWorkspaceDetails, readWorkspaceTable } from "./result-readers";

const OUTPUT_FOLDERS: Record<WorkspaceId, string> = {
  slice: "_slicer_results",
  tagging: "_tagging_results",
  speaker: "_spica_results",
  overview: "_wav_qc_results",
  batch: "_batch_qc_results",
  training: "_training_results",
  inference: "_voice_inference_results",
};

type ExportRowOutcome = {
  row: DataTableRow;
  includeAudio: boolean;
  sourcePath: string;
  outputPath: string;
  copied: boolean;
  mutedIntervals?: number;
  error?: string;
};

type WorkspaceExportProgressHandler = (progress: WorkspaceExportProgressEvent) => void;

export async function exportWorkspace(request: WorkspaceExportRequest, onProgress?: WorkspaceExportProgressHandler, signal?: AbortSignal): Promise<WorkspaceExportResult> {
  if (request.workspaceId === "batch") {
    return exportBatchWorkspace(request, onProgress, signal);
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
    error: !cancelled && failed.length > 0 ? `${failed.length}개 행의 오디오를 내보내지 못했습니다. 로그를 확인하세요.` : undefined,
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

async function exportBatchWorkspace(request: WorkspaceExportRequest, onProgress?: WorkspaceExportProgressHandler, signal?: AbortSignal): Promise<WorkspaceExportResult> {
  const outputRoot = resolveOutputDirectory(request.workspaceId, request.paths.inputPath, request.paths.outputPath, request.paths.projectRoot, OUTPUT_FOLDERS.batch);
  const runStamp = timestamp();
  const requestPath = join(outputRoot, `batch_qc_export_request_${runStamp}.json`);
  const manifestPath = join(outputRoot, `batch_qc_export_${runStamp}.json`);
  const logPath = join(outputRoot, `batch_qc_export_${runStamp}.log`);
  const jobs = buildBatchExportJobs(request);
  const initialDetails = await readWorkspaceDetails(request.workspaceId, request.table);

  if (jobs.length === 0) {
    throw new Error("Batch QC export has no checked rows.");
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
    error: ok || cancelled ? undefined : outcome.stderr || "Batch QC export failed. Check the log file.",
    cancelled,
    outputPath: datasetDir,
    logPath,
    table,
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

function buildExportProgress(totalRows: number, outcomes: ExportRowOutcome[]): WorkspaceProgress {
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

function buildExportTree(workspaceId: WorkspaceId, rootPath: string, outcomes: ExportRowOutcome[]): FileTreeResult {
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

function buildCsv(table: DataTable, outcomes: ExportRowOutcome[]): string {
  const columns = insertPathColumn(table.columns);
  const lines = [columns.map((column) => escapeCsv(column.label)).join(",")];
  const outcomeByRowId = new Map(outcomes.map((outcome) => [outcome.row.id, outcome]));

  for (const row of table.rows) {
    const outcome = outcomeByRowId.get(row.id);
    lines.push(
      columns
        .map((column) => {
          if (column.key === "__exportPath") {
            return escapeCsv(outcome?.outputPath ?? "");
          }

          return escapeCsv(row.cells[column.key] ?? row.raw?.[column.key] ?? "");
        })
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}

function insertPathColumn(columns: DataTableColumn[]): DataTableColumn[] {
  const pathColumn: DataTableColumn = { key: "__exportPath", label: "경로" };
  const fileNameIndex = columns.findIndex((column) => column.key === "fileName" || column.key === "file_name");
  if (fileNameIndex < 0) {
    return [pathColumn, ...columns];
  }

  return [...columns.slice(0, fileNameIndex + 1), pathColumn, ...columns.slice(fileNameIndex + 1)];
}

function buildLog(request: WorkspaceExportRequest, outcomes: ExportRowOutcome[], sessionPath: string, csvPath: string): string {
  const copied = outcomes.filter((outcome) => outcome.copied);
  const checked = outcomes.filter((outcome) => outcome.includeAudio);
  const unchecked = outcomes.filter((outcome) => !outcome.includeAudio);
  const lines = [
    `WAV QC Studio export`,
    `Workspace: ${request.workspaceId}`,
    `Input: ${request.paths.inputPath}`,
    `Output: ${sessionPath}`,
    `CSV: ${csvPath}`,
    `Rows: ${outcomes.length}`,
    `Audio: ${checked.length}`,
    `NG: ${unchecked.length}`,
    `Copied: ${copied.length}`,
    "",
  ];

  for (const [index, outcome] of outcomes.entries()) {
    const bucket = outcome.includeAudio ? "audio" : "ng";
    const status = outcome.copied ? formatExportStatus(outcome) : `FAILED ${outcome.error ?? ""}`.trim();
    lines.push(`${index + 1}. [${status}] ${bucket} | ${outcome.sourcePath || "-"} -> ${outcome.outputPath || "-"}`);
  }

  return `${lines.join("\r\n")}\r\n`;
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
    percent: numberValue(summary.progress, NaN) * 100,
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

function formatExportStatus(outcome: ExportRowOutcome): string {
  if (outcome.mutedIntervals && outcome.mutedIntervals > 0) {
    return `OK muted=${outcome.mutedIntervals}`;
  }

  return "OK";
}


function resolveEditedExportPath(request: WorkspaceExportRequest, sourcePath: string): string {
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

function resolveRowAudioPath(workspaceId: WorkspaceId, row: DataTableRow, inputPath: string): string {
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

function createExportFileName(workspaceId: WorkspaceId, row: DataTableRow, index: number, sourcePath: string, usedNames: Set<string>): string {
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

function hasSliceRange(row: DataTableRow): boolean {
  const startSec = readRowSeconds(row, "startSec");
  const endSec = readRowSeconds(row, "endSec");
  return endSec > startSec;
}

function readRowSeconds(row: DataTableRow, key: string): number {
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

function fileName(path: string): string {
  return path ? basename(path) : "";
}

function escapeCsv(value: string): string {
  if (!/[",\r\n]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '""')}"`;
}

function resolveOutputDirectory(workspaceId: WorkspaceId, inputPath: string, requestedOutputPath: string | undefined, projectRoot: string | undefined, expectedLeafName: string): string {
  const baseInput = resolveFallbackInputFolder(inputPath);
  const candidate = requestedOutputPath?.trim();
  if (!candidate) {
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

function timestamp(): string {
  const now = new Date();
  const date = [now.getFullYear(), `${now.getMonth() + 1}`.padStart(2, "0"), `${now.getDate()}`.padStart(2, "0")].join("");
  const time = [`${now.getHours()}`.padStart(2, "0"), `${now.getMinutes()}`.padStart(2, "0"), `${now.getSeconds()}`.padStart(2, "0")].join("");
  return `${date}_${time}`;
}
