import { cn } from "@/lib/utils";
import {
  clampMetricBoundary,
  formatMetricValue,
  metricProfiles,
  type FilterMetric,
  type OverviewFilterState,
} from "../../../../../model/overview-filter";

export function BasicFilterSettings({ filter, onChange }: { filter: OverviewFilterState; onChange: (filter: OverviewFilterState) => void }) {
  const updateBoundary = (metric: FilterMetric, value: number) => {
    onChange({
      ...filter,
      boundaries: {
        ...filter.boundaries,
        [metric]: clampMetricBoundary(metric, value),
      },
      customChips: filter.customChips.map((chip) => ({ ...chip, active: false })),
    });
  };

  return (
    <div className="min-h-0 flex-1 pt-4">
      <h5 className="mb-4 text-sm font-normal leading-5 text-[var(--primary-text)]">기본 필터 점수 범위 설정</h5>
      <div className="app-scrollbar h-full overflow-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <DualMetricRangeCard metric="noise" value={filter.boundaries.noise} onChange={(value) => updateBoundary("noise", value)} />
          <DualMetricRangeCard metric="noise_sig" value={filter.boundaries.noise_sig} onChange={(value) => updateBoundary("noise_sig", value)} />
          <DualMetricRangeCard metric="noise_ovrl" value={filter.boundaries.noise_ovrl} onChange={(value) => updateBoundary("noise_ovrl", value)} />
          <DualMetricRangeCard metric="noise_p808_mos" value={filter.boundaries.noise_p808_mos} onChange={(value) => updateBoundary("noise_p808_mos", value)} />
        </div>
      </div>
    </div>
  );
}

function DualMetricRangeCard({ metric, value, onChange }: { metric: FilterMetric; value: number; onChange: (value: number) => void }) {
  const profile = metricProfiles[metric];
  const boundary = clampMetricBoundary(metric, value);
  const percentage = ((boundary - profile.min) / (profile.max - profile.min)) * 100;
  const okRange = profile.higherScoresAreWorse ? { start: 0, end: percentage } : { start: percentage, end: 100 };
  const ngRange = profile.higherScoresAreWorse ? { start: percentage, end: 100 } : { start: 0, end: percentage };
  const scoreText = formatMetricValue(metric, boundary);

  return (
    <div className="rounded-[5px] border border-[var(--panel-stroke)] bg-transparent px-3 py-4">
      <div className="mb-3">
        <p className="text-sm font-normal leading-5 text-[var(--primary-text)]">{profile.chipLabel}</p>
      </div>
      <MetricRangeRow label="OK" scoreText={scoreText} metric={metric} rangeStart={okRange.start} rangeEnd={okRange.end} boundary={boundary} percentage={percentage} onChange={onChange} />
      <MetricRangeRow label="NG" scoreText={scoreText} metric={metric} rangeStart={ngRange.start} rangeEnd={ngRange.end} boundary={boundary} percentage={percentage} onChange={onChange} danger />
    </div>
  );
}

function MetricRangeRow({
  label,
  scoreText,
  metric,
  rangeStart,
  rangeEnd,
  boundary,
  percentage,
  danger = false,
  onChange,
}: {
  label: string;
  scoreText: string;
  metric: FilterMetric;
  rangeStart: number;
  rangeEnd: number;
  boundary: number;
  percentage: number;
  danger?: boolean;
  onChange: (value: number) => void;
}) {
  const profile = metricProfiles[metric];

  return (
    <div className="mt-3 grid grid-cols-[32px_minmax(0,1fr)_46px] items-center gap-2">
      <span className={cn("text-[13px] font-normal leading-[18px]", danger ? "text-[#ff8c96]" : "text-[#a9c5ff]")}>{label}</span>
      <div className="relative h-8">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-[var(--slider-rail)]" />
        <div className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded", danger ? "bg-[var(--chip-negative-dot)]" : "bg-[var(--accent-blue)]")} style={{ left: `${rangeStart}%`, right: `${100 - rangeEnd}%` }} />
        <input
          type="range"
          min={profile.min}
          max={profile.max}
          step={profile.step}
          value={boundary}
          onChange={(event) => onChange(Number(event.target.value))}
          className="absolute inset-0 h-8 w-full cursor-pointer opacity-0"
          aria-label={`${profile.chipLabel} ${label}`}
        />
        <div className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--panel-stroke)] bg-[var(--primary-text)]" style={{ left: `${percentage}%` }} />
      </div>
      <span className="truncate text-right text-[13px] text-[var(--secondary-text)]">{scoreText}</span>
    </div>
  );
}
