import type { DataTable, DataTableRow } from "@shared/ipc";

export type OxFilterState = "all" | "o" | "x";
export type FilterMetric = "noise" | "noise_sig" | "noise_ovrl" | "noise_p808_mos";
export type OverviewMetricColumn = "noise_bak" | "noise_sig" | "noise_ovrl" | "noise_p808_mos";
export type NumericOperator = "between" | "notBetween" | "equals" | "notEquals" | "gte" | "lte";

export type CustomChipRule = {
  join: "AND" | "OR";
  metric: FilterMetric;
  operator: NumericOperator;
  value: string;
};

export type CustomChip = {
  id: string;
  name: string;
  rules: CustomChipRule[];
  visible?: boolean;
  active: boolean;
};

export type OverviewFilterState = {
  textQuery: string;
  textColumns: string[];
  noise: OxFilterState;
  columnFilters: Record<OverviewMetricColumn, OxFilterState>;
  boundaries: Record<FilterMetric, number>;
  customChips: CustomChip[];
};

export type MetricProfile = {
  metric: FilterMetric;
  chipLabel: string;
  editorLabel: string;
  scoreKey: string;
  oxKey?: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  defaultBoundary: number;
  higherScoresAreWorse: boolean;
};

export const metricProfiles: Record<FilterMetric, MetricProfile> = {
  noise: {
    metric: "noise",
    chipLabel: "BAK",
    editorLabel: "BAK",
    scoreKey: "noise_bak",
    min: 1,
    max: 5,
    step: 0.1,
    decimals: 1,
    defaultBoundary: 3,
    higherScoresAreWorse: false,
  },
  noise_sig: {
    metric: "noise_sig",
    chipLabel: "SIG",
    editorLabel: "SIG",
    scoreKey: "noise_sig",
    min: 1,
    max: 5,
    step: 0.1,
    decimals: 1,
    defaultBoundary: 3,
    higherScoresAreWorse: false,
  },
  noise_ovrl: {
    metric: "noise_ovrl",
    chipLabel: "OVRL",
    editorLabel: "OVRL",
    scoreKey: "noise_ovrl",
    min: 1,
    max: 5,
    step: 0.1,
    decimals: 1,
    defaultBoundary: 3,
    higherScoresAreWorse: false,
  },
  noise_p808_mos: {
    metric: "noise_p808_mos",
    chipLabel: "P808",
    editorLabel: "P808",
    scoreKey: "noise_p808_mos",
    min: 1,
    max: 5,
    step: 0.1,
    decimals: 1,
    defaultBoundary: 3,
    higherScoresAreWorse: false,
  },
};

export const metricOptions = [
  { value: "noise", label: metricProfiles.noise.editorLabel },
  { value: "noise_sig", label: metricProfiles.noise_sig.editorLabel },
  { value: "noise_ovrl", label: metricProfiles.noise_ovrl.editorLabel },
  { value: "noise_p808_mos", label: metricProfiles.noise_p808_mos.editorLabel },
] as const;

export const overviewMetricColumnMap: Record<OverviewMetricColumn, FilterMetric> = {
  noise_bak: "noise",
  noise_sig: "noise_sig",
  noise_ovrl: "noise_ovrl",
  noise_p808_mos: "noise_p808_mos",
};

export const overviewMetricColumns: OverviewMetricColumn[] = ["noise_bak", "noise_sig", "noise_ovrl", "noise_p808_mos"];

export const numericOperatorOptions = [
  { value: "between", label: "a<=x<=b" },
  { value: "notBetween", label: "x<a or x>b" },
  { value: "equals", label: "=" },
  { value: "notEquals", label: "!=" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
] as const;

export function createDefaultOverviewFilterState(): OverviewFilterState {
  return {
    textQuery: "",
    textColumns: [],
    noise: "all",
    columnFilters: {
      noise_bak: "all",
      noise_sig: "all",
      noise_ovrl: "all",
      noise_p808_mos: "all",
    },
    boundaries: {
      noise: metricProfiles.noise.defaultBoundary,
      noise_sig: metricProfiles.noise_sig.defaultBoundary,
      noise_ovrl: metricProfiles.noise_ovrl.defaultBoundary,
      noise_p808_mos: metricProfiles.noise_p808_mos.defaultBoundary,
    },
    customChips: [],
  };
}

export function cloneOverviewFilterState(state: OverviewFilterState): OverviewFilterState {
  return {
    ...state,
    textColumns: [...state.textColumns],
    columnFilters: {
      noise_bak: state.columnFilters?.noise_bak ?? state.noise ?? "all",
      noise_sig: state.columnFilters?.noise_sig ?? "all",
      noise_ovrl: state.columnFilters?.noise_ovrl ?? "all",
      noise_p808_mos: state.columnFilters?.noise_p808_mos ?? "all",
    },
    boundaries: { ...state.boundaries },
    customChips: state.customChips.map((chip) => ({
      ...chip,
      visible: chip.visible ?? true,
      rules: chip.rules.map((rule) => ({ ...rule })),
    })),
  };
}

export function cycleOxFilterState(current: OxFilterState): OxFilterState {
  if (current === "all") {
    return "o";
  }

  return current === "o" ? "x" : "all";
}

export function clampMetricBoundary(metric: FilterMetric, value: number): number {
  const profile = metricProfiles[metric];
  const clamped = Math.min(profile.max, Math.max(profile.min, Number.isFinite(value) ? value : profile.defaultBoundary));
  const factor = 10 ** profile.decimals;
  return Math.round(clamped * factor) / factor;
}

export function formatMetricValue(metric: FilterMetric, value: number): string {
  const profile = metricProfiles[metric];
  return clampMetricBoundary(metric, value).toFixed(profile.decimals);
}

export function filterOverviewTable(table: DataTable, state: OverviewFilterState): DataTable {
  if (table.rows.length === 0) {
    return table;
  }

  return {
    columns: table.columns,
    rows: table.rows.filter((row) => matchesOverviewFilter(row, state, table.columns.map((column) => column.key).filter((key) => key !== "index"))),
  };
}

export function describeCustomChip(chip: CustomChip): string {
  const configuredRules = chip.rules.filter((rule) => isConfiguredRule(rule));
  if (configuredRules.length === 0) {
    return "규칙 없음";
  }

  return configuredRules
    .map((rule, index) => {
      const prefix = index > 0 ? `${rule.join} ` : "";
      return `${prefix}${metricProfiles[rule.metric].editorLabel} ${operatorLabel(rule.operator)} ${rule.value.trim()}`;
    })
    .join("\n");
}

export function operatorLabel(operator: NumericOperator): string {
  return numericOperatorOptions.find((option) => option.value === operator)?.label ?? operator;
}

function matchesOverviewFilter(row: DataTableRow, state: OverviewFilterState, searchableColumns: string[]): boolean {
  const textQuery = normalizeQuery(state.textQuery);
  if (textQuery) {
    const targetColumns = state.textColumns.length > 0 ? state.textColumns : searchableColumns;
    const combined = normalizeQuery(targetColumns.map((key) => readSearchCell(row, key)).join(" "));
    if (!combined.includes(textQuery)) {
      return false;
    }
  }

  for (const column of overviewMetricColumns) {
    const metric = overviewMetricColumnMap[column];
    const filterState = state.columnFilters?.[column] ?? (metric === "noise" ? state.noise : "all");
    if (!matchesOxMetric(row, metric, filterState, state.boundaries[metric] ?? metricProfiles[metric].defaultBoundary)) {
      return false;
    }
  }

  const activeChips = state.customChips.filter((chip) => chip.active);
  return activeChips.every((chip) => matchesCustomChip(row, chip));
}

function matchesOxMetric(row: DataTableRow, metric: FilterMetric, state: OxFilterState, boundary: number): boolean {
  if (state === "all") {
    return true;
  }

  return resolveOx(row, metric, boundary) === state.toUpperCase();
}

function matchesCustomChip(row: DataTableRow, chip: CustomChip): boolean {
  const configuredRules = chip.rules.filter((rule) => isConfiguredRule(rule));
  if (configuredRules.length === 0) {
    return false;
  }

  let result = evaluateRule(row, configuredRules[0]);
  for (let index = 1; index < configuredRules.length; index += 1) {
    const rule = configuredRules[index];
    const nextResult = evaluateRule(row, rule);
    result = rule.join === "AND" ? result && nextResult : result || nextResult;
  }

  return result;
}

function evaluateRule(row: DataTableRow, rule: CustomChipRule): boolean {
  const score = readMetricScore(row, rule.metric);
  if (score === null) {
    return false;
  }

  if (rule.operator === "between") {
    return matchesSelector(rule.value, score);
  }

  if (rule.operator === "notBetween") {
    return !matchesSelector(rule.value, score);
  }

  if (rule.operator === "equals") {
    return matchesSelector(rule.value, score);
  }

  if (rule.operator === "notEquals") {
    return !matchesSelector(rule.value, score);
  }

  const threshold = parseSingleValue(rule.value);
  if (threshold === null) {
    return false;
  }

  return rule.operator === "gte" ? score >= threshold : score <= threshold;
}

function resolveOx(row: DataTableRow, metric: FilterMetric, boundary: number): "O" | "X" | "" {
  const profile = metricProfiles[metric];
  const score = readMetricScore(row, metric);
  if (score !== null) {
    if (profile.higherScoresAreWorse) {
      return score >= boundary ? "O" : "X";
    }

    return score < boundary ? "O" : "X";
  }

  return normalizeOx(profile.oxKey ? readCell(row, profile.oxKey) : "");
}

function readMetricScore(row: DataTableRow, metric: FilterMetric): number | null {
  const raw = readCell(row, metricProfiles[metric].scoreKey);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isConfiguredRule(rule: CustomChipRule): boolean {
  return Boolean(rule.metric && rule.operator && rule.value.trim());
}

function matchesSelector(rawValue: string, score: number): boolean {
  const tokens = parseSelectorTokens(rawValue);
  return tokens.some((token) => score >= token.min && score <= token.max);
}

function parseSelectorTokens(rawValue: string): Array<{ min: number; max: number }> {
  return normalizeRangeText(rawValue)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const pieces = part.split("-").map((piece) => piece.trim()).filter(Boolean);
      if (pieces.length === 1) {
        const single = Number(pieces[0]);
        return Number.isFinite(single) ? [{ min: single, max: single }] : [];
      }

      const left = Number(pieces[0]);
      const right = Number(pieces[1]);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return [];
      }

      return [{ min: Math.min(left, right), max: Math.max(left, right) }];
    });
}

function parseSingleValue(rawValue: string): number | null {
  const firstToken = normalizeRangeText(rawValue).split(",")[0]?.trim();
  if (!firstToken) {
    return null;
  }

  const firstPiece = firstToken.split("-").map((part) => part.trim()).filter(Boolean)[0] ?? firstToken;
  const parsed = Number(firstPiece);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRangeText(value: string): string {
  return value.replace(/[~～－–—]/gu, "-").replace(/\s+/gu, "");
}

function readCell(row: DataTableRow, key: string): string {
  return row.raw?.[key] ?? row.cells[key] ?? "";
}

function readSearchCell(row: DataTableRow, key: string): string {
  if (key === "sourcePath") {
    return row.sourcePath ?? "";
  }

  return readCell(row, key);
}

function normalizeQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeOx(value: string): "O" | "X" | "" {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (["o", "ok", "true", "1", "yes", "y", "bad", "ng"].includes(normalized)) {
    return "O";
  }

  if (["x", "false", "0", "no", "n", "good", "normal"].includes(normalized)) {
    return "X";
  }

  return "";
}
