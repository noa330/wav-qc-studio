import type { DataTableRow } from "./ipc";

const MIN_TRANSCRIPT_GAP_SEC = 0.001;

export type BatchWordAlignment = {
  index: number;
  original: string;
  normalized: string;
  start: number | null;
  end: number | null;
  duration: number | null;
  score: number | null;
  status: string;
  note: string;
};

export type BatchTranscriptGap = {
  start: number;
  end: number;
  duration: number;
  status: "transcript_gap";
  note: string;
};

export type BatchTranscriptMuteInterval = {
  start: number;
  end: number;
};

type TimedWord = {
  start: number;
  end: number;
};

export function readBatchWords(row: DataTableRow | undefined): BatchWordAlignment[] {
  return readJsonArray<BatchWordAlignment>(row?.raw?.alignmentWords);
}

export function readBatchTranscriptGaps(row: DataTableRow | undefined): BatchTranscriptGap[] {
  return buildBatchTranscriptGaps(readBatchWords(row), readRowDurationSec(row));
}

export function readBatchTranscriptMuteIntervals(row: DataTableRow | undefined): BatchTranscriptMuteInterval[] {
  return buildBatchTranscriptMuteIntervals(readBatchWords(row), readRowDurationSec(row));
}

export function buildBatchTranscriptGaps(words: BatchWordAlignment[], durationSec?: number): BatchTranscriptGap[] {
  const timedWords = words
    .map(readTimedWord)
    .filter((word): word is TimedWord => Boolean(word))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (timedWords.length === 0) {
    return [];
  }

  const gaps: BatchTranscriptGap[] = [];
  addTranscriptGap(gaps, 0, timedWords[0].start, "정렬된 첫 단어 앞 빈 시간");

  for (let index = 1; index < timedWords.length; index += 1) {
    const previous = timedWords[index - 1];
    const next = timedWords[index];
    addTranscriptGap(gaps, previous.end, next.start, "정렬된 단어 사이 빈 시간");
  }

  if (typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0) {
    addTranscriptGap(gaps, timedWords[timedWords.length - 1].end, durationSec, "정렬된 마지막 단어 뒤 빈 시간");
  }

  return gaps;
}

export function buildBatchTranscriptMuteIntervals(words: BatchWordAlignment[], durationSec?: number): BatchTranscriptMuteInterval[] {
  const timedWords = words
    .map(readTimedWord)
    .filter((word): word is TimedWord => Boolean(word))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (timedWords.length === 0) {
    return [];
  }

  const intervals: BatchTranscriptMuteInterval[] = [];
  addMuteInterval(intervals, 0, timedWords[0].start);

  for (let index = 1; index < timedWords.length; index += 1) {
    addMuteInterval(intervals, timedWords[index - 1].end, timedWords[index].start);
  }

  if (typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0) {
    addMuteInterval(intervals, timedWords[timedWords.length - 1].end, durationSec);
  }

  return intervals;
}

function addTranscriptGap(gaps: BatchTranscriptGap[], start: number, end: number, label: string): void {
  const safeStart = roundSec(Math.max(0, start));
  const safeEnd = roundSec(Math.max(safeStart, end));
  const duration = roundSec(safeEnd - safeStart);
  if (duration < MIN_TRANSCRIPT_GAP_SEC) {
    return;
  }

  gaps.push({
    start: safeStart,
    end: safeEnd,
    duration,
    status: "transcript_gap",
    note: `${label} ${duration.toFixed(3)}s`,
  });
}

function addMuteInterval(intervals: BatchTranscriptMuteInterval[], start: number, end: number): void {
  const safeStart = roundSec(Math.max(0, start));
  const safeEnd = roundSec(Math.max(safeStart, end));
  if (safeEnd <= safeStart) {
    return;
  }

  intervals.push({ start: safeStart, end: safeEnd });
}

function readTimedWord(word: BatchWordAlignment): TimedWord | undefined {
  const start = readNumber(word.start);
  const end = readNumber(word.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return undefined;
  }

  return {
    start,
    end,
  };
}

function readRowDurationSec(row: DataTableRow | undefined): number | undefined {
  const raw = row?.raw ?? {};
  const cells = row?.cells ?? {};
  return readSeconds(raw.durationSec ?? raw.duration_sec ?? cells.durationSec ?? cells.duration_sec ?? raw.duration ?? cells.duration);
}

function readSeconds(value: string | undefined): number | undefined {
  const text = value?.trim() ?? "";
  if (!text) {
    return undefined;
  }

  const timeMatch = text.match(/^(\d+):(\d+(?:\.\d+)?)$/u);
  if (timeMatch) {
    return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }

  const numberMatch = text.match(/-?\d+(?:\.\d+)?/u);
  const parsed = numberMatch ? Number(numberMatch[0]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readNumber(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function readJsonArray<T>(value: string | undefined): T[] {
  if (!value?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function roundSec(value: number): number {
  return Math.round(value * 1000) / 1000;
}
