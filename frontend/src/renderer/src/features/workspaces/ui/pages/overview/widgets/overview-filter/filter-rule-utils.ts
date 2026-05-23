import {
  clampMetricBoundary,
  formatMetricValue,
  metricProfiles,
  type CustomChipRule,
  type FilterMetric,
} from "../../../../../model/overview-filter";

export function createDefaultCustomRule(): CustomChipRule {
  return {
    join: "AND",
    metric: "noise",
    operator: "lte",
    value: formatMetricValue("noise", metricProfiles.noise.defaultBoundary),
  };
}

export function parseRuleValues(value: string, metric: FilterMetric, expectedCount: number): number[] {
  const profile = metricProfiles[metric];
  const pieces = value
    .replace(/[~～－–—]/gu, "-")
    .split(/[-,]/u)
    .map((piece) => Number(piece.trim()))
    .filter(Number.isFinite)
    .slice(0, expectedCount);

  if (pieces.length === expectedCount) {
    return pieces.map((piece) => clampMetricBoundary(metric, piece));
  }

  return expectedCount === 2
    ? [profile.min, profile.defaultBoundary]
    : [profile.defaultBoundary];
}
