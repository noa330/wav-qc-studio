import { isAbsolute, resolve } from "node:path";
import type {
  SlicerSettings,
  SpeakerInferenceSettings,
  VoiceInferenceSettings,
  VoiceTrainingSettings,
  WorkspaceSettings,
} from "@shared/ipc";
import { OMNIVOICE_PRETRAINED } from "@shared/training-defaults";

const FIRERED_FRAME_MS = 10;

const WORD_ALIGNMENT_LANGUAGE_CODES = new Set([
  "ar",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "eu",
  "fa",
  "fi",
  "fr",
  "gl",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ka",
  "ko",
  "lv",
  "ml",
  "nl",
  "nn",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "te",
  "tl",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh",
]);

export function normalizeSlicerSettings(settings: WorkspaceSettings["slicer"]): SlicerSettings {
  const minEventMs = clamp(round(settings.minEventMs, 1), FIRERED_FRAME_MS, 5000 * FIRERED_FRAME_MS);
  return {
    splitGapMs: clamp(round(settings.splitGapMs, 1), 50, 60000),
    devicePreference: normalizeDevice(settings.devicePreference),
    speechThreshold: clamp(round(settings.speechThreshold, 3), 0, 1),
    smoothWindowMs: clamp(round(settings.smoothWindowMs, 1), FIRERED_FRAME_MS, 99 * FIRERED_FRAME_MS),
    minEventMs,
    maxEventMs: clamp(round(settings.maxEventMs, 1), minEventMs, 30000 * FIRERED_FRAME_MS),
    minSilenceMs: clamp(round(settings.minSilenceMs, 1), 0, 5000 * FIRERED_FRAME_MS),
    mergeSilenceMs: clamp(round(settings.mergeSilenceMs, 1), 0, 5000 * FIRERED_FRAME_MS),
    extendSpeechMs: clamp(round(settings.extendSpeechMs, 1), 0, 5000 * FIRERED_FRAME_MS),
    chunkMaxMs: clamp(round(settings.chunkMaxMs, 1), FIRERED_FRAME_MS, 120000 * FIRERED_FRAME_MS),
    speechPadMs: clamp(round(settings.speechPadMs, 1), 0, 2000),
    zeroCrossSearchMs: clamp(round(settings.zeroCrossSearchMs, 1), 0, 100),
    quietBoundarySearchMs: clamp(round(settings.quietBoundarySearchMs, 1), 0, 2000),
    monitorMergeGapMs: clamp(round(settings.monitorMergeGapMs, 1), 0, 2000),
    monitorMergeMaxMs: clamp(round(settings.monitorMergeMaxMs, 1), 0, 600000),
    spliceMs: clamp(round(settings.spliceMs, 1), 0, 500),
    floorGainDb: clamp(round(settings.floorGainDb, 1), -120, 0),
    normalizeMax: clamp(round(settings.normalizeMax, 3), 0, 1),
    normalizeAlpha: clamp(round(settings.normalizeAlpha, 3), 0, 1),
    pretrainedSedModelKey: normalizePretrainedSedModelKey(settings.pretrainedSedModelKey),
    pretrainedSedThresholds: normalizeThresholdList(settings.pretrainedSedThresholds ?? ""),
    pretrainedSedMedianWindow: clampInt(settings.pretrainedSedMedianWindow, 0, 99),
    pretrainedSedFrameInterval: clamp(round(finiteNumber(settings.pretrainedSedFrameInterval, 0.04), 3), 0.04, 30),
    pretrainedSedTopK: clampInt(settings.pretrainedSedTopK ?? 10, 1, 50),
    pretrainedSedMinScore: clamp(round(finiteNumber(settings.pretrainedSedMinScore, 0), 3), 0, 1),
  };
}

export function normalizeSpeakerSettings(settings: WorkspaceSettings["speaker"]): SpeakerInferenceSettings {
  return {
    ...settings,
    voiceFixerMode: clampInt(settings.voiceFixerMode, 0, 2),
    voiceFixerDevicePreference: normalizeDevice(settings.voiceFixerDevicePreference),
    resembleNfe: clampInt(settings.resembleNfe, 1, 128),
    resembleTau: clamp(round(settings.resembleTau, 2), 0, 1),
    resembleLambda: clamp(round(settings.resembleLambda, 2), 0, 1),
    resembleDevicePreference: normalizeDevice(settings.resembleDevicePreference),
    sidonDevicePreference: normalizeDevice(settings.sidonDevicePreference),
    sidonInputPeak: clamp(round(settings.sidonInputPeak, 3), 0, 1),
    sidonHighPassHz: clamp(round(settings.sidonHighPassHz, 1), 0, 1000),
    sidonChunkSeconds: clampInt(settings.sidonChunkSeconds, 1, 600),
    sidonPrePadding: clampInt(settings.sidonPrePadding, 0, 480000),
    sidonTrailingPad: clampInt(settings.sidonTrailingPad, 0, 480000),
    sidonDecoderTrim: clampInt(settings.sidonDecoderTrim, 0, 480000),
    sidonFeatureCacheFrames: clampInt(settings.sidonFeatureCacheFrames, 0, 8),
  };
}

export function normalizeOverviewSettings(settings: WorkspaceSettings["overview"]): WorkspaceSettings["overview"] {
  return {
    analyzeNoise: Boolean(settings.analyzeNoise),
    noiseSampleRate: clampInt(settings.noiseSampleRate, 8000, 48000),
    noisePersonalized: Boolean(settings.noisePersonalized),
    noiseNumThreads: clampInt(settings.noiseNumThreads, 0, 64),
    noiseRequireCudaProvider: Boolean(settings.noiseRequireCudaProvider),
    noiseBakBadThreshold: clamp(round(settings.noiseBakBadThreshold, 2), 0, 5),
  };
}

export function normalizeBatchSettings(settings: WorkspaceSettings["batch"]): WorkspaceSettings["batch"] {
  const rest = { ...settings } as WorkspaceSettings["batch"] & Record<string, unknown>;
  delete rest[["wordAlignment", "Use", "Uro", "man"].join("")];
  delete rest["muteTranscriptOutsideOnExport"];
  return {
    ...rest,
    transcriptionLanguage: normalizeLanguage(settings.transcriptionLanguage),
    whisperAsrModel: settings.whisperAsrModel.trim() || "large-v3",
    whisperBeamSize: clampInt(settings.whisperBeamSize, 1, 32),
    whisperVadFilter: Boolean(settings.whisperVadFilter),
    whisperComputeTypeCpu: settings.whisperComputeTypeCpu.trim() || "int8",
    whisperComputeTypeCuda: settings.whisperComputeTypeCuda.trim() || "float16",
    whisperSuppressNumerals: Boolean(settings.whisperSuppressNumerals),
    whisperInitialPrompt: settings.whisperInitialPrompt.trim(),
    wordAlignmentLanguageCode: normalizeWordAlignmentLanguage(settings.wordAlignmentLanguageCode ?? "ko"),
    wordAlignmentDevicePreference: normalizeDevice(settings.wordAlignmentDevicePreference ?? "auto"),
    wordAlignmentLowScoreThreshold: clamp(round(finiteNumber(settings.wordAlignmentLowScoreThreshold, 0.72), 2), 0.1, 0.95),
    wordAlignmentMissingScoreThreshold: clamp(round(finiteNumber(settings.wordAlignmentMissingScoreThreshold, 0.2), 2), 0.02, 0.8),
    playTranscriptOutside: Boolean(settings.playTranscriptOutside),
    showAllAlignmentOutsideSegments: Boolean(settings.showAllAlignmentOutsideSegments),
    diarizenModelId: settings.diarizenModelId.trim() || "BUT-FIT/diarizen-wavlm-large-s80-md-v2",
    diarizenEmbeddingModelId: settings.diarizenEmbeddingModelId.trim() || "pyannote/wespeaker-voxceleb-resnet34-LM",
    batchSpeakerTargetSampleRate: clampInt(settings.batchSpeakerTargetSampleRate, 8000, 48000),
    batchSpeakerMinOverlapSec: clamp(round(settings.batchSpeakerMinOverlapSec, 3), 0, 10),
  };
}

export function normalizeTrainingSettings(settings: WorkspaceSettings["training"], projectRoot: string): VoiceTrainingSettings {
  const selectedModel = settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  return {
    ...settings,
    selectedModel,
    toolRoot: resolveProjectRelativePath(projectRoot, settings.toolRoot.trim() || "training"),
    modelName: sanitizeModelName(settings.modelName) || (selectedModel === "gpt-sovits" ? "gpt_sovits_train" : "omnivoice_train"),
    gpu: settings.gpu.trim() || "0",
    idleTimeoutSec: clampInt(settings.idleTimeoutSec, 60, 7200),
    gptVersion: normalizeGptVersion(settings.gptVersion),
    gptSovitsBatchSize: clampInt(settings.gptSovitsBatchSize, 1, 128),
    gptSovitsEpochs: clampInt(settings.gptSovitsEpochs, 1, 10000),
    gptSovitsSaveEveryEpoch: clampInt(settings.gptSovitsSaveEveryEpoch, 1, 10000),
    gptTextLowLrRate: clamp(round(settings.gptTextLowLrRate, 3), 0, 1),
    gptSovitsSaveLatest: Boolean(settings.gptSovitsSaveLatest),
    gptSovitsSaveEveryWeights: Boolean(settings.gptSovitsSaveEveryWeights),
    gptGradCheckpoint: Boolean(settings.gptGradCheckpoint),
    gptLoraRank: clampInt(settings.gptLoraRank, 1, 512),
    gptPretrainedS2G: resolveOptionalProjectRelativePath(projectRoot, settings.gptPretrainedS2G),
    gptPretrainedS2D: resolveOptionalProjectRelativePath(projectRoot, settings.gptPretrainedS2D),
    gptResumeSovitsPath: resolveOptionalProjectRelativePath(projectRoot, settings.gptResumeSovitsPath ?? ""),
    gptResumeGptPath: resolveOptionalProjectRelativePath(projectRoot, settings.gptResumeGptPath ?? ""),
    gptBatchSize: clampInt(settings.gptBatchSize, 1, 128),
    gptEpochs: clampInt(settings.gptEpochs, 1, 10000),
    gptSaveEveryEpoch: clampInt(settings.gptSaveEveryEpoch, 1, 10000),
    gptSaveLatest: Boolean(settings.gptSaveLatest),
    gptSaveEveryWeights: Boolean(settings.gptSaveEveryWeights),
    gptDpo: Boolean(settings.gptDpo),
    gptPretrainedS1: resolveOptionalProjectRelativePath(projectRoot, settings.gptPretrainedS1),
    omniSteps: clampInt(settings.omniSteps, 1, 10000000),
    omniSaveSteps: clampInt(settings.omniSaveSteps, 1, 10000000),
    omniLoggingSteps: clampInt(settings.omniLoggingSteps, 1, 10000000),
    omniLearningRate: clamp(Number.isFinite(settings.omniLearningRate) ? settings.omniLearningRate : 0.00001, 0, 1),
    omniBatchTokens: clampInt(settings.omniBatchTokens, 1, 10000000),
    omniGradientAccumulationSteps: clampInt(settings.omniGradientAccumulationSteps, 1, 100000),
    omniNumWorkers: clampInt(settings.omniNumWorkers, 0, 128),
    omniMixedPrecision: settings.omniMixedPrecision === "no" || settings.omniMixedPrecision === "fp16" ? settings.omniMixedPrecision : "bf16",
    omniSeed: clampInt(settings.omniSeed, 0, 2147483647),
    omniMaxBatchSize: clampInt(settings.omniMaxBatchSize, 1, 1024),
    omniMaxSampleTokens: clampInt(settings.omniMaxSampleTokens, 1, 10000000),
    omniMinSampleTokens: clampInt(settings.omniMinSampleTokens, 1, 10000000),
    omniLlmNameOrPath: settings.omniLlmNameOrPath.trim() || OMNIVOICE_PRETRAINED.llmNameOrPath,
    omniInitFromCheckpoint: resolveOptionalProjectRelativePath(projectRoot, settings.omniInitFromCheckpoint.trim() || OMNIVOICE_PRETRAINED.initFromCheckpoint),
    omniResumeFromCheckpoint: settings.omniResumeFromCheckpoint.trim(),
    omniUseDeepspeed: Boolean(settings.omniUseDeepspeed),
    omniDeepspeedConfig: settings.omniDeepspeedConfig.trim(),
    omniModelOnlyCheckpoint: settings.omniModelOnlyCheckpoint === false ? false : true,
  };
}

export function normalizeInferenceSettings(settings: WorkspaceSettings["inference"], projectRoot: string): VoiceInferenceSettings {
  const selectedModel = settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  const gptMode = settings.gptMode === "checkpoint" ? "checkpoint" : "zero-shot";
  const gptVersion = normalizeGptVersion(settings.gptVersion);
  const gptTextLanguage = normalizeGptInferenceLanguage(settings.gptTextLanguage, gptVersion);
  return {
    ...settings,
    selectedModel,
    toolRoot: resolveProjectRelativePath(projectRoot, settings.toolRoot.trim() || "training"),
    modelName: sanitizeModelName(settings.modelName) || (selectedModel === "gpt-sovits" ? "gpt_sovits_infer" : "omnivoice_infer"),
    referenceAudioPath: resolveOptionalProjectRelativePath(projectRoot, settings.referenceAudioPath),
    outputAudioPath: resolveOptionalProjectRelativePath(projectRoot, settings.outputAudioPath),
    gpu: settings.gpu.trim() || "0",
    idleTimeoutSec: clampInt(settings.idleTimeoutSec, 60, 7200),
    gptVersion,
    gptTextLanguage,
    gptPromptLanguage: normalizeGptInferenceLanguage(settings.gptPromptLanguage, gptVersion, gptTextLanguage),
    gptMode,
    gptCheckpointSovitsPath: resolveOptionalProjectRelativePath(projectRoot, gptMode === "checkpoint" ? settings.gptCheckpointSovitsPath : ""),
    gptCheckpointGptPath: resolveOptionalProjectRelativePath(projectRoot, gptMode === "checkpoint" ? settings.gptCheckpointGptPath : ""),
    gptTopK: clampInt(settings.gptTopK, 1, 1000),
    gptTopP: clamp(round(settings.gptTopP, 3), 0, 1),
    gptTemperature: clamp(round(settings.gptTemperature, 3), 0, 10),
    gptTextSplitMethod: settings.gptTextSplitMethod.trim() || "cut5",
    gptBatchSize: clampInt(settings.gptBatchSize, 1, 512),
    gptBatchThreshold: clamp(round(settings.gptBatchThreshold, 3), 0, 1),
    gptSplitBucket: Boolean(settings.gptSplitBucket),
    gptSpeedFactor: clamp(round(settings.gptSpeedFactor, 3), 0.1, 10),
    gptFragmentInterval: clamp(round(settings.gptFragmentInterval, 3), 0, 10),
    gptSeed: clampInt(settings.gptSeed, -1, 2147483647),
    gptParallelInfer: Boolean(settings.gptParallelInfer),
    gptRepetitionPenalty: clamp(round(settings.gptRepetitionPenalty, 3), 0, 10),
    gptSampleSteps: clampInt(settings.gptSampleSteps, 1, 1000),
    gptSuperSampling: Boolean(settings.gptSuperSampling),
    gptOverlapLength: clampInt(settings.gptOverlapLength, 0, 1000),
    gptMinChunkLength: clampInt(settings.gptMinChunkLength, 0, 100000),
    omniMode: settings.omniMode === "checkpoint" ? "checkpoint" : "zero-shot",
    omniCheckpointPath: resolveOptionalProjectRelativePath(projectRoot, settings.omniCheckpointPath),
    omniLanguage: settings.omniLanguage.trim() || "ko",
    omniInstruct: settings.omniInstruct.trim(),
    omniNumStep: clampInt(settings.omniNumStep, 1, 1000),
    omniGuidanceScale: clamp(round(settings.omniGuidanceScale, 3), 0, 100),
    omniSpeed: clamp(round(settings.omniSpeed, 3), 0.1, 10),
    omniDuration: clamp(round(settings.omniDuration, 3), 0, 3600),
    omniTShift: round(settings.omniTShift, 3),
    omniDenoise: Boolean(settings.omniDenoise),
    omniPostprocessOutput: Boolean(settings.omniPostprocessOutput),
    omniLayerPenaltyFactor: round(settings.omniLayerPenaltyFactor, 3),
    omniPositionTemperature: round(settings.omniPositionTemperature, 3),
    omniClassTemperature: round(settings.omniClassTemperature, 3),
  };
}

export function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase() || "auto";
}

export function boolArg(value: boolean): string {
  return value ? "true" : "false";
}

export function timestamp(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    `${now.getMonth() + 1}`.padStart(2, "0"),
    `${now.getDate()}`.padStart(2, "0"),
  ].join("");
  const time = [`${now.getHours()}`.padStart(2, "0"), `${now.getMinutes()}`.padStart(2, "0"), `${now.getSeconds()}`.padStart(2, "0")].join("");
  return `${date}_${time}_${`${now.getMilliseconds()}`.padStart(3, "0")}`;
}

export function msToFireRedFrame(value: number, min: number, max: number): number {
  return clampInt(Math.round(value / FIRERED_FRAME_MS), min, max);
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function resolveOptionalProjectRelativePath(projectRoot: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? resolveProjectRelativePath(projectRoot, trimmed) : "";
}

function resolveProjectRelativePath(projectRoot: string, value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

function normalizeGptVersion(value: string): VoiceTrainingSettings["gptVersion"] {
  return value === "v1" || value === "v2" || value === "v3" || value === "v4" || value === "v2Pro" || value === "v2ProPlus" ? value : "v2";
}

function normalizeGptInferenceLanguage(value: string, version: VoiceTrainingSettings["gptVersion"], fallback?: string): string {
  const normalized = value.trim();
  const supported = version === "v1"
    ? new Set(["all_zh", "en", "all_ja", "zh", "ja", "auto"])
    : new Set(["all_zh", "en", "all_ja", "all_yue", "all_ko", "zh", "ja", "yue", "ko", "auto", "auto_yue"]);
  if (supported.has(normalized)) {
    return normalized;
  }
  if (fallback && supported.has(fallback)) {
    return fallback;
  }
  return version === "v1" ? "all_zh" : "all_ko";
}

function sanitizeModelName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/gu, "_").replace(/\s+/gu, "_").replace(/^\.+/u, "").slice(0, 80);
}

function normalizeDevice(value: string): "auto" | "cuda" | "cpu" {
  return value === "cuda" || value === "cpu" ? value : "auto";
}

function normalizePretrainedSedModelKey(value: string): "beats" | "atst_f" | "fpasst" {
  return value === "atst_f" || value === "fpasst" ? value : "beats";
}

function normalizeThresholdList(value: string): string {
  const thresholds = value
    .replace(/[\r\n;]/gu, ",")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 1);
  return thresholds.length > 0 ? thresholds.join(",") : "0.1,0.2,0.5";
}

function normalizeWordAlignmentLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliased = (
    {
      auto: "ko",
      detect: "ko",
      kor: "ko",
      korean: "ko",
      jpn: "ja",
      japanese: "ja",
      zho: "zh",
      chi: "zh",
      cmn: "zh",
      chinese: "zh",
      eng: "en",
      english: "en",
    } as Record<string, string>
  )[normalized] ?? normalized;
  const base = aliased.split("-", 1)[0] || "ko";
  return WORD_ALIGNMENT_LANGUAGE_CODES.has(base) ? base : "ko";
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(Number.isFinite(value) ? value : min, min, max));
}
