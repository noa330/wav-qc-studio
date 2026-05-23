import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DetailField, FileTreeNode, FileTreeResult, VoiceTrainingModel, WorkspaceSettings } from "@shared/ipc";

export type TrainingDatasetPreview = {
  inputPath: string;
  inputTree: FileTreeResult;
  details: DetailField[];
};

type TrainingDatasetItem = {
  audioPath: string;
  speaker: string;
  language: string;
  text: string;
};

export async function loadTrainingDatasetPreview(inputPath: string, settings?: WorkspaceSettings): Promise<TrainingDatasetPreview> {
  const selectedModel = settings?.training?.selectedModel ?? "gpt-sovits";
  assertTrainingDatasetExtension(inputPath, selectedModel);
  const items = selectedModel === "gpt-sovits"
    ? await readGptSoVitsList(inputPath)
    : await readOmniVoiceJson(inputPath);

  return {
    inputPath,
    inputTree: buildAudioInputTree(inputPath, items),
    details: [
      { label: "데이터셋", value: basename(inputPath) },
      { label: "모델", value: selectedModel === "gpt-sovits" ? "GPT-SoVITS" : "OmniVoice" },
      { label: "행 수", value: `${items.length}` },
      { label: "오디오 폴더", value: commonAudioFolder(items) || "-" },
    ],
  };
}

export function assertTrainingDatasetExtension(inputPath: string, selectedModel: VoiceTrainingModel): void {
  const extension = extname(inputPath).toLowerCase();
  if (selectedModel === "gpt-sovits" && extension !== ".list") {
    throw new Error("GPT-SoVITS 학습 입력은 .list 파일이어야 합니다.");
  }

  if (selectedModel === "omnivoice" && extension !== ".jsonl" && extension !== ".json") {
    throw new Error("OmniVoice 학습 입력은 .jsonl 또는 .json 파일이어야 합니다.");
  }
}

async function readGptSoVitsList(inputPath: string): Promise<TrainingDatasetItem[]> {
  const text = await readText(inputPath);
  const items: TrainingDatasetItem[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parts = line.split("|");
    if (parts.length < 4) {
      throw new Error(`GPT-SoVITS 리스트 ${index + 1}번째 줄 형식이 올바르지 않습니다. wav_path|speaker|language|text 형식이어야 합니다.`);
    }

    const [audioPath, speaker, language, ...textParts] = parts;
    if (!existsSync(audioPath)) {
      throw new Error(`${index + 1}번째 줄의 오디오 파일을 찾을 수 없습니다: ${audioPath}`);
    }

    items.push({
      audioPath,
      speaker: speaker.trim() || "speaker_unknown",
      language: language.trim() || "ko",
      text: textParts.join("|").trim(),
    });
  }

  if (items.length === 0) {
    throw new Error(`사용할 수 있는 행이 없습니다: ${inputPath}`);
  }

  return items;
}

async function readOmniVoiceJson(inputPath: string): Promise<TrainingDatasetItem[]> {
  const text = await readText(inputPath);
  const records = inputPath.toLowerCase().endsWith(".jsonl")
    ? text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => parseJsonLine(line, index + 1))
    : parseJsonRecords(text);

  const wavDir = join(dirname(dirname(inputPath)), "wavs");
  const items = records.map((record, index) => normalizeOmniRecord(record, index, wavDir));
  if (items.length === 0) {
    throw new Error(`사용할 수 있는 행이 없습니다: ${inputPath}`);
  }

  return items;
}

async function readText(path: string): Promise<string> {
  const buffer = await readFile(path);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }

  return buffer.toString("utf8");
}

function parseJsonLine(line: string, lineNumber: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch (error) {
    throw new Error(`OmniVoice JSON ${lineNumber}번째 줄 형식이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`OmniVoice JSON ${lineNumber}번째 줄은 객체여야 합니다.`);
}

function parseJsonRecords(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }

  if (isRecord(parsed)) {
    for (const key of ["rows", "items", "samples", "data"] as const) {
      const value = parsed[key];
      if (Array.isArray(value)) {
        return value.filter(isRecord);
      }
    }
    return [parsed];
  }

  return [];
}

function normalizeOmniRecord(record: Record<string, unknown>, index: number, wavDir: string): TrainingDatasetItem {
  const id = stringValue(record.id) || `${index + 1}`;
  const candidateAudioPath = stringValue(record.audio_path) || stringValue(record.audioPath) || stringValue(record.wav_path);
  const audioPath = resolveOmniAudioPath(candidateAudioPath, id, index, wavDir);
  if (!audioPath) {
    throw new Error(`OmniVoice ${index + 1}번째 행의 오디오 경로가 비어 있습니다.`);
  }

  return {
    audioPath,
    speaker: stringValue(record.speaker) || "speaker_unknown",
    language: stringValue(record.language_id) || stringValue(record.language) || "ko",
    text: stringValue(record.text),
  };
}

function resolveOmniAudioPath(candidate: string, id: string, index: number, wavDir: string): string {
  if (candidate && existsSync(candidate)) {
    return candidate;
  }

  const numeric = id.replace(/\D/gu, "");
  const fallbackNames = [
    numeric ? `${Number(numeric).toString().padStart(6, "0")}.wav` : "",
    `${index + 1}`.padStart(6, "0") + ".wav",
  ].filter(Boolean);
  for (const name of fallbackNames) {
    const path = join(wavDir, name);
    if (existsSync(path)) {
      return path;
    }
  }

  return candidate;
}

function buildAudioInputTree(datasetPath: string, items: TrainingDatasetItem[]): FileTreeResult {
  const groups = new Map<string, TrainingDatasetItem[]>();
  for (const item of items) {
    groups.set(dirname(item.audioPath), [...(groups.get(dirname(item.audioPath)) ?? []), item]);
  }

  const nodes = groups.size <= 1
    ? buildAudioNodes(items)
    : Array.from(groups.entries())
        .sort(([left], [right]) => basename(left).localeCompare(basename(right), "ko"))
        .map<FileTreeNode>(([folderPath, groupItems]) => ({
          id: `training-folder:${folderPath}`,
          name: basename(folderPath),
          path: folderPath,
          kind: "directory",
          children: buildAudioNodes(groupItems),
        }));

  return {
    rootPath: datasetPath,
    nodes,
  };
}

function buildAudioNodes(items: TrainingDatasetItem[]): FileTreeNode[] {
  return items.map((item, index) => ({
    id: `training-audio:${index}:${item.audioPath}`,
    name: basename(item.audioPath),
    path: item.audioPath,
    kind: "file",
    meta: [item.speaker, item.language, item.text].filter(Boolean).join(" | "),
  }));
}

function commonAudioFolder(items: TrainingDatasetItem[]): string {
  const folders = new Set(items.map((item) => dirname(item.audioPath)));
  return folders.size === 1 ? [...folders][0] : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}
