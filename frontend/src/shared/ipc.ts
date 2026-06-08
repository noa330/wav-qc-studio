
export const AUDIO_INPUT_EXTENSIONS = [
  ".wav",
  ".wave",
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".aiff",
  ".aif",
  ".aifc",
  ".wma",
  ".webm",
  ".mp4",
  ".caf",
  ".amr",
] as const;

export const WAV_AUDIO_EXTENSIONS = [".wav", ".wave"] as const;

export const IPC_CHANNELS = {
  appInfo: "app:info",
  appUpdateCheck: "app:update-check",
  appUpdateInstall: "app:update-install",
  appUpdateState: "app:update-state",
  appUpdateStateChanged: "app:update-state-changed",
  loadAppState: "app-state:load",
  saveAppState: "app-state:save",
  saveAppStateSync: "app-state:save-sync",
  createProject: "project:create",
  loadProjectState: "project:load-state",
  updateStartupSplash: "startup-splash:update",
  completeStartupSplash: "startup-splash:complete",
  selectFolder: "dialog:select-folder",
  selectFile: "dialog:select-file",
  scanPath: "filesystem:scan-path",
  readWaveform: "audio:read-waveform",
  cropWave: "audio:crop-wave",
  editWave: "audio:edit-wave",
  loadWorkspace: "workspace:load",
  runWorkspace: "workspace:run",
  runWorkspaceProgress: "workspace:run-progress",
  checkWorkspaceRuntime: "workspace:runtime-check",
  installWorkspaceRuntime: "workspace:runtime-install",
  checkVoiceModelRuntime: "voice:model-runtime-check",
  installVoiceModelRuntime: "voice:model-runtime-install",
  listTrainingModels: "training:list-models",
  startTensorBoard: "training:start-tensorboard",
  runBatchSpeakerDiarization: "workspace:batch-speaker-diarize",
  exportWorkspace: "workspace:export",
  exportWorkspaceProgress: "workspace:export-progress",
  cancelWorkspace: "workspace:cancel",
} as const;

export type AppInfo = {
  platform: string;
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
};

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "not-available"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type AppUpdateState = {
  phase: AppUpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  checkedAt?: string;
  releaseName?: string;
  releaseDate?: string;
  error?: string;
};

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AppStateSnapshot = {
  schemaVersion: number;
  savedAt: string;
  payload: JsonValue;
};

export type AppStateLoadResult = {
  ok: boolean;
  snapshot?: AppStateSnapshot;
  error?: string;
};

export type AppStateSaveRequest = {
  snapshot: AppStateSnapshot;
};

export type AppStateSaveResult = {
  ok: boolean;
  error?: string;
};

export type StartupSplashStepState = "done" | "active" | "pending";

export type StartupSplashStep = {
  id: string;
  label: string;
  state: StartupSplashStepState;
};

export type StartupSplashProgress = {
  progressPercent: number;
  statusText: string;
  detailText?: string;
  steps?: StartupSplashStep[];
};

export type StartupSplashResult = {
  ok: boolean;
};

export type WorkspaceId = "slice" | "tagging" | "speaker" | "overview" | "batch" | "training" | "inference";

export type DialogSelectionResult = {
  canceled: boolean;
  path: string | null;
};

export type DialogFileFilter = {
  name: string;
  extensions: string[];
};

export type DialogFileSelectionOptions = {
  title?: string;
  filters?: DialogFileFilter[];
};

export type CreateProjectRequest = {
  name: string;
};

export type CreateProjectResult = {
  ok: boolean;
  name?: string;
  rootPath?: string;
  error?: string;
};

export type ProjectStateLoadRequest = {
  projectId: string;
  rootPath?: string;
};

export type ProjectStateLoadResult = {
  ok: boolean;
  state?: JsonValue;
  error?: string;
};

export type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  meta?: string;
  dataset?: {
    speaker?: string;
    language?: string;
    text?: string;
  };
  exportRowId?: string;
  children?: FileTreeNode[];
};

export type FileTreeWindow = {
  offset: number;
  limit: number;
  total: number;
  hasPrevious: boolean;
  hasMore: boolean;
};

export type FileTreeResult = {
  rootPath: string;
  nodes: FileTreeNode[];
  window?: FileTreeWindow;
};

export type FileTreeScanOptions = {
  workspaceId?: WorkspaceId;
  purpose?: "input" | "output";
  offset?: number;
  limit?: number;
  targetPath?: string;
};

export type WaveformData = {
  path: string;
  durationSeconds: number;
  peaks: number[];
  minPeaks?: number[];
  maxPeaks?: number[];
  samples?: number[];
  sampleRate?: number;
  viewStart?: number;
  viewEnd?: number;
  mode?: "envelope" | "samples";
  error?: string;
};

export type WaveformReadOptions = {
  bucketCount?: number;
  viewStart?: number;
  viewEnd?: number;
};

export type AudioCropRequest = {
  sourcePath: string;
  startRatio: number;
  endRatio: number;
};

export type AudioCropResult = {
  ok: boolean;
  sourcePath: string;
  backupPath?: string;
  durationSeconds?: number;
  error?: string;
};

export type AudioEditOperation = "cut" | "copy" | "delete" | "keep" | "paste";

export type AudioEditRequest = {
  sourcePath: string;
  operation: AudioEditOperation;
  startSec: number;
  endSec: number;
  clipboardPath?: string;
};

export type AudioEditResult = {
  ok: boolean;
  sourcePath: string;
  outputPath?: string;
  clipboardPath?: string;
  durationSeconds?: number;
  clipboardDurationSeconds?: number;
  error?: string;
};

export type AudioEditExportMap = Record<string, string>;

export type DataTableColumn = {
  key: string;
  label: string;
};

export type DataTableRow = {
  id: string;
  cells: Record<string, string>;
  sourcePath?: string;
  raw?: Record<string, string>;
};

export type DataTable = {
  columns: DataTableColumn[];
  rows: DataTableRow[];
};

export type DetailField = {
  label: string;
  value: string;
};

export type WorkspacePaths = {
  inputPath: string;
  originalInputPath?: string;
  outputPath?: string;
  projectRoot?: string;
  sheetId?: string;
};

export type SlicerSettings = {
  splitGapMs: number;
  devicePreference: "auto" | "cuda" | "cpu";
  speechThreshold: number;
  smoothWindowMs: number;
  minEventMs: number;
  maxEventMs: number;
  minSilenceMs: number;
  mergeSilenceMs: number;
  extendSpeechMs: number;
  chunkMaxMs: number;
  speechPadMs: number;
  zeroCrossSearchMs: number;
  quietBoundarySearchMs: number;
  monitorMergeGapMs: number;
  monitorMergeMaxMs: number;
  spliceMs: number;
  floorGainDb: number;
  normalizeMax: number;
  normalizeAlpha: number;
  pretrainedSedModelKey: "beats" | "atst_f" | "fpasst";
  pretrainedSedThresholds: string;
  pretrainedSedMedianWindow: number;
  pretrainedSedFrameInterval: number;
  pretrainedSedTopK: number;
  pretrainedSedMinScore: number;
};

export type SpeakerInferenceSettings = {
  useVoiceFixer: boolean;
  voiceFixerMode: number;
  voiceFixerDevicePreference: "auto" | "cuda" | "cpu";
  useResemble: boolean;
  resembleTask: "enhance" | "denoise_only";
  resembleSolver: "midpoint" | "rk4" | "euler";
  resembleNfe: number;
  resembleTau: number;
  resembleLambda: number;
  resembleDevicePreference: "auto" | "cuda" | "cpu";
  useSidon: boolean;
  sidonDevicePreference: "auto" | "cuda" | "cpu";
  sidonInputPeak: number;
  sidonHighPassHz: number;
  sidonChunkSeconds: number;
  sidonPrePadding: number;
  sidonTrailingPad: number;
  sidonDecoderTrim: number;
  sidonStereoMixMode: "average" | "left" | "right";
  sidonOutputBitDepth: "pcm16" | "float32";
  sidonAudioBackendPreference: "auto" | "soundfile" | "ffmpeg" | "sox" | "soundfile_direct";
  sidonFeatureCacheFrames: number;
};

export type OverviewSettings = {
  analyzeNoise: boolean;
  noiseSampleRate: number;
  noisePersonalized: boolean;
  noiseNumThreads: number;
  noiseRequireCudaProvider: boolean;
  noiseBakBadThreshold: number;
};

export type BatchQcExportJob = {
  id: string;
  fileName: string;
  originalPath: string;
  transcript: string;
  language: string;
  speaker: string;
};

export type BatchQcSettings = {
  exportFormat: "gsv" | "omni";
  transcriptionLanguage: string;
  whisperAsrModel: string;
  whisperBeamSize: number;
  whisperVadFilter: boolean;
  whisperComputeTypeCpu: string;
  whisperComputeTypeCuda: string;
  whisperSuppressNumerals: boolean;
  whisperInitialPrompt: string;
  wordAlignmentLanguageCode: string;
  wordAlignmentDevicePreference: "auto" | "cuda" | "cpu";
  wordAlignmentLowScoreThreshold: number;
  wordAlignmentMissingScoreThreshold: number;
  playTranscriptOutside: boolean;
  showAllAlignmentOutsideSegments: boolean;
  diarizenModelId: string;
  diarizenEmbeddingModelId: string;
  batchSpeakerTargetSampleRate: number;
  batchSpeakerMinOverlapSec: number;
  jobs: BatchQcExportJob[];
};

export type VoiceTrainingModel = "gpt-sovits" | "omnivoice";

export type VoiceTrainingSettings = {
  selectedModel: VoiceTrainingModel;
  toolRoot: string;
  modelName: string;
  gpu: string;
  idleTimeoutSec: number;
  gptVersion: "v1" | "v2" | "v3" | "v4" | "v2Pro" | "v2ProPlus";
  gptSovitsBatchSize: number;
  gptSovitsEpochs: number;
  gptSovitsSaveEveryEpoch: number;
  gptTextLowLrRate: number;
  gptSovitsSaveLatest: boolean;
  gptSovitsSaveEveryWeights: boolean;
  gptGradCheckpoint: boolean;
  gptLoraRank: number;
  gptPretrainedS2G: string;
  gptPretrainedS2D: string;
  gptResumeSovitsPath: string;
  gptResumeGptPath: string;
  gptBatchSize: number;
  gptEpochs: number;
  gptSaveEveryEpoch: number;
  gptSaveLatest: boolean;
  gptSaveEveryWeights: boolean;
  gptDpo: boolean;
  gptPretrainedS1: string;
  omniSteps: number;
  omniSaveSteps: number;
  omniLoggingSteps: number;
  omniLearningRate: number;
  omniBatchTokens: number;
  omniGradientAccumulationSteps: number;
  omniNumWorkers: number;
  omniMixedPrecision: "no" | "fp16" | "bf16";
  omniSeed: number;
  omniMaxBatchSize: number;
  omniMaxSampleTokens: number;
  omniMinSampleTokens: number;
  omniLlmNameOrPath: string;
  omniInitFromCheckpoint: string;
  omniResumeFromCheckpoint: string;
  omniUseDeepspeed: boolean;
  omniDeepspeedConfig: string;
  omniModelOnlyCheckpoint: boolean;
};

export type VoiceInferenceModel = VoiceTrainingModel;
export type VoiceInferenceRunMode = "single" | "batch";

export type VoiceInferenceSettings = {
  selectedModel: VoiceInferenceModel;
  toolRoot: string;
  modelName: string;
  inferenceRunMode: VoiceInferenceRunMode;
  referenceAudioPath: string;
  batchReferenceAudioPaths: string[];
  gptAuxReferenceAudioPaths: string[];
  referenceText: string;
  referenceTextsByAudioPath: Record<string, string>;
  outputText: string;
  outputAudioPath: string;
  gpu: string;
  idleTimeoutSec: number;
  gptVersion: "v1" | "v2" | "v3" | "v4" | "v2Pro" | "v2ProPlus";
  gptTextLanguage: string;
  gptPromptLanguage: string;
  gptMode: "zero-shot" | "checkpoint";
  gptCheckpointSovitsPath: string;
  gptCheckpointGptPath: string;
  gptTopK: number;
  gptTopP: number;
  gptTemperature: number;
  gptTextSplitMethod: string;
  gptBatchSize: number;
  gptBatchThreshold: number;
  gptSplitBucket: boolean;
  gptSpeedFactor: number;
  gptFragmentInterval: number;
  gptSeed: number;
  gptParallelInfer: boolean;
  gptRepetitionPenalty: number;
  gptSampleSteps: number;
  gptSuperSampling: boolean;
  gptOverlapLength: number;
  gptMinChunkLength: number;
  omniMode: "zero-shot" | "checkpoint";
  omniCheckpointPath: string;
  omniLanguage: string;
  omniInstruct: string;
  omniNumStep: number;
  omniGuidanceScale: number;
  omniSpeed: number;
  omniDuration: number;
  omniTShift: number;
  omniDenoise: boolean;
  omniPostprocessOutput: boolean;
  omniLayerPenaltyFactor: number;
  omniPositionTemperature: number;
  omniClassTemperature: number;
};

export type WorkspaceSettings = {
  slicer: SlicerSettings;
  speaker: SpeakerInferenceSettings;
  overview: OverviewSettings;
  batch: BatchQcSettings;
  training: VoiceTrainingSettings;
  inference: VoiceInferenceSettings;
};

export type WorkspaceRunRequest = {
  workspaceId: WorkspaceId;
  paths: WorkspacePaths;
  settings: WorkspaceSettings;
  retry?: {
    sourcePaths?: string[];
  };
  audioEdits?: AudioEditExportMap;
};

export type WorkspaceRuntimeEnvironmentId = "main" | "noise" | "slice";

export type WorkspaceRuntimeEnvironmentRequirement = {
  id: WorkspaceRuntimeEnvironmentId;
  label: string;
  path: string;
  installed: boolean;
};

export type WorkspaceRuntimeEnvironmentStatus = {
  workspaceId: WorkspaceId;
  ok: boolean;
  checkedAt: string;
  requirements: WorkspaceRuntimeEnvironmentRequirement[];
};

export type WorkspaceRuntimeEnvironmentRequest = {
  workspaceId: WorkspaceId;
};

export type WorkspaceRuntimeEnvironmentInstallResult = {
  ok: boolean;
  workspaceId: WorkspaceId;
  status: WorkspaceRuntimeEnvironmentStatus;
  exitCode?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  logPath?: string;
  command?: string;
};

export type VoiceModelRuntimeStatus = {
  workspaceId: WorkspaceId;
  selectedModel: VoiceTrainingModel;
  toolRoot: string;
  gptVersion?: VoiceTrainingSettings["gptVersion"];
  settingsKey: string;
  label: string;
  path: string;
  ok: boolean;
  checkedAt: string;
  error?: string;
};

export type VoiceModelRuntimeRequest = {
  workspaceId: WorkspaceId;
  settings: WorkspaceSettings;
};

export type VoiceModelRuntimeInstallResult = {
  ok: boolean;
  workspaceId: WorkspaceId;
  status: VoiceModelRuntimeStatus;
  exitCode?: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  logPath?: string;
  command?: string;
};

export type TrainingCheckpointSummary = {
  id: string;
  label: string;
  path: string;
  kind: "gpt" | "sovits" | "omnivoice";
  role?: "resume" | "inference" | "resume-inference";
  component?: "semantic" | "generator" | "discriminator" | "model";
  epoch?: string;
  step?: string;
  sizeBytes?: number;
  modifiedAt?: number;
};

export type TrainingModelSummary = {
  name: string;
  path: string;
  checkpoints: TrainingCheckpointSummary[];
  tensorBoardLogDir?: string;
  modifiedAt?: number;
};

export type TrainingModelListRequest = {
  settings: VoiceTrainingSettings;
};

export type TrainingModelListResult = {
  selectedModel: VoiceTrainingModel;
  models: TrainingModelSummary[];
  error?: string;
};

export type TensorBoardSessionRequest = {
  settings: VoiceTrainingSettings;
};

export type TensorBoardSessionResult = {
  ok: boolean;
  selectedModel: VoiceTrainingModel;
  modelName: string;
  logDir?: string;
  url?: string;
  error?: string;
};

export type WorkspaceBatchSpeakerDiarizationRequest = {
  workspaceId: "batch";
  paths: WorkspacePaths;
  settings: WorkspaceSettings;
  table: DataTable;
};

export type WorkspaceCancelRequest = {
  workspaceId: WorkspaceId;
  operation?: "run" | "export" | "batchSpeaker" | "runtimeInstall" | "modelInstall";
};

export type WorkspaceCancelResult = {
  ok: boolean;
  workspaceId: WorkspaceId;
};

export type WorkspaceExportRowDecision = {
  rowId: string;
  includeAudio: boolean;
};

export type WorkspaceExportRequest = {
  workspaceId: WorkspaceId;
  paths: WorkspacePaths;
  settings: WorkspaceSettings;
  table: DataTable;
  rowDecisions: WorkspaceExportRowDecision[];
  audioEdits?: AudioEditExportMap;
};

export type WorkspaceLoadRequest = {
  workspaceId: WorkspaceId;
  paths: WorkspacePaths;
  settings?: WorkspaceSettings;
};

export type WorkspaceRunMetadata = {
  projectRoot: string;
  pythonPath: string;
  scriptPath: string;
  inputPath: string;
  outputPath: string;
  manifestPath?: string;
  outputCsvPath?: string;
  logPath: string;
  backendLogPath?: string;
  launcherPath?: string;
  command: string;
};

export type WorkspaceTerminalUpdate = {
  text: string;
  logPath?: string;
  backendLogPath?: string;
  command?: string;
  updatedAt: string;
};

export type WorkspaceRunResult = {
  ok: boolean;
  workspaceId: WorkspaceId;
  exitCode?: number;
  error?: string;
  stderr?: string;
  stdout?: string;
  cancelled?: boolean;
  metadata?: WorkspaceRunMetadata;
  table: DataTable;
  details: DetailField[];
  inputTree?: FileTreeResult;
  outputTree?: FileTreeResult;
  progress?: WorkspaceProgress;
};

export type WorkspaceProgress = {
  total: number;
  completed: number;
  failed: number;
  percent: number;
};

export type WorkspaceRunProgressEvent = {
  workspaceId: WorkspaceId;
  table: DataTable;
  details: DetailField[];
  progress: WorkspaceProgress;
  activeAudioPath?: string;
  referenceText?: string;
  outputText?: string;
  inputTree?: FileTreeResult;
  terminal?: WorkspaceTerminalUpdate;
};

export type WorkspaceExportResult = {
  ok: boolean;
  workspaceId: WorkspaceId;
  error?: string;
  cancelled?: boolean;
  outputPath?: string;
  outputCsvPath?: string;
  logPath?: string;
  table: DataTable;
  details: DetailField[];
  outputTree?: FileTreeResult;
  progress?: WorkspaceProgress;
};

export type WorkspaceExportProgressEvent = {
  workspaceId: WorkspaceId;
  outputPath?: string;
  outputTree?: FileTreeResult;
  table: DataTable;
  details: DetailField[];
  progress: WorkspaceProgress;
};

export type StudioBackendApi = {
  getAppInfo: () => AppInfo;
  checkAppUpdate: () => Promise<AppUpdateState>;
  getAppUpdateState: () => Promise<AppUpdateState>;
  installAppUpdate: () => Promise<AppUpdateState>;
  onAppUpdateState: (callback: (state: AppUpdateState) => void) => () => void;
  loadAppState: () => Promise<AppStateLoadResult>;
  saveAppState: (request: AppStateSaveRequest) => Promise<AppStateSaveResult>;
  saveAppStateSync: (request: AppStateSaveRequest) => AppStateSaveResult;
  createProject: (request: CreateProjectRequest) => Promise<CreateProjectResult>;
  loadProjectState: (request: ProjectStateLoadRequest) => Promise<ProjectStateLoadResult>;
  updateStartupSplash: (progress: StartupSplashProgress) => Promise<StartupSplashResult>;
  completeStartupSplash: () => Promise<StartupSplashResult>;
  selectFolder: () => Promise<DialogSelectionResult>;
  selectFile: (options?: DialogFileSelectionOptions) => Promise<DialogSelectionResult>;
  scanPath: (path: string, options?: FileTreeScanOptions) => Promise<FileTreeResult>;
  readWaveform: (path: string, options?: number | WaveformReadOptions) => Promise<WaveformData>;
  cropWave: (request: AudioCropRequest) => Promise<AudioCropResult>;
  editWave: (request: AudioEditRequest) => Promise<AudioEditResult>;
  loadWorkspace: (request: WorkspaceLoadRequest) => Promise<Pick<WorkspaceRunResult, "workspaceId" | "table" | "details" | "inputTree" | "outputTree"> & { inputPath?: string; originalInputPath?: string; outputPath?: string; audioSourceMapPath?: string; logPath?: string }>;
  runWorkspace: (request: WorkspaceRunRequest) => Promise<WorkspaceRunResult>;
  checkWorkspaceRuntime: (request: WorkspaceRuntimeEnvironmentRequest) => Promise<WorkspaceRuntimeEnvironmentStatus>;
  installWorkspaceRuntime: (request: WorkspaceRuntimeEnvironmentRequest) => Promise<WorkspaceRuntimeEnvironmentInstallResult>;
  checkVoiceModelRuntime: (request: VoiceModelRuntimeRequest) => Promise<VoiceModelRuntimeStatus>;
  installVoiceModelRuntime: (request: VoiceModelRuntimeRequest) => Promise<VoiceModelRuntimeInstallResult>;
  listTrainingModels: (request: TrainingModelListRequest) => Promise<TrainingModelListResult>;
  startTensorBoard: (request: TensorBoardSessionRequest) => Promise<TensorBoardSessionResult>;
  runBatchSpeakerDiarization: (request: WorkspaceBatchSpeakerDiarizationRequest) => Promise<WorkspaceRunResult>;
  onWorkspaceRunProgress: (callback: (event: WorkspaceRunProgressEvent) => void) => () => void;
  exportWorkspace: (request: WorkspaceExportRequest) => Promise<WorkspaceExportResult>;
  onWorkspaceExportProgress: (callback: (event: WorkspaceExportProgressEvent) => void) => () => void;
  cancelWorkspace: (request: WorkspaceCancelRequest) => Promise<WorkspaceCancelResult>;
};
