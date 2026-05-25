import { existsSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DataTable,
  DetailField,
  FileTreeNode,
  FileTreeResult,
  WorkspaceBatchSpeakerDiarizationRequest,
  WorkspaceProgress,
  WorkspaceId,
  WorkspaceRunProgressEvent,
  WorkspaceTerminalUpdate,
  WorkspaceRunRequest,
  WorkspaceRunResult,
  WorkspaceSettings,
} from "@shared/ipc";
import { createEmptyWorkspaceTable } from "@shared/table-schemas";
import { scanFileTree } from "../files/file-tree";
import { formatCommand, resolveHostLogPath, type PythonRunPlan, runPythonPlan } from "../process/python-runner";
import { readRawTerminalSnapshot } from "../process/terminal-log";
import { createBackendLayout } from "../project/layout";
import { assertTrainingDatasetExtension, loadTrainingDatasetPreview } from "../voice/training-dataset";
import { readWorkspaceDetails, readWorkspaceTable } from "../workspace-results/readers";
import { recordActiveAudioConversionCache, resolveAudioInputConversionDirectory } from "./audio-conversion-cache";
import { findFirstInputAudio, isSupportedAudioPath, isWavAudioPath } from "./audio-paths";
import { resolveRunInputPath, restoreOriginalAudioSources } from "./run-input-sources";
import {
  boolArg,
  msToFireRedFrame,
  normalizeBatchSettings,
  normalizeInferenceSettings,
  normalizeLanguage,
  normalizeOverviewSettings,
  normalizeSlicerSettings,
  normalizeSpeakerSettings,
  normalizeTrainingSettings,
  round,
  timestamp,
} from "./setting-normalizers";
import {
  BATCH_OUTPUT_FOLDER,
  INFERENCE_OUTPUT_FOLDER,
  OVERVIEW_OUTPUT_FOLDER,
  SLICER_OUTPUT_FOLDER,
  SPEAKER_OUTPUT_FOLDER,
  TAGGING_OUTPUT_FOLDER,
  TRAINING_OUTPUT_FOLDER,
  resolveFallbackInputFolder,
  resolveOutputDirectory,
} from "./workspace-paths";

export { resolveWorkspaceOutputPath } from "./workspace-paths";
export { cleanupInactiveAudioConversionCaches } from "./audio-conversion-cache";

const workspaceRunCachePaths = new Set<string>();
type WorkspaceRunProgressHandler = (progress: WorkspaceRunProgressEvent) => void;

export function cleanupWorkspaceRunCaches(): void {
  for (const cachePath of workspaceRunCachePaths) {
    rmSync(cachePath, { recursive: true, force: true });
  }

  workspaceRunCachePaths.clear();
}

export async function runWorkspace(request: WorkspaceRunRequest, onProgress?: WorkspaceRunProgressHandler, signal?: AbortSignal): Promise<WorkspaceRunResult> {
  const plan = await createRunPlan(request);
  return executeWorkspacePlan(request.workspaceId, plan, "백엔드 실행이 실패했습니다. 로그 파일을 확인하세요.", onProgress, signal);
}

export async function runBatchSpeakerDiarization(request: WorkspaceBatchSpeakerDiarizationRequest, onProgress?: WorkspaceRunProgressHandler, signal?: AbortSignal): Promise<WorkspaceRunResult> {
  const plan = await createBatchSpeakerDiarizationPlan(request);
  return executeWorkspacePlan(request.workspaceId, plan, "화자 구분 실행이 실패했습니다. 로그 파일을 확인하세요.", onProgress, signal);
}

async function executeWorkspacePlan(
  workspaceId: WorkspaceId,
  plan: PythonRunPlan,
  errorMessage: string,
  onProgress?: WorkspaceRunProgressHandler,
  signal?: AbortSignal,
): Promise<WorkspaceRunResult> {
  attachCancellation(plan, signal);
  const stopProgressPolling = startRunProgressPolling(workspaceId, plan, onProgress);
  let outcome: Awaited<ReturnType<typeof runPythonPlan>>;
  try {
    outcome = await runPythonPlan(plan);
  } finally {
    stopProgressPolling();
  }
  const rawTable = await readWorkspaceTable(workspaceId, plan.outputPath, plan.manifestPath, plan.outputCsvPath);
  const table = restoreOriginalAudioSources(workspaceId, rawTable, plan.audioSourceMappings);
  const details = await readWorkspaceDetails(workspaceId, table);
  const progress = await readWorkspaceProgress(plan, table);
  const inputTreePath = plan.displayInputPath ?? plan.inputPath;
  const inputTree = existsSync(inputTreePath) ? await scanFileTree(inputTreePath, { workspaceId, purpose: "input" }) : undefined;

  return {
    ok: outcome.exitCode === 0,
    workspaceId,
    exitCode: outcome.exitCode,
    error: outcome.exitCode === 0 || outcome.exitCode === 130 ? undefined : errorMessage,
    stderr: outcome.stderr,
    stdout: outcome.stdout,
    cancelled: outcome.exitCode === 130,
    metadata: outcome.metadata,
    table,
    details,
    inputTree,
    outputTree: undefined,
    progress,
  };
}

function attachCancellation(plan: PythonRunPlan, signal: AbortSignal | undefined): void {
  const cancelPath = join(plan.outputPath, `${plan.workspaceId}_${timestamp()}.cancel`);
  plan.cancelPath = cancelPath;
  plan.signal = signal;
  plan.args.push("--cancel-file", cancelPath);
}

function startRunProgressPolling(workspaceId: WorkspaceId, plan: PythonRunPlan, onProgress?: WorkspaceRunProgressHandler): () => void {
  if (!onProgress) {
    return () => undefined;
  }

  let disposed = false;
  let lastSignature = "";
  const readAndEmit = async () => {
    if (disposed) {
      return;
    }

    try {
      const table = await readWorkspaceTable(workspaceId, plan.outputPath, plan.manifestPath, plan.outputCsvPath);
      const nextSignature = tableSignature(table);
      const progress = await readWorkspaceProgress(plan, table);
      const terminal = await readRunTerminalSnapshot(plan);
      const progressSignature = `${progress.completed}/${progress.total}/${progress.failed}/${progress.percent}`;
      const terminalSignature = `${terminal?.text.length ?? 0}/${terminal?.text.slice(-240) ?? ""}`;
      const signature = `${nextSignature}|${progressSignature}|${terminalSignature}`;
      if (signature === lastSignature) {
        return;
      }

      lastSignature = signature;
      onProgress({
        workspaceId,
        table,
        details: await readWorkspaceDetails(workspaceId, table),
        progress,
        terminal,
      });
    } catch {
      // Manifest/CSV files can be mid-write while Python updates them. The next poll will retry.
    }
  };
  const timer = setInterval(() => void readAndEmit(), 650);
  void readAndEmit();

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}

async function readRunTerminalSnapshot(plan: PythonRunPlan): Promise<WorkspaceTerminalUpdate | undefined> {
  const hostLogPath = resolveHostLogPath(plan.logPath);
  return readRawTerminalSnapshot({
    primaryLogPath: hostLogPath,
    fallbackLogPath: plan.logPath,
    logPath: hostLogPath,
    backendLogPath: plan.logPath,
    command: formatCommand(plan.pythonPath, plan.args),
  });
}

async function readWorkspaceProgress(plan: PythonRunPlan, table: DataTable): Promise<WorkspaceProgress> {
  const manifestProgress = plan.manifestPath ? await readManifestProgress(plan.manifestPath) : undefined;
  if (manifestProgress) {
    return manifestProgress;
  }

  const completed = table.rows.length;
  return normalizeProgress({
    total: completed,
    completed,
    failed: 0,
  });
}

async function readManifestProgress(manifestPath: string): Promise<WorkspaceProgress | undefined> {
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    return undefined;
  }

  const summary = isRecord(parsed.summary) ? parsed.summary : {};
  return normalizeProgress({
    total: numberValue(summary.totalFiles),
    completed: numberValue(summary.completed),
    failed: numberValue(summary.failed),
    percent: numberValue(summary.progress) * 100,
  });
}

function normalizeProgress(progress: { total: number; completed: number; failed: number; percent?: number }): WorkspaceProgress {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAudioPathKey(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").toLowerCase();
}

function tableSignature(table: DataTable): string {
  return JSON.stringify(table.rows.map((row) => [row.id, row.sourcePath, row.cells, row.raw]));
}

export async function loadWorkspaceFromPath(workspaceId: WorkspaceId, inputPath: string, _outputPath?: string, settings?: WorkspaceSettings, projectRoot?: string, onProgress?: WorkspaceRunProgressHandler): Promise<{
  table: DataTable;
  details: DetailField[];
  inputPath: string;
  originalInputPath: string;
  inputTree?: FileTreeResult;
  audioSourceMapPath?: string;
  logPath?: string;
}> {
  if (workspaceId === "training") {
    const preview = await loadTrainingDatasetPreview(inputPath, settings);
    const table = createEmptyWorkspaceTable(workspaceId);
    return {
      table,
      details: preview.details,
      inputPath: preview.inputPath,
      originalInputPath: inputPath,
      inputTree: preview.inputTree,
    };
  }

  const initialInputTree = await scanAudioConversionInputTree(workspaceId, inputPath);
  if (onProgress) {
    onProgress(await createAudioConversionProgressEvent(workspaceId, initialInputTree));
  }
  const preparedInput = await prepareWorkspaceAudioInput(workspaceId, inputPath, projectRoot, onProgress);
  const table = createEmptyWorkspaceTable(workspaceId);
  return {
    table,
    details: await readWorkspaceDetails(workspaceId, table),
    inputPath: preparedInput.inputPath,
    originalInputPath: preparedInput.originalInputPath,
    inputTree: preparedInput.inputTree ?? initialInputTree,
    audioSourceMapPath: preparedInput.audioSourceMapPath,
    logPath: preparedInput.logPath,
  };
}

async function createRunPlan(request: WorkspaceRunRequest): Promise<PythonRunPlan> {
  switch (request.workspaceId) {
    case "slice":
      return createSlicerPlan(request, "slice");
    case "tagging":
      return createSlicerPlan(request, "tagging");
    case "speaker":
      return createSpeakerPlan(request);
    case "overview":
      return createOverviewPlan(request);
    case "batch":
      return createBatchPlan(request);
    case "training":
      return createTrainingPlan(request);
    case "inference":
      return createInferencePlan(request);
  }
}

async function createSlicerPlan(request: WorkspaceRunRequest, mode: "slice" | "tagging"): Promise<PythonRunPlan> {
  await assertInputDirectory(request.paths.inputPath, "유효한 입력 오디오 폴더를 선택하세요.");
  const layout = createBackendLayout({ markerScript: "slicer_main.py", venvFolder: ".ven_slice" });
  const runStamp = timestamp();
  const outputLeaf = mode === "tagging" ? TAGGING_OUTPUT_FOLDER : SLICER_OUTPUT_FOLDER;
  const outputPath = resolveOutputDirectory(request.paths.inputPath, request.paths.outputPath, outputLeaf, request.paths.projectRoot, request.workspaceId);
  await mkdir(outputPath, { recursive: true });
  const preparedInput = await resolveRunInputPath(request, outputPath, runStamp);
  const inputPath = preparedInput.inputPath;

  const manifestPath = join(outputPath, `${mode === "tagging" ? "tagging" : "slicer"}_jobs_${runStamp}.json`);
  const logPath = join(outputPath, `${mode === "tagging" ? "tagging" : "slicer"}_${runStamp}.log`);
  const settings = normalizeSlicerSettings(request.settings.slicer);
  const smoothWindowFrame = msToFireRedFrame(settings.smoothWindowMs, 1, 99);
  const minEventFrame = msToFireRedFrame(settings.minEventMs, 1, 5000);
  const maxEventFrame = Math.max(minEventFrame, msToFireRedFrame(settings.maxEventMs, 1, 30000));
  const minSilenceFrame = msToFireRedFrame(settings.minSilenceMs, 0, 5000);
  const mergeSilenceFrame = msToFireRedFrame(settings.mergeSilenceMs, 0, 5000);
  const extendSpeechFrame = msToFireRedFrame(settings.extendSpeechMs, 0, 5000);
  const chunkMaxFrame = msToFireRedFrame(settings.chunkMaxMs, 1, 120000);
  const args = [
    layout.scriptPath,
    "slice",
    "--input",
    inputPath,
    "--output-dir",
    outputPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
    "--workflow-mode",
    mode === "tagging" ? "tag" : "slice",
    "--split-gap-sec",
    String(round(settings.splitGapMs / 1000, 3)),
    "--speech-threshold",
    String(settings.speechThreshold),
    "--smooth-window-size",
    String(smoothWindowFrame),
    "--min-event-frame",
    String(minEventFrame),
    "--max-event-frame",
    String(maxEventFrame),
    "--min-silence-frame",
    String(minSilenceFrame),
    "--merge-silence-frame",
    String(mergeSilenceFrame),
    "--extend-speech-frame",
    String(extendSpeechFrame),
    "--chunk-max-frame",
    String(chunkMaxFrame),
    "--speech-pad-ms",
    String(settings.speechPadMs),
    "--zero-cross-search-ms",
    String(settings.zeroCrossSearchMs),
    "--quiet-boundary-search-ms",
    String(settings.quietBoundarySearchMs),
    "--monitor-merge-gap-ms",
    String(settings.monitorMergeGapMs),
    "--monitor-merge-max-ms",
    String(settings.monitorMergeMaxMs),
    "--splice-ms",
    String(settings.spliceMs),
    "--floor-gain-db",
    String(settings.floorGainDb),
    "--normalize-max",
    String(settings.normalizeMax),
    "--normalize-alpha",
    String(settings.normalizeAlpha),
    "--pretrained-sed-model-key",
    settings.pretrainedSedModelKey,
    "--pretrained-sed-thresholds",
    settings.pretrainedSedThresholds,
    "--pretrained-sed-median-window",
    String(settings.pretrainedSedMedianWindow),
    "--pretrained-sed-frame-interval",
    String(settings.pretrainedSedFrameInterval),
    "--pretrained-sed-top-k",
    String(settings.pretrainedSedTopK),
    "--pretrained-sed-min-score",
    String(settings.pretrainedSedMinScore),
    "--device",
    settings.devicePreference,
  ];
  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath,
    displayInputPath: preparedInput.displayInputPath,
    audioSourceMappings: preparedInput.audioSourceMappings,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

async function createSpeakerPlan(request: WorkspaceRunRequest): Promise<PythonRunPlan> {
  const runStamp = timestamp();
  await assertInputDirectory(request.paths.inputPath, "유효한 입력 오디오 폴더를 선택하세요.");
  const settings = normalizeSpeakerSettings(request.settings.speaker);
  if (!settings.useVoiceFixer && !settings.useResemble && !settings.useSidon) {
    throw new Error("최소 1개 이상의 화자/오디오 개선 모델을 선택하세요.");
  }

  const layout = createBackendLayout({ markerScript: "noise_main.py", venvFolder: ".venv_noise" });
  const outputPath = join(resolveOutputDirectory(request.paths.inputPath, request.paths.outputPath, SPEAKER_OUTPUT_FOLDER, request.paths.projectRoot, request.workspaceId), runStamp);
  await mkdir(outputPath, { recursive: true });
  const preparedInput = await resolveRunInputPath(request, outputPath, runStamp);
  const inputPath = preparedInput.inputPath;
  const manifestPath = join(outputPath, `speaker_jobs_${runStamp}.json`);
  const logPath = join(outputPath, `speaker_inference_${runStamp}.log`);
  const args = [layout.scriptPath, "infer", "--input", inputPath, "--output-dir", outputPath, "--manifest", manifestPath, "--log", logPath];

  if (settings.useVoiceFixer) {
    args.push("--voicefixer", "--voicefixer-mode", String(settings.voiceFixerMode), "--voicefixer-device", settings.voiceFixerDevicePreference);
  }

  if (settings.useResemble) {
    args.push(
      "--resemble",
      "--resemble-task",
      settings.resembleTask,
      "--resemble-solver",
      settings.resembleSolver,
      "--resemble-nfe",
      String(settings.resembleNfe),
      "--resemble-tau",
      String(settings.resembleTau),
      "--resemble-lambda",
      String(settings.resembleLambda),
      "--resemble-device",
      settings.resembleDevicePreference,
    );
  }

  if (settings.useSidon) {
    args.push(
      "--sidon",
      "--sidon-device",
      settings.sidonDevicePreference,
      "--sidon-input-peak",
      String(settings.sidonInputPeak),
      "--sidon-high-pass-hz",
      String(settings.sidonHighPassHz),
      "--sidon-chunk-seconds",
      String(settings.sidonChunkSeconds),
      "--sidon-pre-padding",
      String(settings.sidonPrePadding),
      "--sidon-trailing-pad",
      String(settings.sidonTrailingPad),
      "--sidon-decoder-trim",
      String(settings.sidonDecoderTrim),
      "--sidon-stereo-mix-mode",
      settings.sidonStereoMixMode,
      "--sidon-output-bit-depth",
      settings.sidonOutputBitDepth,
      "--sidon-audio-backend-preference",
      settings.sidonAudioBackendPreference,
      "--sidon-feature-cache-frames",
      String(settings.sidonFeatureCacheFrames),
    );
  }

  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath,
    displayInputPath: preparedInput.displayInputPath,
    audioSourceMappings: preparedInput.audioSourceMappings,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

async function createOverviewPlan(request: WorkspaceRunRequest): Promise<PythonRunPlan> {
  await assertInputDirectory(request.paths.inputPath, "유효한 입력 폴더를 선택하세요.");
  const layout = createBackendLayout({ markerScript: "main.py", venvFolder: ".venv" });
  const runStamp = timestamp();
  const outputPath = resolveOutputDirectory(request.paths.inputPath, request.paths.outputPath, OVERVIEW_OUTPUT_FOLDER, request.paths.projectRoot, request.workspaceId);
  await mkdir(outputPath, { recursive: true });
  const preparedInput = await resolveRunInputPath(request, outputPath, runStamp);
  const inputPath = preparedInput.inputPath;
  const manifestPath = join(outputPath, `overview_jobs_${runStamp}.json`);
  const logPath = join(outputPath, `analysis_${runStamp}.log`);
  const overview = normalizeOverviewSettings(request.settings.overview);
  const selectedTasks = [
    overview.analyzeNoise ? "--noise" : "",
  ].filter((candidate): candidate is string => Boolean(candidate));

  if (selectedTasks.length === 0) {
    throw new Error("스코어 분석 모듈에서 최소 1개 이상 선택하세요.");
  }

  const args = [
    layout.scriptPath,
    "analyze",
    "--input",
    inputPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
    ...selectedTasks,
    "--noise-sample-rate",
    String(overview.noiseSampleRate),
    "--noise-personalized",
    boolArg(overview.noisePersonalized),
    "--noise-num-threads",
    String(overview.noiseNumThreads),
    "--noise-require-cuda-provider",
    boolArg(overview.noiseRequireCudaProvider),
    "--noise-bak-bad-threshold",
    String(overview.noiseBakBadThreshold),
  ];

  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath,
    displayInputPath: preparedInput.displayInputPath,
    audioSourceMappings: preparedInput.audioSourceMappings,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

async function createBatchPlan(request: WorkspaceRunRequest): Promise<PythonRunPlan> {
  await assertInputDirectory(request.paths.inputPath, "스크립트 입력 오디오 폴더를 선택하세요.");
  const layout = createBackendLayout({ markerScript: "batch_qc_main.py", venvFolder: ".venv" });
  const runStamp = timestamp();
  const outputPath = resolveOutputDirectory(request.paths.inputPath, request.paths.outputPath, BATCH_OUTPUT_FOLDER, request.paths.projectRoot, request.workspaceId);
  await mkdir(outputPath, { recursive: true });
  const preparedInput = await resolveRunInputPath(request, outputPath, runStamp);
  const inputPath = preparedInput.inputPath;
  const manifestPath = join(outputPath, `batch_qc_jobs_${runStamp}.json`);
  const logPath = join(outputPath, `batch_qc_run_${runStamp}.log`);
  const batch = normalizeBatchSettings(request.settings.batch);
  const args = [
    layout.scriptPath,
    "transcribe",
    "--input",
    inputPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
    "--language",
    normalizeLanguage(batch.transcriptionLanguage),
    "--whisper-asr-model",
    batch.whisperAsrModel,
    "--whisper-beam-size",
    String(batch.whisperBeamSize),
    "--whisper-vad-filter",
    boolArg(batch.whisperVadFilter),
    "--whisper-compute-type-cpu",
    batch.whisperComputeTypeCpu,
    "--whisper-compute-type-cuda",
    batch.whisperComputeTypeCuda,
    "--whisper-suppress-numerals",
    boolArg(batch.whisperSuppressNumerals),
    "--word-align-language-code",
    batch.wordAlignmentLanguageCode,
    "--word-align-device",
    batch.wordAlignmentDevicePreference,
    "--word-align-low-score-threshold",
    String(batch.wordAlignmentLowScoreThreshold),
    "--word-align-missing-score-threshold",
    String(batch.wordAlignmentMissingScoreThreshold),
  ];
  pushOptionalArg(args, "--whisper-initial-prompt", batch.whisperInitialPrompt);

  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath,
    displayInputPath: preparedInput.displayInputPath,
    audioSourceMappings: preparedInput.audioSourceMappings,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

async function createTrainingPlan(request: WorkspaceRunRequest): Promise<PythonRunPlan> {
  await assertInputPath(request.paths.inputPath, "Select a GPT-SoVITS .list file or an OmniVoice .json/.jsonl file.");
  const layout = createBackendLayout({ markerScript: "voice_train_main.py", venvFolder: ".venv" });
  const training = normalizeTrainingSettings(request.settings.training, layout.projectRoot);
  assertTrainingDatasetExtension(request.paths.inputPath, training.selectedModel);
  const runStamp = timestamp();
  const outputPath = resolveOutputDirectory(dirname(request.paths.inputPath), request.paths.outputPath, TRAINING_OUTPUT_FOLDER, request.paths.projectRoot, request.workspaceId);
  await mkdir(outputPath, { recursive: true });
  const manifestPath = join(outputPath, `training_${runStamp}.json`);
  const logPath = join(outputPath, `training_${runStamp}.log`);
  const args = [
    layout.scriptPath,
    "train",
    "--model",
    training.selectedModel,
    "--tool-root",
    training.toolRoot,
    "--input",
    request.paths.inputPath,
    "--output-dir",
    outputPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
    "--model-name",
    training.modelName,
    "--run-mode",
    "auto",
    "--gpu",
    training.gpu,
    "--idle-timeout",
    String(training.idleTimeoutSec),
    "--gpt-version",
    training.gptVersion,
    "--gpt-sovits-batch-size",
    String(training.gptSovitsBatchSize),
    "--gpt-sovits-epochs",
    String(training.gptSovitsEpochs),
    "--gpt-sovits-save-every-epoch",
    String(training.gptSovitsSaveEveryEpoch),
    "--gpt-text-low-lr-rate",
    String(training.gptTextLowLrRate),
    "--gpt-sovits-save-latest",
    boolArg(training.gptSovitsSaveLatest),
    "--gpt-sovits-save-every-weights",
    boolArg(training.gptSovitsSaveEveryWeights),
    "--gpt-grad-checkpoint",
    boolArg(training.gptGradCheckpoint),
    "--gpt-lora-rank",
    String(training.gptLoraRank),
    "--gpt-batch-size",
    String(training.gptBatchSize),
    "--gpt-epochs",
    String(training.gptEpochs),
    "--gpt-save-every-epoch",
    String(training.gptSaveEveryEpoch),
    "--gpt-save-latest",
    boolArg(training.gptSaveLatest),
    "--gpt-save-every-weights",
    boolArg(training.gptSaveEveryWeights),
    "--gpt-dpo",
    boolArg(training.gptDpo),
    "--omni-steps",
    String(training.omniSteps),
    "--omni-save-steps",
    String(training.omniSaveSteps),
    "--omni-logging-steps",
    String(training.omniLoggingSteps),
    "--omni-learning-rate",
    String(training.omniLearningRate),
    "--omni-batch-tokens",
    String(training.omniBatchTokens),
    "--omni-gradient-accumulation-steps",
    String(training.omniGradientAccumulationSteps),
    "--omni-num-workers",
    String(training.omniNumWorkers),
    "--omni-mixed-precision",
    training.omniMixedPrecision,
    "--omni-seed",
    String(training.omniSeed),
    "--omni-max-batch-size",
    String(training.omniMaxBatchSize),
    "--omni-max-sample-tokens",
    String(training.omniMaxSampleTokens),
    "--omni-min-sample-tokens",
    String(training.omniMinSampleTokens),
    "--omni-use-deepspeed",
    boolArg(training.omniUseDeepspeed),
    "--omni-model-only-checkpoint",
    boolArg(training.omniModelOnlyCheckpoint),
  ];
  pushOptionalArg(args, "--gpt-pretrained-s2g", training.gptPretrainedS2G);
  pushOptionalArg(args, "--gpt-pretrained-s2d", training.gptPretrainedS2D);
  pushOptionalArg(args, "--gpt-pretrained-s1", training.gptPretrainedS1);
  pushOptionalArg(args, "--gpt-resume-sovits-path", training.gptResumeSovitsPath);
  pushOptionalArg(args, "--gpt-resume-gpt-path", training.gptResumeGptPath);
  pushOptionalArg(args, "--omni-llm-name-or-path", training.omniLlmNameOrPath);
  pushOptionalArg(args, "--omni-init-from-checkpoint", training.omniInitFromCheckpoint);
  pushOptionalArg(args, "--omni-resume-from-checkpoint", training.omniResumeFromCheckpoint);
  pushOptionalArg(args, "--omni-deepspeed-config", training.omniDeepspeedConfig);

  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath: request.paths.inputPath,
    displayInputPath: request.paths.inputPath,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

async function createInferencePlan(request: WorkspaceRunRequest): Promise<PythonRunPlan> {
  const layout = createBackendLayout({ markerScript: "voice_infer_main.py", venvFolder: ".venv" });
  const settings = normalizeInferenceSettings(request.settings.inference, layout.projectRoot);
  const referenceAudioPath = settings.referenceAudioPath || findFirstInputAudio(request.paths.inputPath);
  await assertInputPath(referenceAudioPath, "Select a reference audio file before running inference.");
  if (!settings.outputText.trim()) {
    throw new Error("Enter output transcript text before running inference.");
  }

  const runStamp = timestamp();
  const outputPath = resolveOutputDirectory(resolveFallbackInputFolder(request.paths.inputPath), request.paths.outputPath, INFERENCE_OUTPUT_FOLDER, request.paths.projectRoot, request.workspaceId);
  await mkdir(outputPath, { recursive: true });
  const manifestPath = join(outputPath, `inference_${runStamp}.json`);
  const logPath = join(outputPath, `inference_${runStamp}.log`);
  const args = [
    layout.scriptPath,
    "infer",
    "--model",
    settings.selectedModel,
    "--tool-root",
    settings.toolRoot,
    "--reference-audio",
    referenceAudioPath,
    "--reference-text",
    settings.referenceText,
    "--text",
    settings.outputText,
    "--output-dir",
    outputPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
    "--model-name",
    settings.modelName,
    "--gpu",
    settings.gpu,
    "--idle-timeout",
    String(settings.idleTimeoutSec),
    "--gpt-version",
    settings.gptVersion,
    "--gpt-mode",
    settings.gptMode,
    "--gpt-text-language",
    settings.gptTextLanguage,
    "--gpt-prompt-language",
    settings.gptPromptLanguage,
    "--gpt-top-k",
    String(settings.gptTopK),
    "--gpt-top-p",
    String(settings.gptTopP),
    "--gpt-temperature",
    String(settings.gptTemperature),
    "--gpt-text-split-method",
    settings.gptTextSplitMethod,
    "--gpt-batch-size",
    String(settings.gptBatchSize),
    "--gpt-batch-threshold",
    String(settings.gptBatchThreshold),
    "--gpt-split-bucket",
    boolArg(settings.gptSplitBucket),
    "--gpt-speed-factor",
    String(settings.gptSpeedFactor),
    "--gpt-fragment-interval",
    String(settings.gptFragmentInterval),
    "--gpt-seed",
    String(settings.gptSeed),
    "--gpt-parallel-infer",
    boolArg(settings.gptParallelInfer),
    "--gpt-repetition-penalty",
    String(settings.gptRepetitionPenalty),
    "--gpt-sample-steps",
    String(settings.gptSampleSteps),
    "--gpt-super-sampling",
    boolArg(settings.gptSuperSampling),
    "--gpt-overlap-length",
    String(settings.gptOverlapLength),
    "--gpt-min-chunk-length",
    String(settings.gptMinChunkLength),
    "--omni-mode",
    settings.omniMode,
    "--omni-language",
    settings.omniLanguage,
    "--omni-instruct",
    settings.omniInstruct,
    "--omni-num-step",
    String(settings.omniNumStep),
    "--omni-guidance-scale",
    String(settings.omniGuidanceScale),
    "--omni-speed",
    String(settings.omniSpeed),
    "--omni-t-shift",
    String(settings.omniTShift),
    "--omni-denoise",
    boolArg(settings.omniDenoise),
    "--omni-postprocess-output",
    boolArg(settings.omniPostprocessOutput),
    "--omni-layer-penalty-factor",
    String(settings.omniLayerPenaltyFactor),
    "--omni-position-temperature",
    String(settings.omniPositionTemperature),
    "--omni-class-temperature",
    String(settings.omniClassTemperature),
  ];
  if (settings.gptMode === "checkpoint") {
    pushOptionalArg(args, "--gpt-sovits-path", settings.gptCheckpointSovitsPath);
    pushOptionalArg(args, "--gpt-gpt-path", settings.gptCheckpointGptPath);
  }
  pushOptionalArg(args, "--omni-checkpoint-path", settings.omniCheckpointPath);
  if (settings.omniDuration > 0) {
    args.push("--omni-duration", String(settings.omniDuration));
  }

  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath: request.paths.inputPath,
    displayInputPath: request.paths.inputPath,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

function pushOptionalArg(args: string[], flag: string, value: string | undefined): void {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return;
  }

  args.push(flag, trimmed);
}

async function createBatchSpeakerDiarizationPlan(request: WorkspaceBatchSpeakerDiarizationRequest): Promise<PythonRunPlan> {
  await assertInputDirectory(request.paths.inputPath, "스크립트 입력 오디오 폴더를 선택하세요.");
  const layout = createBackendLayout({ markerScript: "batch_qc_main.py", venvFolder: ".venv" });
  const runStamp = timestamp();
  const outputPath = resolveOutputDirectory(request.paths.inputPath, request.paths.outputPath, BATCH_OUTPUT_FOLDER, request.paths.projectRoot, request.workspaceId);
  await mkdir(outputPath, { recursive: true });
  const manifestPath = join(outputPath, `batch_qc_speaker_${runStamp}.json`);
  const logPath = join(outputPath, `batch_qc_speaker_${runStamp}.log`);
  const requestPath = join(outputPath, `batch_qc_speaker_request_${runStamp}.json`);
  const batch = normalizeBatchSettings(request.settings.batch);
  await writeFile(
    requestPath,
    JSON.stringify(
      {
        inputFolder: request.paths.inputPath,
        jobs: buildBatchSpeakerJobs(request.table),
      },
      null,
      2,
    ),
    "utf8",
  );

  const args = [
    layout.scriptPath,
    "diarize",
    "--request",
    requestPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
    "--diarizen-model-id",
    batch.diarizenModelId,
    "--diarizen-embedding-model-id",
    batch.diarizenEmbeddingModelId,
    "--batch-speaker-target-sample-rate",
    String(batch.batchSpeakerTargetSampleRate),
    "--batch-speaker-min-overlap-sec",
    String(batch.batchSpeakerMinOverlapSec),
  ];

  return {
    workspaceId: request.workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath: request.paths.inputPath,
    displayInputPath: request.paths.inputPath,
    outputPath,
    manifestPath,
    logPath,
    args,
  };
}

function buildBatchSpeakerJobs(table: DataTable): Array<Record<string, unknown>> {
  return table.rows.map((row, index) => ({
    id: row.id || `${index + 1}`,
    fileName: row.raw?.fileName || row.raw?.file_name || row.cells.fileName || `row_${index + 1}.wav`,
    originalPath: row.raw?.originalPath || row.raw?.original_path || row.raw?.absolute_path || row.sourcePath || "",
    transcript: row.raw?.transcript || row.cells.autoTranscript || "",
    editedTranscript: row.raw?.editedTranscript || row.raw?.edited_transcript || row.cells.editedTranscript || row.raw?.transcript || row.cells.autoTranscript || "",
    language: row.raw?.language || row.cells.language || "",
    speaker: row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "",
    durationSec: row.raw?.durationSec || row.raw?.duration_sec || "",
    sampleRate: row.raw?.sampleRate || row.raw?.sample_rate || "",
    channels: row.raw?.channels || "",
    alignmentWords: parseBatchRawJson(row.raw?.alignmentWords, []),
    alignmentWarnings: parseBatchRawJson(row.raw?.alignmentWarnings, []),
    alignmentSummary: parseBatchRawJson(row.raw?.alignmentSummary, {}),
  }));
}

function parseBatchRawJson(value: string | undefined, fallback: unknown): unknown {
  if (!value?.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

type PreparedWorkspaceInput = {
  inputPath: string;
  originalInputPath: string;
  inputTree?: FileTreeResult;
  audioSourceMapPath?: string;
  logPath?: string;
};

async function prepareWorkspaceAudioInput(workspaceId: WorkspaceId, inputPath: string, projectRoot?: string, onProgress?: WorkspaceRunProgressHandler): Promise<PreparedWorkspaceInput> {
  await assertInputDirectory(inputPath, "유효한 입력 오디오 폴더를 선택하세요.");
  const summary = await summarizeInputAudio(inputPath);
  if (summary.total <= 0) {
    return { inputPath, originalInputPath: inputPath };
  }

  const layout = createAudioConvertingLayout(workspaceId);
  const convertedPath = resolveAudioInputConversionDirectory(workspaceId, inputPath, projectRoot);
  await mkdir(convertedPath, { recursive: true });
  await recordActiveAudioConversionCache(workspaceId, inputPath, convertedPath, projectRoot);

  const runStamp = timestamp();
  const manifestPath = join(convertedPath, `audio_converting_${runStamp}.json`);
  const logPath = join(convertedPath, `audio_converting_${runStamp}.log`);
  const audioSourceMapPath = join(convertedPath, "audio_source_map.json");
  const args = [
    layout.scriptPath,
    "prepare-audio",
    "--input",
    inputPath,
    "--cache-dir",
    convertedPath,
    "--source-map",
    audioSourceMapPath,
    "--manifest",
    manifestPath,
    "--log",
    logPath,
  ];

  const plan: PythonRunPlan = {
    workspaceId,
    projectRoot: layout.projectRoot,
    pythonPath: layout.pythonPath,
    scriptPath: layout.scriptPath,
    inputPath,
    outputPath: convertedPath,
    manifestPath,
    logPath,
    args,
  };
  const stopTerminalPolling = startAudioConversionTerminalPolling(workspaceId, plan, onProgress);
  let outcome: Awaited<ReturnType<typeof runPythonPlan>>;
  try {
    outcome = await runPythonPlan(plan);
  } finally {
    stopTerminalPolling();
  }
  await emitAudioConversionTerminal(workspaceId, plan, onProgress);
  if (outcome.exitCode !== 0) {
    throw new Error(outcome.stderr || "오디오 컨버팅이 실패했습니다. 로그 파일을 확인하세요.");
  }

  return {
    inputPath: convertedPath,
    originalInputPath: inputPath,
    inputTree: await scanFileTree(convertedPath, { workspaceId, purpose: "input", offset: 0, limit: 50 }),
    audioSourceMapPath,
    logPath,
  };
}

function startAudioConversionTerminalPolling(workspaceId: WorkspaceId, plan: PythonRunPlan, onProgress?: WorkspaceRunProgressHandler): () => void {
  if (!onProgress) {
    return () => undefined;
  }

  let disposed = false;
  let lastSignature = "";
  const readAndEmit = async () => {
    if (disposed) {
      return;
    }

    try {
      const terminal = await readRunTerminalSnapshot(plan);
      const event = await createAudioConversionProgressEvent(workspaceId, plan.inputPath, plan.manifestPath, terminal);
      const signature = audioConversionProgressSignature(event);
      if (signature === lastSignature) {
        return;
      }

      lastSignature = signature;
      onProgress(event);
    } catch {
      // The converter may still be creating its log files. The next poll will retry.
    }
  };
  const timer = setInterval(() => void readAndEmit(), 650);
  void readAndEmit();

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}

async function emitAudioConversionTerminal(workspaceId: WorkspaceId, plan: PythonRunPlan, onProgress?: WorkspaceRunProgressHandler): Promise<void> {
  if (!onProgress) {
    return;
  }

  const terminal = await readRunTerminalSnapshot(plan);
  onProgress(await createAudioConversionProgressEvent(workspaceId, plan.inputPath, plan.manifestPath, terminal));
}

async function createAudioConversionProgressEvent(workspaceId: WorkspaceId, inputPathOrTree: string | FileTreeResult, manifestPath?: string, terminal?: WorkspaceTerminalUpdate): Promise<WorkspaceRunProgressEvent> {
  const inputTree = typeof inputPathOrTree === "string"
    ? await scanAudioConversionInputTree(workspaceId, inputPathOrTree, manifestPath)
    : inputPathOrTree;
  const progress = manifestPath ? await readAudioConversionProgress(manifestPath) : { total: 0, completed: 0, failed: 0, percent: 0 };
  return {
    workspaceId,
    table: createEmptyWorkspaceTable(workspaceId),
    details: [],
    progress,
    inputTree,
    terminal,
  };
}

function audioConversionProgressSignature(event: WorkspaceRunProgressEvent): string {
  return JSON.stringify({
    progress: event.progress,
    tree: fileTreeStatusSignature(event.inputTree),
    terminal: event.terminal ? `${event.terminal.text.length}/${event.terminal.text.slice(-240)}` : "",
  });
}

function fileTreeStatusSignature(tree: FileTreeResult | undefined): string {
  if (!tree) {
    return "";
  }

  const parts: string[] = [tree.rootPath];
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      parts.push(`${node.path}:${node.meta ?? ""}`);
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(tree.nodes);
  return parts.join("|");
}

async function scanAudioConversionInputTree(workspaceId: WorkspaceId, inputPath: string, manifestPath?: string): Promise<FileTreeResult> {
  const inputTree = await scanFileTree(inputPath, { workspaceId, purpose: "input", offset: 0, limit: 50 });
  const manifest = manifestPath ? await readAudioConversionManifest(manifestPath) : undefined;
  return annotateAudioConversionTree(inputTree, manifest);
}

async function readAudioConversionProgress(manifestPath: string): Promise<WorkspaceProgress> {
  const manifest = await readAudioConversionManifest(manifestPath);
  const summary = isRecord(manifest?.summary) ? manifest.summary : {};
  return normalizeProgress({
    total: numberValue(summary.totalFiles),
    completed: numberValue(summary.completed),
    failed: numberValue(summary.failed),
    percent: numberValue(summary.progress) * 100,
  });
}

async function readAudioConversionManifest(manifestPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function annotateAudioConversionTree(tree: FileTreeResult, manifest: Record<string, unknown> | undefined): FileTreeResult {
  const activeSourcePath = stringValue(manifest?.activeSourcePath);
  const completedJobs = new Map<string, Record<string, unknown>>();
  const jobs = Array.isArray(manifest?.jobs) ? manifest.jobs : [];
  for (const job of jobs) {
    if (!isRecord(job)) {
      continue;
    }

    const originalPath = stringValue(job.originalPath);
    if (originalPath) {
      completedJobs.set(normalizeAudioPathKey(originalPath), job);
    }
  }

  return {
    ...tree,
    nodes: tree.nodes.map((node) => annotateAudioConversionNodeStatus(node, activeSourcePath, completedJobs)),
  };
}

function annotateAudioConversionNodeStatus(node: FileTreeNode, activeSourcePath: string, completedJobs: Map<string, Record<string, unknown>>): FileTreeNode {
  if (node.kind === "directory") {
    return {
      ...node,
      children: node.children?.map((child) => annotateAudioConversionNodeStatus(child, activeSourcePath, completedJobs)),
    };
  }

  if (!isSupportedAudioPath(node.path) || isWavAudioPath(node.path)) {
    return node;
  }

  const sourceKey = normalizeAudioPathKey(node.path);
  const completedJob = completedJobs.get(sourceKey);
  const jobStatus = stringValue(completedJob?.status);
  const status = jobStatus === "cached"
    ? "\ubcc0\ud658 \uc900\ube44\ub428"
    : jobStatus === "completed"
      ? "\ubcc0\ud658 \uc644\ub8cc"
      : jobStatus === "failed"
        ? "\ubcc0\ud658 \uc2e4\ud328"
        : jobStatus === "running" || normalizeAudioPathKey(activeSourcePath) === sourceKey
          ? "\ubcc0\ud658 \uc911"
          : "\ubcc0\ud658 \ub300\uae30";

  return {
    ...node,
    meta: [node.meta, status].filter(Boolean).join(" | "),
  };
}

async function summarizeInputAudio(inputPath: string): Promise<{ total: number }> {
  const root = resolveFallbackInputFolder(inputPath);
  let total = 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { total };
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isDirectory() || !entry.isFile()) {
      continue;
    }
    if (!isSupportedAudioPath(join(root, entry.name))) {
      continue;
    }
    total += 1;
  }
  return { total };
}

function createAudioConvertingLayout(workspaceId: WorkspaceId): ReturnType<typeof createBackendLayout> {
  switch (workspaceId) {
    case "slice":
    case "tagging":
      return createBackendLayout({ markerScript: "main.py", venvFolder: ".ven_slice" });
    case "speaker":
      return createBackendLayout({ markerScript: "main.py", venvFolder: ".venv_noise" });
    case "overview":
    case "batch":
    case "training":
    case "inference":
      return createBackendLayout({ markerScript: "main.py", venvFolder: ".venv" });
  }
}

async function assertInputDirectory(path: string, message: string): Promise<void> {
  await assertInputPath(path, message);
  const pathStat = await stat(path);
  if (!pathStat.isDirectory()) {
    throw new Error(message);
  }
}

async function assertInputPath(path: string, message: string): Promise<void> {
  if (!path || !existsSync(path)) {
    throw new Error(message);
  }
}
