import type { DataTable, DataTableRow, DetailField, FileTreeNode, FileTreeResult, WorkspaceId } from "@shared/ipc";
import { workspaceTableColumns } from "@shared/table-schemas";
import {
  createInitialRuntimeState,
  createWorkspaceResultSheet,
  stateWithActiveSheet,
  type WorkspaceRuntimeState,
} from "@/features/workspaces/state/workspace-runtime-store";

export const guideRoot = "guide://wav-qc-guide";
export const inputRoot = `${guideRoot}/input`;
export const outputRoot = `${guideRoot}/output`;

export function buildGuideState(
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

export function sliceRows(): DataTableRow[] {
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

export function taggingRows(): DataTableRow[] {
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

export function speakerRows(): DataTableRow[] {
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

export function overviewRows(): DataTableRow[] {
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

export function batchRows(): DataTableRow[] {
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

export function trainingRows(): DataTableRow[] {
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

export function inferenceRows(): DataTableRow[] {
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

export function detailsFromRow(workspaceId: WorkspaceId, selectedRow: DataTableRow): DetailField[] {
  return workspaceTableColumns[workspaceId].map((column) => ({
    label: column.label,
    value: selectedRow.cells[column.key] || selectedRow.raw?.[column.key] || "-",
  }));
}

export function fileTree(workspaceId: WorkspaceId, purpose: "input" | "output", names: string[]): FileTreeResult {
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

export function guideFile(relativePath: string): string {
  return `${guideRoot}/${relativePath}`;
}

export function rowSelectionPath(selectedRow: DataTableRow | undefined): string | undefined {
  if (!selectedRow) {
    return undefined;
  }

  return selectedRow.raw?.outputPath || selectedRow.raw?.output_path || selectedRow.sourcePath;
}

export function terminal(status: WorkspaceRuntimeState["terminal"]["status"], lines: string[]): WorkspaceRuntimeState["terminal"] {
  return {
    status,
    text: lines.join("\n"),
    command: "guide preview",
    updatedAt: "guide",
  };
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
