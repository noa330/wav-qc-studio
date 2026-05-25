import type { DataTableRow } from "@shared/ipc";
import { readBatchWords, type BatchWordAlignment } from "../../../model/batch-alignment";
export type BatchReplaceMatch = {
  row: DataTableRow;
  before: string;
  after: string;
  ranges: BatchReplaceTextRange[];
};

export type BatchReplaceTextRange = {
  start: number;
  end: number;
  text: string;
  score: number | null;
};

export type BatchReplaceOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  timelineScoreFilterEnabled: boolean;
  timelineScoreThreshold: number;
};

type BatchTimelineScoreSpan = {
  start: number;
  end: number;
  score: number;
};

export function buildBatchReplaceMatch(row: DataTableRow, query: string, replacement: string, options: BatchReplaceOptions): BatchReplaceMatch | null {
  const before = row.cells.editedTranscript || row.raw?.editedTranscript || row.raw?.edited_transcript || "";
  const pattern = query.trim();
  if (!pattern) {
    return null;
  }

  const flags = options.caseSensitive ? "g" : "gi";
  const source = escapeRegExp(pattern);
  const bounded = options.wholeWord ? `\\b${source}\\b` : source;
  let regex: RegExp;
  try {
    regex = new RegExp(bounded, flags);
  } catch {
    return null;
  }

  const ranges = collectBatchReplaceRanges(row, before, regex, options);
  if (ranges.length === 0) {
    return null;
  }

  return { row, before, after: replaceBatchRanges(before, ranges, replacement), ranges };
}

function collectBatchReplaceRanges(row: DataTableRow, text: string, regex: RegExp, options: BatchReplaceOptions): BatchReplaceTextRange[] {
  const scoreSpans = options.timelineScoreFilterEnabled ? buildBatchTimelineScoreSpans(row, text, options.caseSensitive) : [];
  const ranges: BatchReplaceTextRange[] = [];
  regex.lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const matchText = match[0] ?? "";
    const end = start + matchText.length;
    if (!matchText || end <= start) {
      continue;
    }

    const score = options.timelineScoreFilterEnabled ? resolveTimelineScoreForRange(scoreSpans, start, end) : null;
    if (options.timelineScoreFilterEnabled && (score == null || score < options.timelineScoreThreshold)) {
      continue;
    }

    ranges.push({ start, end, text: matchText, score });
  }

  return ranges;
}

function buildBatchTimelineScoreSpans(row: DataTableRow, transcript: string, caseSensitive: boolean): BatchTimelineScoreSpan[] {
  const words = readBatchWords(row);
  const searchText = caseSensitive ? transcript : transcript.toLowerCase();
  const spans: BatchTimelineScoreSpan[] = [];
  let cursor = 0;

  for (const word of words) {
    const score = finiteScore(word);
    if (score == null) {
      continue;
    }

    const span = findBatchWordSpan(batchWordTextCandidates(word), searchText, cursor, caseSensitive);
    if (!span) {
      continue;
    }

    spans.push({ ...span, score });
    cursor = span.end;
  }

  return spans;
}

function batchWordTextCandidates(word: BatchWordAlignment): string[] {
  return Array.from(new Set([word.original, word.normalized].map((value) => (value || "").trim()).filter(Boolean)));
}

function findBatchWordSpan(tokens: string[], searchText: string, cursor: number, caseSensitive: boolean): { start: number; end: number } | null {
  for (const token of tokens) {
    const searchableToken = caseSensitive ? token : token.toLowerCase();
    const start = searchText.indexOf(searchableToken, cursor);
    if (start >= 0) {
      return { start, end: start + searchableToken.length };
    }
  }

  return null;
}

function finiteScore(word: BatchWordAlignment): number | null {
  const score = Number(word.score);
  return Number.isFinite(score) ? score : null;
}

function resolveTimelineScoreForRange(spans: BatchTimelineScoreSpan[], start: number, end: number): number | null {
  if (spans.length === 0) {
    return null;
  }

  const touched = new Set<BatchTimelineScoreSpan>();
  for (const span of spans) {
    if (span.start < end && span.end > start) {
      touched.add(span);
    }
  }
  addGapBoundarySpans(spans, start, touched);
  addGapBoundarySpans(spans, end, touched);

  if (touched.size === 0) {
    return null;
  }

  return Math.min(...[...touched].map((span) => span.score));
}

function addGapBoundarySpans(spans: BatchTimelineScoreSpan[], position: number, touched: Set<BatchTimelineScoreSpan>): void {
  let left: BatchTimelineScoreSpan | undefined;
  let right: BatchTimelineScoreSpan | undefined;
  for (const span of spans) {
    if (span.end <= position) {
      left = span;
      continue;
    }

    if (span.start >= position) {
      right = span;
    }
    break;
  }

  if (!left || !right || left.end >= right.start || position <= left.end || position >= right.start) {
    return;
  }

  touched.add(left);
  touched.add(right);
}

function replaceBatchRanges(text: string, ranges: BatchReplaceTextRange[], replacement: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }
    parts.push(text.slice(cursor, range.start), replacement);
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function rowFileNameForBatch(row: DataTableRow): string {
  return row.cells.fileName || row.raw?.fileName || row.raw?.file_name || row.sourcePath?.split(/[\\/]/u).pop() || row.id;
}
