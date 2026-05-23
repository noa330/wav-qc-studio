import type { DataTable, DataTableRow, DetailField, FileTreeNode, FileTreeResult, WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import { workspaceTableColumns } from "@shared/table-schemas";
import { defaultWorkspaceSettings } from "@/features/workspaces/model/default-settings";
import { createDefaultTagScoreRules, mergeTagScoreRulesFromTable, type TagScoreRule } from "@/features/workspaces/model/pretrained-sed-tagging";
import { createInitialRuntimeState, createWorkspaceResultSheet, stateWithActiveSheet, type WorkspaceRuntimeState } from "@/features/workspaces/state/workspace-runtime-store";
import type { AppGuideStepId } from "./app-tour-steps";

const guideRoot = "guide://wav-qc-guide";
const inputRoot = `${guideRoot}/input`;
const outputRoot = `${guideRoot}/output`;

const phaseOrder: Record<WorkspaceId, AppGuideStepId[]> = {
  slice: ["slice-browser", "slice-editor", "slice-table", "slice-settings"],
  tagging: ["tagging-browser", "tagging-audio", "tagging-schema", "tagging-table", "tagging-settings"],
  speaker: ["speaker-browser", "speaker-progress", "speaker-audio", "speaker-right"],
  overview: ["guide-entry", "workspace-nav", "run-controls", "overview-table", "overview-audio", "overview-right"],
  batch: ["batch-table", "batch-timeline", "batch-audio", "batch-right"],
  training: ["training-browser", "training-plan", "training-results", "training-right", "training-terminal"],
  inference: ["inference-browser", "inference-reference", "inference-right", "inference-output", "inference-table", "inference-terminal"],
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

function buildGuideState(
  workspaceId: WorkspaceId,
  seed: {
    inputPath: string;
    outputPath: string;
    rows: DataTableRow[];
    inputTree?: FileTreeResult;
    outputTree?: FileTreeResult;
    selectedRowId?: string;
    selectedRowIds?: string[];
    selectedFilePath?: string;
    selectedAudioPath?: string;
    selectedResultAudioPath?: string;
    details?: DetailField[];
    statusText: string;
    progressPercent: number;
    terminal: WorkspaceRuntimeState["terminal"];
    batchSpeakerChecks?: Record<string, boolean>;
  },
): WorkspaceRuntimeState {
  const table: DataTable = {
    columns: workspaceTableColumns[workspaceId],
    rows: seed.rows,
  };
  const selectedRow = seed.rows.find((row) => row.id === seed.selectedRowId) ?? seed.rows[0];
  const details = seed.details ?? (selectedRow ? detailsFromRow(workspaceId, selectedRow) : table.columns.map((column) => ({ label: column.label, value: "-" })));
  const rowExportChecks = Object.fromEntries(seed.rows.map((row) => [row.id, true]));
  const sheet = createWorkspaceResultSheet(workspaceId, "Guide", {
    id: `guide-${workspaceId}`,
    inputPath: seed.inputPath,
    outputPath: seed.outputPath,
    inputTree: seed.inputTree,
    outputTree: seed.outputTree,
    table,
    details,
    selectedRowId: seed.selectedRowId,
    selectedRowIds: seed.selectedRowIds ?? [],
    selectedFilePath: seed.selectedFilePath,
    selectedAudioPath: seed.selectedAudioPath,
    selectedResultAudioPath: seed.selectedResultAudioPath,
    rowExportChecks,
    batchSpeakerChecks: seed.batchSpeakerChecks,
  });
  const base = createInitialRuntimeState(workspaceId);

  return stateWithActiveSheet(
    {
      ...base,
      statusText: seed.statusText,
      progressPercent: seed.progressPercent,
      terminal: seed.terminal,
      terminalOpenRequestId: seed.terminal.text ? 1 : 0,
      isRunning: seed.terminal.status === "running",
      isBatchSpeakerRunning: false,
      sheets: [sheet],
      activeSheetId: sheet.id,
    },
    sheet,
  );
}

function sliceRows(): DataTableRow[] {
  const source = guideFile("slice/narration_take_01.wav");
  return [
    row("1", {
      index: "1",
      fileName: "narration_take_01_0001.wav",
      startSec: "00:00.120",
      endSec: "00:04.860",
      durationSec: "4.74s",
      channels: "1",
      markerCount: "2",
      status: "완료",
      outputPath: `${outputRoot}/slice/narration_take_01_0001.wav`,
    }, { originalPath: source, inputPath: source, outputPath: `${outputRoot}/slice/narration_take_01_0001.wav`, startSec: "0.12", endSec: "4.86", durationSec: "4.74", status: "completed" }, source),
    row("2", {
      index: "2",
      fileName: "narration_take_01_0002.wav",
      startSec: "00:05.180",
      endSec: "00:09.420",
      durationSec: "4.24s",
      channels: "1",
      markerCount: "1",
      status: "완료",
      outputPath: `${outputRoot}/slice/narration_take_01_0002.wav`,
    }, { originalPath: source, inputPath: source, outputPath: `${outputRoot}/slice/narration_take_01_0002.wav`, startSec: "5.18", endSec: "9.42", durationSec: "4.24", status: "completed" }, source),
  ];
}

function taggingRows(): DataTableRow[] {
  return [
    row("1", {
      index: "1",
      fileName: "narration_take_01_0001.wav",
      durationSec: "4.74s",
      channels: "1",
      ngTags: "breath 0.73, click 0.39",
      status: "검토 필요",
      outputPath: `${outputRoot}/tagging/tagging_report.csv`,
    }, {
      originalPath: guideFile("tagging/narration_take_01_0001.wav"),
      status: "review",
      ngTags: "breath,click",
      tags: guideTagScores([
        ["speech", 0.94],
        ["breath", 0.73],
        ["click", 0.39],
      ]),
      frameTags: guideFrameTags([
        { startSec: 0, endSec: 1.48, tags: [["speech", 0.94], ["breath", 0.62]] },
        { startSec: 1.48, endSec: 3.12, tags: [["speech", 0.89], ["click", 0.39]] },
        { startSec: 3.12, endSec: 4.74, tags: [["speech", 0.91], ["breath", 0.73], ["room tone", 0.22]] },
      ]),
    }, guideFile("tagging/narration_take_01_0001.wav")),
    row("2", {
      index: "2",
      fileName: "narration_take_01_0002.wav",
      durationSec: "4.24s",
      channels: "1",
      ngTags: "noise 0.41",
      status: "완료",
      outputPath: `${outputRoot}/tagging/tagging_report.csv`,
    }, {
      originalPath: guideFile("tagging/narration_take_01_0002.wav"),
      status: "completed",
      ngTags: "noise",
      tags: guideTagScores([
        ["speech", 0.92],
        ["ambient noise", 0.41],
      ]),
      frameTags: guideFrameTags([
        { startSec: 0, endSec: 1.36, tags: [["speech", 0.92], ["ambient noise", 0.26]] },
        { startSec: 1.36, endSec: 2.84, tags: [["speech", 0.87], ["ambient noise", 0.41]] },
        { startSec: 2.84, endSec: 4.24, tags: [["speech", 0.9], ["silence", 0.18]] },
      ]),
    }, guideFile("tagging/narration_take_01_0002.wav")),
  ];
}

function speakerRows(): DataTableRow[] {
  return [
    row("1", {
      index: "1",
      fileName: "host_line_01.wav",
      modelLabel: "Sidon",
      status: "완료",
    }, { originalPath: guideFile("speaker/host_line_01.wav"), finalOutputPath: guideFile("speaker/output/host_line_01_sidon.wav"), status: "completed" }, guideFile("speaker/host_line_01.wav")),
    row("2", {
      index: "2",
      fileName: "host_line_02.wav",
      modelLabel: "Sidon",
      status: "완료",
    }, { originalPath: guideFile("speaker/host_line_02.wav"), finalOutputPath: guideFile("speaker/output/host_line_02_sidon.wav"), status: "completed" }, guideFile("speaker/host_line_02.wav")),
    row("3", {
      index: "3",
      fileName: "guest_line_01.wav",
      modelLabel: "Sidon",
      status: "검토 필요",
    }, { originalPath: guideFile("speaker/guest_line_01.wav"), finalOutputPath: guideFile("speaker/output/guest_line_01_sidon.wav"), status: "review" }, guideFile("speaker/guest_line_01.wav")),
  ];
}

function overviewRows(): DataTableRow[] {
  return [
    row("1", {
      index: "1",
      file_name: "host_line_01.wav",
      duration_sec: "4.74",
      sample_rate: "44100",
      channels: "1",
      noise_bak: "3.81",
      noise_sig: "4.12",
      noise_ovrl: "3.95",
      noise_p808_mos: "3.86",
      status: "ok",
      error: "",
    }, { absolute_path: guideFile("overview/host_line_01.wav") }, guideFile("overview/host_line_01.wav")),
    row("2", {
      index: "2",
      file_name: "noisy_tail.wav",
      duration_sec: "6.20",
      sample_rate: "44100",
      channels: "1",
      noise_bak: "2.42",
      noise_sig: "3.18",
      noise_ovrl: "2.91",
      noise_p808_mos: "2.88",
      status: "review",
      error: "background noise",
    }, { absolute_path: guideFile("overview/noisy_tail.wav") }, guideFile("overview/noisy_tail.wav")),
    row("3", {
      index: "3",
      file_name: "guest_line_01.wav",
      duration_sec: "3.72",
      sample_rate: "48000",
      channels: "1",
      noise_bak: "3.21",
      noise_sig: "3.76",
      noise_ovrl: "3.42",
      noise_p808_mos: "3.36",
      status: "ok",
      error: "",
    }, { absolute_path: guideFile("overview/guest_line_01.wav") }, guideFile("overview/guest_line_01.wav")),
  ];
}

function batchRows(): DataTableRow[] {
  const alignmentWords = JSON.stringify([
    { index: 0, original: "오늘", normalized: "오늘", start: 0.24, end: 0.58, duration: 0.34, score: 0.91, status: "aligned", note: "" },
    { index: 1, original: "새로운", normalized: "새로운", start: 0.64, end: 1.12, duration: 0.48, score: 0.78, status: "aligned", note: "" },
    { index: 2, original: "목소리", normalized: "목소리", start: 1.28, end: 1.82, duration: 0.54, score: 0.42, status: "review", note: "score 낮음" },
    { index: 3, original: "확인합니다", normalized: "확인합니다", start: 2.12, end: 2.86, duration: 0.74, score: 0.86, status: "aligned", note: "" },
  ]);
  return [
    row("1", {
      index: "1",
      fileName: "dialogue_a_001.wav",
      audioStatus: "완료",
      autoTranscript: "오늘 새로운 목소리 확인합니다",
      editedTranscript: "오늘 새로운 목소리를 확인합니다",
      speaker: "speaker_a",
      language: "ko",
      qcStatus: "수정됨",
    }, { originalPath: guideFile("batch/dialogue_a_001.wav"), outputAudioPath: guideFile("batch/output/dialogue_a_001.wav"), speaker: "speaker_a", language: "ko", durationSec: "3.2", alignmentWords, qcStatus: "edited" }, guideFile("batch/dialogue_a_001.wav")),
    row("2", {
      index: "2",
      fileName: "dialogue_a_002.wav",
      audioStatus: "완료",
      autoTranscript: "두 번째 문장입니다",
      editedTranscript: "두 번째 문장입니다",
      speaker: "speaker_b",
      language: "ko",
      qcStatus: "미검수",
    }, { originalPath: guideFile("batch/dialogue_a_002.wav"), outputAudioPath: guideFile("batch/output/dialogue_a_002.wav"), speaker: "speaker_b", language: "ko", durationSec: "2.8", alignmentWords: "[]" }, guideFile("batch/dialogue_a_002.wav")),
  ];
}

function trainingRows(): DataTableRow[] {
  return [
    row("1", {
      index: "1",
      modelName: "guide_voice_v2",
      stage: "SoVITS",
      epoch: "4",
      step: "-",
      elapsed: "00:08:44",
      checkpoint: "sovits_e4.pth",
      status: "완료",
    }, { checkpointPath: `${outputRoot}/training/guide_voice_v2/sovits_e4.pth`, stage: "SoVITS", epoch: "4", status: "completed" }),
    row("2", {
      index: "2",
      modelName: "guide_voice_v2",
      stage: "SoVITS",
      epoch: "8",
      step: "-",
      elapsed: "00:17:31",
      checkpoint: "sovits_e8.pth",
      status: "완료",
    }, { checkpointPath: `${outputRoot}/training/guide_voice_v2/sovits_e8.pth`, stage: "SoVITS", epoch: "8", status: "completed" }),
    row("3", {
      index: "3",
      modelName: "guide_voice_v2",
      stage: "GPT",
      epoch: "15",
      step: "1800",
      elapsed: "00:29:08",
      checkpoint: "gpt_e15.ckpt",
      status: "완료",
    }, { checkpointPath: `${outputRoot}/training/guide_voice_v2/gpt_e15.ckpt`, stage: "GPT", epoch: "15", step: "1800", status: "completed" }),
  ];
}

function inferenceRows(): DataTableRow[] {
  return [
    row("1", {
      index: "1",
      modelName: "guide_voice_v2",
      mode: "checkpoint",
      referenceAudio: "clean_prompt.wav",
      outputAudio: "guide_voice_result.wav",
      elapsed: "00:00:18",
      status: "완료",
    }, { outputAudioPath: guideFile("inference/output/guide_voice_result.wav"), referenceAudioPath: guideFile("inference/reference/clean_prompt.wav"), status: "completed" }, guideFile("inference/reference/clean_prompt.wav")),
  ];
}

function guideLevel(workspaceId: WorkspaceId, stepId: AppGuideStepId): number {
  const order = phaseOrder[workspaceId];
  const index = order.indexOf(stepId);
  return index >= 0 ? index + 1 : order.length;
}

function row(id: string, cells: Record<string, string>, raw: Record<string, string> = {}, sourcePath?: string): DataTableRow {
  return {
    id,
    cells,
    raw,
    sourcePath,
  };
}

function guideTagScores(tags: Array<[label: string, score: number]>): string {
  return JSON.stringify(tags.map(([label, score], index) => ({ rank: index + 1, label, score, logit: score * 6 - 3 })));
}

function guideFrameTags(frames: Array<{ startSec: number; endSec: number; tags: Array<[label: string, score: number]> }>): string {
  return JSON.stringify(frames.map((frame) => ({
    startSec: frame.startSec,
    endSec: frame.endSec,
    tags: frame.tags.map(([label, score], index) => ({ rank: index + 1, label, score, logit: score * 6 - 3 })),
  })));
}

function detailsFromRow(workspaceId: WorkspaceId, selectedRow: DataTableRow): DetailField[] {
  return workspaceTableColumns[workspaceId].map((column) => ({
    label: column.label,
    value: selectedRow.cells[column.key] || selectedRow.raw?.[column.key] || "-",
  }));
}

function fileTree(workspaceId: WorkspaceId, purpose: "input" | "output", names: string[]): FileTreeResult {
  const rootPath = purpose === "input" ? `${inputRoot}/${workspaceId}` : `${outputRoot}/${workspaceId}`;
  const nodes: FileTreeNode[] = [];
  for (const name of names) {
    insertFileNode(nodes, rootPath, name.split("/").filter(Boolean));
  }

  return {
    rootPath,
    nodes,
  };
}

function insertFileNode(nodes: FileTreeNode[], rootPath: string, parts: string[]): void {
  const [name, ...rest] = parts;
  if (!name) {
    return;
  }

  const path = `${rootPath}/${name}`;
  if (rest.length === 0) {
    nodes.push({
      id: path,
      name,
      path,
      kind: "file",
      meta: name.endsWith(".wav") ? "guide audio" : "guide data",
    });
    return;
  }

  let directory = nodes.find((node) => node.kind === "directory" && node.name === name);
  if (!directory) {
    directory = {
      id: path,
      name,
      path,
      kind: "directory",
      children: [],
    };
    nodes.push(directory);
  }

  directory.children ??= [];
  insertFileNode(directory.children, path, rest);
}

function guideFile(relativePath: string): string {
  return `${guideRoot}/${relativePath}`;
}

function rowSelectionPath(selectedRow: DataTableRow | undefined): string | undefined {
  if (!selectedRow) {
    return undefined;
  }

  return selectedRow.raw?.outputPath || selectedRow.raw?.output_path || selectedRow.sourcePath;
}

function terminal(status: WorkspaceRuntimeState["terminal"]["status"], lines: string[]): WorkspaceRuntimeState["terminal"] {
  return {
    status,
    text: lines.join("\n"),
    command: "guide preview",
    updatedAt: "guide",
  };
}
