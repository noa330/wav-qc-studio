import type { DataTable, DataTableRow, SlicerSettings } from "@shared/ipc";
import tagTranslations from "./sed-tag-translations.json";

export type TagTranslationEntry = {
  id: number;
  label: string;
  translation: string;
  category: string;
  description: string;
};

export type SlicerTagScore = {
  rank: number;
  label: string;
  displayLabel: string;
  category: string;
  description: string;
  score: number;
  logit: number;
};

export type FrameTagRow = {
  startSec: number;
  endSec: number;
  tags: SlicerTagScore[];
};

export type FrameTagDisplayRow = {
  startSec: number;
  endSec: number;
  tags: Array<SlicerTagScore & { isNg: boolean }>;
};

export type TagScoreRule = {
  id: number;
  label: string;
  displayLabel: string;
  category: string;
  description: string;
  cutoffScore: number;
  isAutoApplied: boolean;
  isPriority: boolean;
  priorityOrder?: number;
};

export type ClassifiedSlicerTags = {
  ok: SlicerTagScore[];
  ng: SlicerTagScore[];
};

type ActiveTagRuleMap = Map<string, TagScoreRule>;

export const defaultTagCutoffScore = 0.6;
const defaultCutoffScore = defaultTagCutoffScore;
const fallbackCategory = "기타";
const defaultNgOffLabelPatterns = [
  /\bspeech\b/u,
  /\bspeaking\b/u,
  /\bconversation\b/u,
  /\bnarration\b/u,
  /\bmonologue\b/u,
  /\bhuman voice\b/u,
  /\bchild singing\b/u,
  /\bfemale singing\b/u,
  /\bmale singing\b/u,
  /\bsynthetic singing\b/u,
  /\bsinging\b/u,
  /\bspeech synthesizer\b/u,
  /\bchildren playing\b/u,
] as const;
const catalogEntries = tagTranslations as TagTranslationEntry[];
const translationByLabel = new Map(catalogEntries.map((entry) => [normalizeLabel(entry.label), entry]));
const frameRowsCache = new Map<string, FrameTagRow[]>();
const tagScoresCache = new Map<string, SlicerTagScore[]>();
const frameRowsCacheLimit = 256;
const tagScoresCacheLimit = 1024;

export const frameTagCatalog = catalogEntries;

export function createDefaultTagScoreRules(): TagScoreRule[] {
  return catalogEntries.map((entry) =>
    hydrateTagScoreRule({
      id: entry.id,
      label: entry.label,
      cutoffScore: defaultCutoffScore,
      isAutoApplied: isDefaultAutoApplied(entry.category, entry.label),
      isPriority: false,
    }),
  );
}

export function hydrateTagScoreRule(rule: Partial<TagScoreRule> & Pick<TagScoreRule, "id" | "label">): TagScoreRule {
  const metadata = getFrameTagMetadata(rule.label);
  return {
    id: rule.id,
    label: rule.label,
    displayLabel: rule.displayLabel?.trim() || metadata.displayLabel,
    category: rule.category?.trim() || metadata.category,
    description: rule.description?.trim() || metadata.description,
    cutoffScore: clampTagCutoff(rule.cutoffScore ?? defaultCutoffScore),
    isAutoApplied: rule.isAutoApplied ?? isDefaultAutoApplied(rule.category?.trim() || metadata.category, rule.label),
    isPriority: rule.isPriority ?? false,
    priorityOrder: rule.priorityOrder,
  };
}

export function mergeTagScoreRulesFromTable(rules: TagScoreRule[], table: DataTable): TagScoreRule[] {
  if (table.rows.length === 0) {
    return rules;
  }

  const ruleByLabel = new Map(rules.map((rule) => [normalizeLabel(rule.label), rule]));
  let nextId = rules.reduce((max, rule) => Math.max(max, rule.id), 0) + 1;
  let changed = false;
  const nextRules = [...rules];

  for (const row of table.rows) {
    forEachRowTag(row, (tag) => {
      const normalizedLabel = normalizeLabel(tag.label);
      if (!normalizedLabel || ruleByLabel.has(normalizedLabel)) {
        return;
      }

      const rule = hydrateTagScoreRule({
        id: nextId++,
        label: tag.label,
        displayLabel: tag.displayLabel,
        category: tag.category,
        description: tag.description,
        cutoffScore: defaultCutoffScore,
        isAutoApplied: isDefaultAutoApplied(tag.category, tag.label),
        isPriority: false,
      });
      ruleByLabel.set(normalizedLabel, rule);
      nextRules.push(rule);
      changed = true;
    });
  }

  return changed ? nextRules : rules;
}

export function clampTagCutoff(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultCutoffScore;
  }

  return Math.max(0, Math.min(1, Math.round(value * 1000000) / 1000000));
}

export function applyTagScoreRulesToTable(table: DataTable, rules: TagScoreRule[], settings: SlicerSettings): DataTable {
  if (table.rows.length === 0) {
    return table;
  }

  const activeRuleByLabel = buildActiveRuleMap(rules);
  const displayCount = Math.max(1, Math.min(50, Math.trunc(settings.pretrainedSedTopK || 1)));
  const rows = table.rows.map((row) => {
    const matchedNgTags = aggregateMatchedNgTags(row, activeRuleByLabel);
    const ngTags = matchedNgTags
      .slice(0, displayCount)
      .map((tag) => `${tag.displayLabel} ${formatTagScore(tag.score)}`)
      .join(", ");

    return {
      ...row,
      raw: {
        ...(row.raw ?? {}),
        ngTags: ngTags || "-",
      },
      cells: {
        ...row.cells,
        ngTags: ngTags || "-",
      },
    };
  });

  return {
    ...table,
    rows,
  };
}

export function classifySlicerTagsByRules(tags: SlicerTagScore[], rules: TagScoreRule[], _settings: SlicerSettings): ClassifiedSlicerTags {
  const grouped: ClassifiedSlicerTags = { ok: [], ng: [] };
  const activeRuleByLabel = buildActiveRuleMap(rules);

  for (const tag of tags) {
    if (matchesNgCut(tag, activeRuleByLabel)) {
      grouped.ng.push(tag);
    } else {
      grouped.ok.push(tag);
    }
  }

  return grouped;
}

export function classifyFrameTagRowsByRules(frames: FrameTagRow[], rules: TagScoreRule[]): FrameTagDisplayRow[] {
  const activeRuleByLabel = buildActiveRuleMap(rules);
  return frames.map((frame) => classifyFrameTagRow(frame, activeRuleByLabel));
}

export function createFrameTagRowClassifier(rules: TagScoreRule[]): (frame: FrameTagRow) => FrameTagDisplayRow {
  const activeRuleByLabel = buildActiveRuleMap(rules);
  return (frame) => classifyFrameTagRow(frame, activeRuleByLabel);
}

function classifyFrameTagRow(frame: FrameTagRow, activeRuleByLabel: ActiveTagRuleMap): FrameTagDisplayRow {
  return {
    startSec: frame.startSec,
    endSec: frame.endSec,
    tags: frame.tags.map((tag) => ({ ...tag, isNg: matchesNgCut(tag, activeRuleByLabel) })),
  };
}

export function parseFrameTagRows(row?: DataTableRow): FrameTagRow[] {
  const rawFrameTags = row?.raw?.frameTags;
  if (rawFrameTags && frameRowsCache.has(rawFrameTags)) {
    return frameRowsCache.get(rawFrameTags) ?? [];
  }

  const parsed = parseJsonArray(rawFrameTags);
  if (!parsed) {
    const tags = parseSlicerTags(row);
    return tags.length > 0 ? [{ startSec: 0, endSec: readRowDurationSeconds(row), tags }] : [];
  }

  const frames = parsed
    .map((item) => normalizeFrameTagRow(item))
    .filter((frame): frame is FrameTagRow => Boolean(frame))
    .sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
  if (rawFrameTags) {
    rememberBoundedParsedCache(frameRowsCache, rawFrameTags, frames, frameRowsCacheLimit);
  }
  return frames;
}

export function parseSlicerTags(row?: DataTableRow): SlicerTagScore[] {
  const rawTags = row?.raw?.tags;
  if (rawTags && tagScoresCache.has(rawTags)) {
    return tagScoresCache.get(rawTags) ?? [];
  }

  const parsed = parseJsonArray(rawTags);
  if (!parsed) {
    return [];
  }

  const tags = parsed
    .map((item, index) => normalizeTagScore(item, index))
    .filter((tag): tag is SlicerTagScore => Boolean(tag))
    .sort((left, right) => left.rank - right.rank);
  if (rawTags) {
    rememberBoundedParsedCache(tagScoresCache, rawTags, tags, tagScoresCacheLimit);
  }
  return tags;
}

export function formatTagScore(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "");
}

export function translateFrameTag(label: string): string {
  return getFrameTagMetadata(label).displayLabel;
}

export function getFrameTagMetadata(label: string): Pick<TagScoreRule, "displayLabel" | "category" | "description"> {
  const entry = translationByLabel.get(normalizeLabel(label));
  const displayLabel = entry?.translation.trim() || label;
  return {
    displayLabel,
    category: entry?.category?.trim() || fallbackCategory,
    description: entry?.description?.trim() || `${displayLabel}: 분류 메타데이터가 없는 음향 이벤트입니다.`,
  };
}

function aggregateMatchedNgTags(row: DataTableRow, activeRuleByLabel: ActiveTagRuleMap): SlicerTagScore[] {
  const byLabel = new Map<string, SlicerTagScore>();
  forEachRowTag(row, (tag) => {
    if (!matchesNgCut(tag, activeRuleByLabel)) {
      return;
    }
    const key = normalizeLabel(tag.label);
    const current = byLabel.get(key);
    if (!current || tag.score > current.score) {
      byLabel.set(key, tag);
    }
  });
  return [...byLabel.values()].sort((left, right) => right.score - left.score || left.rank - right.rank);
}

function collectRowTags(row?: DataTableRow): SlicerTagScore[] {
  const tags: SlicerTagScore[] = [];
  forEachRowTag(row, (tag) => {
    tags.push(tag);
  });
  return tags;
}

function forEachRowTag(row: DataTableRow | undefined, visitor: (tag: SlicerTagScore) => void): void {
  const frames = parseFrameTagRows(row);
  if (frames.length > 0) {
    for (const frame of frames) {
      for (const tag of frame.tags) {
        visitor(tag);
      }
    }
    return;
  }

  for (const tag of parseSlicerTags(row)) {
    visitor(tag);
  }
}

function matchesNgCut(tag: SlicerTagScore, activeRuleByLabel: ActiveTagRuleMap): boolean {
  const rule = activeRuleByLabel.get(normalizeLabel(tag.label));
  return Boolean(rule && tag.score >= clampTagCutoff(rule.cutoffScore));
}

function buildActiveRuleMap(rules: TagScoreRule[]): ActiveTagRuleMap {
  const activeRuleByLabel: ActiveTagRuleMap = new Map();
  for (const rule of rules) {
    if (rule.isAutoApplied) {
      activeRuleByLabel.set(normalizeLabel(rule.label), rule);
    }
  }
  return activeRuleByLabel;
}

function normalizeFrameTagRow(item: unknown): FrameTagRow | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const tags = Array.isArray(record.tags)
    ? record.tags.map((tag, index) => normalizeTagScore(tag, index)).filter((tag): tag is SlicerTagScore => Boolean(tag))
    : [];
  return {
    startSec: numberValue(record.startSec),
    endSec: numberValue(record.endSec),
    tags,
  };
}

function normalizeTagScore(item: unknown, index: number): SlicerTagScore | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const label = String(record.label ?? "").trim();
  if (!label) {
    return null;
  }

  const score = Number(record.score);
  const metadata = getFrameTagMetadata(label);
  return {
    rank: Number.isFinite(Number(record.rank)) ? Number(record.rank) : index + 1,
    label,
    displayLabel: metadata.displayLabel,
    category: metadata.category,
    description: metadata.description,
    score: Number.isFinite(score) ? score : 0,
    logit: Number.isFinite(Number(record.logit)) ? Number(record.logit) : 0,
  };
}

function parseJsonArray(raw: string | undefined): unknown[] | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rememberBoundedParsedCache<TValue>(cache: Map<string, TValue>, key: string, value: TValue, limit: number): void {
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function readRowDurationSeconds(row?: DataTableRow): number {
  const duration = Number(row?.raw?.durationSec ?? row?.raw?.duration_sec ?? 0);
  return Number.isFinite(duration) ? duration : 0;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

export function isDefaultAutoApplied(_category: string, label: string): boolean {
  const normalizedLabel = normalizeLabel(label);
  return !defaultNgOffLabelPatterns.some((pattern) => pattern.test(normalizedLabel));
}
