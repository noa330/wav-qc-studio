import type { WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import { workspaceTableColumns } from "@shared/table-schemas";
import { defaultWorkspaceSettings } from "@/features/workspaces/model/default-settings";
import { createDefaultTagScoreRules, mergeTagScoreRulesFromTable, type TagScoreRule } from "@/features/workspaces/model/pretrained-sed-tagging";
import type { WorkspaceRuntimeState } from "@/features/workspaces/state/workspace-runtime-store";
import type { AppGuideStepId } from "./app-tour-steps";
import {
  batchRows,
  buildGuideState,
  detailsFromRow,
  fileTree,
  guideFile,
  guideRoot,
  inferenceRows,
  inputRoot,
  outputRoot,
  overviewRows,
  rowSelectionPath,
  sliceRows,
  speakerRows,
  taggingRows,
  terminal,
  trainingRows,
} from "./app-guide-fixtures";

const phaseOrder: Record<WorkspaceId, AppGuideStepId[]> = {
  slice: [
    "slice-browser",
    "slice-editor-header",
    "slice-editor-waveform",
    "slice-editor-actions",
    "slice-editor-minimap",
    "slice-editor-time-grid",
    "slice-table",
    "slice-settings",
  ],
  tagging: [
    "tagging-browser",
    "tagging-audio",
    "tagging-schema",
    "tagging-score-button",
    "tagging-score-dialog",
    "tagging-table",
    "tagging-settings",
  ],
  speaker: ["speaker-browser", "speaker-progress", "speaker-audio", "speaker-model", "speaker-settings"],
  overview: [
    "guide-entry",
    "workspace-nav",
    "workspace-splitters",
    "file-browser-common",
    "data-grid-sheets",
    "data-grid-selection",
    "data-grid-resize",
    "audio-edit-common",
    "audio-transport-common",
    "run-controls",
    "console-button",
    "terminal-dock",
    "overview-table",
    "overview-filter-button",
    "overview-filter-dialog",
    "overview-audio",
    "overview-modules",
    "overview-detail",
  ],
  batch: ["batch-table", "batch-replace-button", "batch-replace-dialog", "batch-timeline", "batch-audio-controls", "batch-audio", "batch-right"],
  training: [
    "training-browser",
    "training-version",
    "training-plan",
    "training-results",
    "training-tensorboard-button",
    "training-tensorboard-dialog",
    "training-right",
  ],
  inference: [
    "inference-browser",
    "inference-run-mode",
    "inference-multi-reference",
    "inference-reference",
    "inference-output",
    "inference-results",
    "inference-right",
  ],
};

export function createGuideWorkspaceState(workspaceId: WorkspaceId, stepId: AppGuideStepId): WorkspaceRuntimeState {
  const level = guideLevel(workspaceId, stepId);

  switch (workspaceId) {
    case "slice":
      return createSliceGuideState(level);
    case "tagging":
      return createTaggingGuideState(level);
    case "speaker":
      return createSpeakerGuideState(level);
    case "overview":
      return createOverviewGuideState(level);
    case "batch":
      return createBatchGuideState(level);
    case "training":
      return createTrainingGuideState(level);
    case "inference":
      return createInferenceGuideState(level);
  }
}

export function createGuideSettings(base: WorkspaceSettings = defaultWorkspaceSettings): WorkspaceSettings {
  return {
    ...base,
    speaker: {
      ...base.speaker,
      useSidon: true,
      useResemble: false,
      useVoiceFixer: false,
      sidonDevicePreference: "cuda",
      sidonChunkSeconds: 18,
      sidonPrePadding: 0.12,
      sidonTrailingPad: 0.18,
    },
    batch: {
      ...base.batch,
      transcriptionLanguage: "ko",
      wordAlignmentLanguageCode: "ko",
      wordAlignmentLowScoreThreshold: 0.62,
      showAllAlignmentOutsideSegments: true,
    },
    training: {
      ...base.training,
      selectedModel: "gpt-sovits",
      toolRoot: `${guideRoot}/tools/GPT-SoVITS`,
      modelName: "guide_voice_v2",
      gpu: "0",
      gptVersion: "v2",
      gptSovitsBatchSize: 4,
      gptSovitsEpochs: 8,
      gptSovitsSaveEveryEpoch: 4,
      gptBatchSize: 2,
      gptEpochs: 15,
      gptSaveEveryEpoch: 5,
    },
    inference: {
      ...base.inference,
      selectedModel: "gpt-sovits",
      toolRoot: `${guideRoot}/tools/GPT-SoVITS`,
      modelName: "guide_voice_v2",
      referenceAudioPath: guideFile("inference/reference/clean_prompt.wav"),
      referenceText: "오늘은 새로운 목소리 샘플을 확인합니다.",
      outputText: "안녕하세요. 이 문장은 가이드에서 미리 합성해 둔 예시입니다.",
      outputAudioPath: guideFile("inference/output/guide_voice_result.wav"),
      gpu: "0",
      gptVersion: "v2",
      gptMode: "checkpoint",
      gptPromptLanguage: "ko",
      gptTextLanguage: "ko",
      gptCheckpointSovitsPath: `${outputRoot}/training/guide_voice_v2/sovits_e8.pth`,
      gptCheckpointGptPath: `${outputRoot}/training/guide_voice_v2/gpt_e15.ckpt`,
    },
  };
}

export function createGuideMetrics(workspaceId: WorkspaceId, state: WorkspaceRuntimeState): string[] {
  const total = state.table.rows.length;
  const completed = state.table.rows.filter((row) => /완료|completed/i.test(row.cells.status ?? row.raw?.status ?? "")).length;
  const failed = state.table.rows.filter((row) => /실패|failed/i.test(row.cells.status ?? row.raw?.status ?? "")).length;

  switch (workspaceId) {
    case "overview":
      return ["Guide", `${total}`, "2", "1"];
    case "speaker":
      return [`${total}`, state.isRunning ? "1" : "0", `${completed}`, "Sidon"];
    case "batch":
      return [`${total}`, `${total}`, "2", "2"];
    case "training":
      return ["GPT-SoVITS", `${total}`, "2", state.statusText];
    case "inference":
      return ["GPT-SoVITS", "checkpoint", total > 0 ? "1" : "0", state.statusText];
    default:
      return [`${total}`, `${completed}`, `${failed}`, `${total}`, "가이드"];
  }
}

export function createGuideTagScoreRules(): TagScoreRule[] {
  return mergeTagScoreRulesFromTable(createDefaultTagScoreRules(), {
    columns: workspaceTableColumns.tagging,
    rows: taggingRows(),
  });
}

function createSliceGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 2 ? sliceRows() : [];
  return buildGuideState("slice", {
    inputPath: `${inputRoot}/slice`,
    outputPath: `${outputRoot}/slice`,
    inputTree: level < 2 ? fileTree("slice", "input", ["narration_take_01.wav", "narration_take_02.wav", "roomtone_tail.wav"]) : undefined,
    outputTree: level >= 3 ? fileTree("slice", "output", ["narration_take_01_0001.wav", "narration_take_01_0002.wav"]) : undefined,
    rows,
    selectedRowId: rows[0]?.id,
    selectedFilePath: level >= 2 ? rowSelectionPath(rows[0]) : guideFile("slice/narration_take_01.wav"),
    selectedAudioPath: guideFile("slice/narration_take_01.wav"),
    selectedRowIds: rows[0] ? [rows[0].id] : [],
    progressPercent: level >= 3 ? 100 : 34,
    statusText: level >= 3 ? "완료" : "샘플 준비",
    terminal: terminal("completed", [
      "[slice] input 폴더 스캔",
      "[slice] speech pad 120ms 적용",
      "[slice] 2개 조각 생성 완료",
    ]),
  });
}

function createTaggingGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 2 ? taggingRows() : [];
  return buildGuideState("tagging", {
    inputPath: `${inputRoot}/tagging`,
    outputPath: `${outputRoot}/tagging`,
    inputTree: level < 2 ? fileTree("tagging", "input", ["narration_take_01_0001.wav", "narration_take_01_0002.wav"]) : undefined,
    outputTree: level >= 4 ? fileTree("tagging", "output", ["tagging_report.csv"]) : undefined,
    rows,
    selectedRowId: rows[0]?.id,
    selectedRowIds: rows[0] ? [rows[0].id] : [],
    selectedFilePath: rows[0]?.sourcePath ?? guideFile("tagging/narration_take_01_0001.wav"),
    selectedAudioPath: rows[0]?.sourcePath ?? guideFile("tagging/narration_take_01_0001.wav"),
    progressPercent: level >= 4 ? 100 : 48,
    statusText: level >= 4 ? "태깅 완료" : "태그 기준 확인",
    terminal: terminal("completed", [
      "[tagging] PretrainedSED 모델 로드",
      "[tagging] breath 0.73, noise 0.41 감지",
      "[tagging] 결과 CSV 생성",
    ]),
  });
}

function createSpeakerGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 2 ? speakerRows() : [];
  return buildGuideState("speaker", {
    inputPath: `${inputRoot}/speaker`,
    outputPath: `${outputRoot}/speaker`,
    inputTree: level < 2 ? fileTree("speaker", "input", ["host_line_01.wav", "host_line_02.wav", "guest_line_01.wav"]) : undefined,
    outputTree: level >= 3 ? fileTree("speaker", "output", ["host_line_01_sidon.wav", "host_line_02_sidon.wav"]) : undefined,
    rows,
    selectedRowId: rows[0]?.id,
    selectedRowIds: rows[0] ? [rows[0].id] : [],
    selectedFilePath: rows[0]?.sourcePath ?? guideFile("speaker/host_line_01.wav"),
    selectedAudioPath: rows[0]?.sourcePath ?? guideFile("speaker/host_line_01.wav"),
    selectedResultAudioPath: rows[0]?.raw?.finalOutputPath,
    progressPercent: level >= 3 ? 100 : 67,
    statusText: level >= 3 ? "비교 준비" : "모델 처리 중",
    terminal: terminal("completed", [
      "[speaker] Sidon device cuda 선택",
      "[speaker] host_line_01.wav 복원 완료",
      "[speaker] 출력 파일 연결 완료",
    ]),
  });
}

function createOverviewGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 1 ? overviewRows() : [];
  return buildGuideState("overview", {
    inputPath: `${inputRoot}/project`,
    outputPath: `${outputRoot}/overview`,
    inputTree: fileTree("overview", "input", ["host_line_01.wav", "guest_line_01.wav", "noisy_tail.wav"]),
    outputTree: level >= 3 ? fileTree("overview", "output", ["overview_qc.csv", "review_targets.csv"]) : undefined,
    rows,
    selectedRowId: rows[1]?.id ?? rows[0]?.id,
    selectedRowIds: rows[1] ? [rows[1].id] : rows[0] ? [rows[0].id] : [],
    selectedFilePath: rows[1]?.sourcePath ?? rows[0]?.sourcePath,
    selectedAudioPath: rows[1]?.sourcePath ?? rows[0]?.sourcePath,
    details: rows[1] ? detailsFromRow("overview", rows[1]) : undefined,
    progressPercent: 100,
    statusText: level >= 4 ? "검수 우선순위 확인" : "QC 요약",
    terminal: terminal("completed", [
      "[overview] 3개 파일 분석",
      "[overview] BAK 낮은 파일 1건",
      "[overview] review 필터 적용",
    ]),
  });
}

function createBatchGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 1 ? batchRows() : [];
  return buildGuideState("batch", {
    inputPath: `${inputRoot}/batch`,
    outputPath: `${outputRoot}/batch`,
    inputTree: level < 2 ? fileTree("batch", "input", ["dialogue_a_001.wav", "dialogue_a_002.wav"]) : undefined,
    outputTree: level >= 4 ? fileTree("batch", "output", ["dataset.list", "dialogue_a_001.wav"]) : undefined,
    rows,
    selectedRowId: rows[0]?.id,
    selectedRowIds: rows[0] ? [rows[0].id] : [],
    selectedFilePath: rows[0]?.sourcePath ?? guideFile("batch/dialogue_a_001.wav"),
    selectedAudioPath: rows[0]?.sourcePath ?? guideFile("batch/dialogue_a_001.wav"),
    progressPercent: level >= 4 ? 100 : 72,
    statusText: level >= 4 ? "검수 대기" : "WordAlign 확인",
    terminal: terminal("completed", [
      "[batch] faster-whisper large-v3 완료",
      "[batch] WordAlign score 계산",
      "[batch] 화자 그룹 2개 감지",
    ]),
    batchSpeakerChecks: { "speaker_a": true, "speaker_b": true },
  });
}

function createTrainingGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 3 ? trainingRows() : [];
  return buildGuideState("training", {
    inputPath: `${inputRoot}/training`,
    outputPath: `${outputRoot}/training/guide_voice_v2`,
    inputTree: fileTree("training", "input", ["guide_manifest.list", "wavs/line_001.wav", "wavs/line_002.wav"]),
    outputTree: level >= 3 ? fileTree("training", "output", ["sovits_e4.pth", "sovits_e8.pth", "gpt_e15.ckpt"]) : undefined,
    rows,
    selectedRowId: rows[0]?.id,
    selectedRowIds: rows[0] ? [rows[0].id] : [],
    selectedFilePath: rows[0]?.raw?.checkpointPath ?? guideFile("training/guide_manifest.list"),
    progressPercent: level >= 5 ? 88 : level >= 3 ? 100 : 25,
    statusText: level >= 5 ? "학습 로그 확인" : level >= 3 ? "학습 완료" : "학습 계획",
    terminal: terminal(level >= 5 ? "running" : "completed", [
      "[training] GPT-SoVITS v2 설정 로드",
      "[training] SoVITS epoch 4 checkpoint 저장",
      "[training] SoVITS epoch 8 checkpoint 저장",
      "[training] GPT stage epoch 15 완료",
      "[training] TensorBoard logdir 준비",
    ]),
  });
}

function createInferenceGuideState(level: number): WorkspaceRuntimeState {
  const rows = level >= 5 ? inferenceRows() : [];
  return buildGuideState("inference", {
    inputPath: `${inputRoot}/inference`,
    outputPath: `${outputRoot}/inference`,
    inputTree: fileTree("inference", "input", ["reference/clean_prompt.wav", "reference/prompt.txt"]),
    outputTree: level >= 4 ? fileTree("inference", "output", ["guide_voice_result.wav"]) : undefined,
    rows,
    selectedRowId: rows[0]?.id,
    selectedRowIds: rows[0] ? [rows[0].id] : [],
    selectedFilePath: guideFile("inference/reference/clean_prompt.wav"),
    selectedAudioPath: guideFile("inference/reference/clean_prompt.wav"),
    selectedResultAudioPath: level >= 4 ? guideFile("inference/output/guide_voice_result.wav") : undefined,
    progressPercent: level >= 6 ? 100 : level >= 4 ? 92 : 45,
    statusText: level >= 4 ? "추론 결과 준비" : "프롬프트 확인",
    terminal: terminal(level >= 6 ? "completed" : "running", [
      "[inference] guide_voice_v2 checkpoint 로드",
      "[inference] reference prompt 분석",
      "[inference] text split cut5 적용",
      "[inference] guide_voice_result.wav 저장",
    ]),
  });
}

function guideLevel(workspaceId: WorkspaceId, stepId: AppGuideStepId): number {
  const order = phaseOrder[workspaceId];
  const index = order.indexOf(stepId);
  return index >= 0 ? index + 1 : order.length;
}
