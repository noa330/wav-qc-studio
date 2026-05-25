import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DataTable, DataTableColumn, DataTableRow, DetailField, WorkspaceId } from "@shared/ipc";
import { createEmptyWorkspaceTable, workspaceTableColumns } from "@shared/table-schemas";

const slicerColumns = workspaceTableColumns.slice;
const taggingColumns = workspaceTableColumns.tagging;
const speakerColumns = workspaceTableColumns.speaker;
const batchColumns = workspaceTableColumns.batch;
const overviewColumns = workspaceTableColumns.overview;
const trainingColumns = workspaceTableColumns.training;
const inferenceColumns = workspaceTableColumns.inference;
const batchTranscriptionStages = new Set(["audio_info", "transcribing", "word_aligning"]);
const BATCH_UNKNOWN_SPEAKER_LABEL = "speaker_unknown";

export async function readWorkspaceTable(workspaceId: WorkspaceId, _outputPath: string, manifestPath?: string, _outputCsvPath?: string): Promise<DataTable> {
  if (workspaceId === "overview") {
    return manifestPath && existsSync(manifestPath) ? readOverviewManifest(manifestPath) : createEmptyWorkspaceTable(workspaceId);
  }

  if (workspaceId === "batch") {
    return manifestPath && existsSync(manifestPath) ? readBatchManifest(manifestPath) : createEmptyWorkspaceTable(workspaceId);
  }

  if (workspaceId === "training") {
    return manifestPath && existsSync(manifestPath) ? readTrainingManifest(manifestPath) : createEmptyWorkspaceTable(workspaceId);
  }

  if (workspaceId === "inference") {
    return manifestPath && existsSync(manifestPath) ? readInferenceManifest(manifestPath) : createEmptyWorkspaceTable(workspaceId);
  }

  if (!manifestPath || !existsSync(manifestPath)) {
    return createEmptyWorkspaceTable(workspaceId);
  }

  if (workspaceId === "speaker") {
    return readSpeakerManifest(manifestPath);
  }

  return readSlicerManifest(manifestPath, workspaceId);
}

export async function readWorkspaceDetails(workspaceId: WorkspaceId, table: DataTable): Promise<DetailField[]> {
  const firstRow = table.rows[0];
  if (!firstRow) {
    return table.columns.length > 0
      ? table.columns.map((column) => ({ label: column.label, value: "-" }))
      : [{ label: "선택", value: "선택된 항목 없음" }];
  }

  return table.columns.map((column) => ({
    label: column.label,
    value: firstRow.cells[column.key] ?? "",
  }));
}

async function readOverviewManifest(manifestPath: string): Promise<DataTable> {
  const manifest = await readJsonRecord(manifestPath);
  const rows = asRecordArray(manifest.rows);
  return {
    columns: overviewColumns,
    rows: rows.map<DataTableRow>((row, index) => {
      const raw = stringifyRecord(row);
      const error = stringValue(row.error);
      return {
        id: raw.absolute_path || raw.file_name || `${index + 1}`,
        sourcePath: raw.absolute_path,
        raw,
        cells: Object.fromEntries(
          overviewColumns.map((column) => [
            column.key,
            column.key === "index"
              ? `${index + 1}`
              : column.key === "status"
                ? error.trim()
                  ? translateStatus("failed")
                  : translateStatus("completed")
                : raw[column.key] ?? "",
          ]),
        ),
      };
    }),
  };
}

async function readSlicerManifest(manifestPath: string, workspaceId: WorkspaceId): Promise<DataTable> {
  const manifest = await readJsonRecord(manifestPath);
  const slices = asRecordArray(manifest.slices);
  const columns = workspaceId === "tagging" ? taggingColumns : slicerColumns;
  const rows = slices.map<DataTableRow>((slice, index) => ({
    id: stringValue(slice.index) || `${index + 1}`,
    sourcePath: stringValue(slice.outputPath) || stringValue(slice.originalPath),
    raw: stringifyRecord(slice),
    cells: {
      index: stringValue(slice.index) || `${index + 1}`,
      fileName: stringValue(slice.fileName),
      startSec: formatSeconds(numberValue(slice.startSec)),
      endSec: formatSeconds(numberValue(slice.endSec)),
      durationSec: `${formatNumber(numberValue(slice.durationSec), 2)}s`,
      channels: stringValue(slice.channels),
      markerCount: stringValue(slice.markerCount),
      topTag: stringValue(slice.topTag),
      ngTags: stringValue(slice.ngTags),
      status: translateStatus(stringValue(slice.status)),
      outputPath: basename(stringValue(slice.outputPath)),
    },
  }));

  return { columns, rows };
}

async function readSpeakerManifest(manifestPath: string): Promise<DataTable> {
  const manifest = await readJsonRecord(manifestPath);
  const jobs = asRecordArray(manifest.jobs);
  const rows = jobs.map<DataTableRow>((job, index) => ({
    id: stringValue(job.originalPath) || stringValue(job.fileName) || `${index + 1}`,
    sourcePath: stringValue(job.finalOutputPath) || stringValue(job.sidonOutputPath) || stringValue(job.resembleOutputPath) || stringValue(job.voiceFixerOutputPath) || stringValue(job.originalPath),
    raw: stringifyRecord(job),
    cells: {
      index: `${index + 1}`,
      fileName: stringValue(job.fileName),
      modelLabel: stringValue(job.modelLabel),
      activeStage: stringValue(job.activeStage),
      status: translateStatus(stringValue(job.status)),
      finalOutputPath: basename(stringValue(job.finalOutputPath) || stringValue(job.sidonOutputPath) || stringValue(job.resembleOutputPath) || stringValue(job.voiceFixerOutputPath)),
      error: stringValue(job.error),
    },
  }));

  return { columns: speakerColumns, rows };
}

async function readBatchManifest(manifestPath: string): Promise<DataTable> {
  const manifest = await readJsonRecord(manifestPath);
  const jobs = asRecordArray(manifest.jobs).filter(isPublishableBatchJob);
  const displayIndex = (index: number) => `${index + 1}`;
  const rows = jobs.map<DataTableRow>((job, index) => ({
    id: displayIndex(index),
    sourcePath: stringValue(job.outputAudioPath) || stringValue(job.originalPath),
    raw: stringifyRecord(job),
    cells: {
      index: displayIndex(index),
      fileName: stringValue(job.fileName),
      audioStatus: translateStatus(stringValue(job.status)),
      autoTranscript: stringValue(job.transcript),
      editedTranscript: stringValue(job.editedTranscript) || stringValue(job.transcript),
      speaker: readBatchSpeaker(job),
      language: stringValue(job.language),
      qcStatus: readBatchReviewStatus(job),
    },
  }));

  return { columns: batchColumns, rows };
}

async function readTrainingManifest(manifestPath: string): Promise<DataTable> {
  const manifest = await readJsonRecord(manifestPath);
  const rawJobs = asRecordArray(manifest.jobs);
  const jobs = rawJobs.filter(isCompletedTrainingResultJob);
  const rows = jobs.map<DataTableRow>((job, index) => {
    const raw = stringifyRecord(job);
    const checkpointPath = stringValue(job.checkpointPath);
    const checkpointInfo = trainingCheckpointInfo(stringValue(job.stage), checkpointPath);
    const unit = trainingCheckpointUnit(stringValue(job.modelType), checkpointInfo.kind, job);
    raw.stage = checkpointInfo.kind || raw.stage;
    raw.checkpointRole = checkpointInfo.role;
    raw.checkpointComponent = checkpointInfo.component;
    raw.epoch = unit.epoch;
    raw.step = unit.step;
    return {
      id: stringValue(job.id) || `${index + 1}`,
      sourcePath: checkpointPath || stringValue(job.datasetPath),
      raw,
      cells: {
        index: `${index + 1}`,
        modelName: stringValue(job.modelName),
        stage: checkpointInfo.label || translateTrainingStage(stringValue(job.stage)),
        epoch: unit.epoch,
        step: unit.step,
        elapsed: formatElapsed(numberValue(job.elapsedSec)),
        checkpoint: checkpointPath ? basename(checkpointPath) : stringValue(job.checkpoint),
        status: translateStatus(stringValue(job.status)),
      },
    };
  });

  const modelType = stringValue(manifest.modelType) || rows[0]?.raw?.modelType || "";
  return { columns: trainingColumnsForModelType(modelType), rows };
}

async function readInferenceManifest(manifestPath: string): Promise<DataTable> {
  const manifest = await readJsonRecord(manifestPath);
  const jobs = asRecordArray(manifest.jobs).filter(isCompletedInferenceResultJob);
  const rows = jobs.map<DataTableRow>((job, index) => {
    const raw = stringifyRecord(job);
    const outputAudioPath = stringValue(job.outputAudioPath);
    const referenceAudioPath = stringValue(job.referenceAudioPath);
    return {
      id: stringValue(job.id) || `${index + 1}`,
      sourcePath: outputAudioPath || referenceAudioPath,
      raw,
      cells: {
        index: `${index + 1}`,
        modelName: stringValue(job.modelName),
        mode: stringValue(job.mode),
        referenceAudio: referenceAudioPath ? basename(referenceAudioPath) : "",
        outputAudio: outputAudioPath ? basename(outputAudioPath) : "",
        elapsed: formatElapsed(numberValue(job.elapsedSec)),
        status: translateStatus(stringValue(job.status)),
      },
    };
  });

  return { columns: inferenceColumns, rows };
}

function isCompletedTrainingResultJob(job: Record<string, unknown>): boolean {
  const status = stringValue(job.status).trim().toLowerCase();
  const checkpointPath = stringValue(job.checkpointPath).trim();
  const checkpoint = stringValue(job.checkpoint).trim();
  return status === "completed" && (checkpointPath.length > 0 || checkpoint.length > 0);
}

function trainingCheckpointInfo(stage: string, checkpointPath: string): { kind: string; role: string; component: string; label: string } {
  const normalizedStage = stage.trim().toLowerCase();
  const normalizedPath = checkpointPath.replace(/\\/gu, "/").toLowerCase();
  const name = basename(checkpointPath).toLowerCase();
  const kind = normalizedStage.includes("omni")
    ? "omnivoice"
    : normalizedStage.includes("gpt")
      ? "gpt"
      : normalizedStage.includes("sovits")
        ? "sovits"
        : normalizedStage;
  if (kind === "omnivoice") {
    return { kind, role: "resume-inference", component: "model", label: "OmniVoice 이어하기/추론용" };
  }
  if (kind === "gpt") {
    const role = normalizedPath.includes("/gpt_weights") ? "inference" : "resume";
    return { kind, role, component: "semantic", label: `GPT ${trainingRoleLabel(role)}` };
  }
  if (kind === "sovits") {
    const role = normalizedPath.includes("/sovits_weights") ? "inference" : "resume";
    const component = name.startsWith("d_") ? "discriminator" : "generator";
    const suffix = component === "discriminator" ? " D" : " G";
    return { kind, role, component, label: `SoVITS ${trainingRoleLabel(role)}${suffix}` };
  }
  return { kind, role: "", component: "", label: "" };
}

function trainingRoleLabel(role: string): string {
  if (role === "resume") {
    return "이어하기용";
  }
  if (role === "inference") {
    return "추론용";
  }
  return "이어하기/추론용";
}

function trainingCheckpointUnit(
  modelType: string,
  checkpointKind: string,
  job: Record<string, unknown>,
): { epoch: string; step: string } {
  const normalized = `${modelType} ${checkpointKind}`.toLowerCase();
  if (normalized.includes("omnivoice")) {
    return { epoch: "", step: stringValue(job.step) };
  }
  if (normalized.includes("gpt-sovits") || normalized.includes("gpt") || normalized.includes("sovits")) {
    return { epoch: stringValue(job.epoch), step: "" };
  }
  return { epoch: stringValue(job.epoch), step: stringValue(job.step) };
}

function trainingColumnsForModelType(modelType: string): DataTableColumn[] {
  const normalized = modelType.trim().toLowerCase();
  if (normalized === "omnivoice") {
    return trainingColumns.filter((column) => column.key !== "epoch");
  }
  if (normalized === "gpt-sovits") {
    return trainingColumns.filter((column) => column.key !== "step");
  }
  return trainingColumns;
}

function isCompletedInferenceResultJob(job: Record<string, unknown>): boolean {
  const status = stringValue(job.status).trim().toLowerCase();
  const outputAudioPath = stringValue(job.outputAudioPath).trim();
  return status === "completed" && outputAudioPath.length > 0;
}

function isPublishableBatchJob(job: Record<string, unknown>): boolean {
  const status = stringValue(job.status).trim().toLowerCase();
  if (status !== "queued" && status !== "running") {
    return true;
  }

  if (isBatchTranscriptionStage(job)) {
    return false;
  }

  return hasBatchResultPayload(job);
}

function isBatchTranscriptionStage(job: Record<string, unknown>): boolean {
  const activeStage = stringValue(job.activeStage || job.active_stage).trim().toLowerCase();
  return batchTranscriptionStages.has(activeStage);
}

function hasBatchResultPayload(job: Record<string, unknown>): boolean {
  return [
    job.transcript,
    job.editedTranscript,
    job.edited_transcript,
    job.speaker,
    job.speakerCount,
    job.speakerTurns,
    job.outputAudioPath,
    job.outputScriptPath,
    job.alignmentWords,
    job.alignmentSummary,
    job.error,
  ].some((value) => stringValue(value).trim().length > 0);
}

function readBatchReviewStatus(job: Record<string, unknown>): string {
  const rawStatus = stringValue(job.qcStatus) || stringValue(job.qc_status) || stringValue(job.reviewStatus) || stringValue(job.review_status);
  if (rawStatus) {
    return rawStatus;
  }

  const transcript = stringValue(job.transcript);
  const editedTranscript = stringValue(job.editedTranscript) || stringValue(job.edited_transcript);
  return editedTranscript && transcript && editedTranscript.trim() !== transcript.trim() ? "수정됨" : "검수전";
}

function readBatchSpeaker(job: Record<string, unknown>): string {
  const speaker = stringValue(job.speaker);
  if (speaker) {
    return speaker;
  }

  const activeStage = stringValue(job.activeStage).toLowerCase();
  if (activeStage === "diarizing" || activeStage === "preparing_diarization") {
    return "화자구분 중";
  }

  return BATCH_UNKNOWN_SPEAKER_LABEL;
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  const parsed = JSON.parse(content) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function stringifyRecord(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, stringValue(value)]));
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits);
}

function formatElapsed(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function translateTrainingStage(value: string): string {
  switch (value.toLowerCase()) {
    case "preprocess":
      return "전처리";
    case "tokens":
      return "토큰 생성";
    case "sovits":
      return "SoVITS";
    case "gpt":
      return "GPT";
    case "train":
      return "학습";
    case "resume":
      return "이어하기";
    case "omnivoice":
      return "OmniVoice";
    default:
      return value || "-";
  }
}

function translateStatus(value: string): string {
  switch (value) {
    case "queued":
      return "대기";
    case "running":
      return "처리 중";
    case "completed":
      return "완료";
    case "completed_with_errors":
      return "부분 완료";
    case "failed":
      return "실패";
    default:
      return value || "-";
  }
}
