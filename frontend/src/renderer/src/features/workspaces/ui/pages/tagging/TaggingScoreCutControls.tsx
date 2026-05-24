import { CircleCheck, CircleOff, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NumericField, ToggleSwitch } from "@/shared/components/controls";
import type { CellRenderContext } from "@/shared/components/data-grid";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator } from "@/shared/components/dropdown-menu";
import { clampTagCutoff, type TagScoreRule } from "../../../model/pretrained-sed-tagging";

const scoreCutText = {
  ngCut: "NG \ucef7",
} as const;

export type TagRuleFilter = "all" | "active" | "inactive";

export function TagRuleStats({ total, active, inactive }: { total: number; active: number; inactive: number }) {
  return (
    <>
      <TagRuleStatCard icon={<Tags className="size-4" />} label="전체" value={total} tone="violet" />
      <TagRuleStatCard icon={<CircleCheck className="size-4" />} label="NG 적용" value={active} tone="green" />
      <TagRuleStatCard icon={<CircleOff className="size-4" />} label="비활성" value={inactive} tone="muted" />
    </>
  );
}

function TagRuleStatCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "violet" | "green" | "muted" }) {
  return (
    <div className={cn("flex h-[38px] min-w-[132px] items-center gap-2.5 rounded-[5px] border border-[var(--panel-stroke)] px-3", tone === "violet" && "bg-[rgba(124,77,255,.13)] text-[var(--accent-blue)]", tone === "green" && "bg-[rgba(16,185,129,.11)] text-[#4ade80]", tone === "muted" && "bg-[rgba(148,163,184,.08)] text-[var(--secondary-text)]")}>
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm font-normal leading-5 text-[var(--secondary-text)]">{label}</span>
        <span className="shrink-0 text-sm font-normal leading-5 text-[var(--primary-text)]">{value}개</span>
      </span>
    </div>
  );
}

export function SegmentedTagRuleFilter({ value, onChange }: { value: TagRuleFilter; onChange: (value: TagRuleFilter) => void }) {
  const items: Array<{ value: TagRuleFilter; label: string }> = [
    { value: "all", label: "전체" },
    { value: "active", label: "적용" },
    { value: "inactive", label: "비활성" },
  ];

  return (
    <div className="grid h-8 grid-cols-3 overflow-hidden rounded-[5px] border border-[var(--panel-stroke)]">
      {items.map((item) => (
        <button key={item.value} type="button" onClick={() => onChange(item.value)} className={cn("min-w-[68px] px-3 text-sm font-normal leading-5 text-[var(--secondary-text)] hover:text-[var(--primary-text)]", value === item.value && "bg-[var(--accent-blue)] text-[var(--primary-text)]")}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TagCategoryColumnMenu({
  categories,
  categoryChecks,
  onSelectCategory,
  onToggleAll,
}: {
  categories: string[];
  categoryChecks: Record<string, boolean>;
  onSelectCategory: (category: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const allChecked = categories.length > 0 && categories.every((category) => categoryChecks[category] !== false);

  return (
    <div>
      <DropdownMenuHeader>카테고리 필터 선택</DropdownMenuHeader>
      <DropdownMenuOption label="전체" checked={allChecked} onClick={() => onToggleAll(!allChecked)} />
      <DropdownMenuSeparator />
      {categories.map((category) => (
        <DropdownMenuOption key={category} label={category} checked={categoryChecks[category] !== false} onClick={() => onSelectCategory(category)} />
      ))}
    </div>
  );
}

export function TaggingScoreCutCell({ context, rule, bulkDisabled, onUpdateAutoApplied, onUpdateCutoff }: { context: CellRenderContext; rule?: TagScoreRule; bulkDisabled: boolean; onUpdateAutoApplied: (rowId: string, isAutoApplied: boolean) => void; onUpdateCutoff: (rowId: string, cutoffScore: number, source?: "input" | "step") => void }) {
  const { column, value } = context;
  if (!rule) {
    return <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>;
  }

  if (column.key === "ngActive") {
    return (
      <div className={cn("flex h-full items-center", bulkDisabled && "opacity-35")}>
        <ToggleSwitch checked={rule.isAutoApplied} disabled={bulkDisabled} onChange={(checked) => onUpdateAutoApplied(context.row.id, checked)} />
      </div>
    );
  }

  if (column.key === "ngCut") {
    return <TagCutoffCell value={rule.cutoffScore} disabled={bulkDisabled} ariaLabel={`${rule.displayLabel} ${scoreCutText.ngCut}`} onChange={(nextValue, source) => onUpdateCutoff(context.row.id, nextValue, source)} />;
  }

  if (column.key === "category") {
    return (
      <div className={cn("flex h-full max-h-full items-center overflow-hidden", bulkDisabled && "opacity-35")}>
        <CategoryChip category={rule.category || "-"} />
      </div>
    );
  }

  return <div className={cn("max-h-full overflow-hidden truncate whitespace-nowrap leading-5", bulkDisabled && "opacity-35")}>{value || "-"}</div>;
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span className={cn("inline-flex h-5 max-w-full items-center rounded-full px-2.5 text-[11px] font-normal leading-none", categoryChipClass(category))}>
      <span className="block truncate leading-none">{category}</span>
    </span>
  );
}

function categoryChipClass(category: string): string {
  switch (category) {
    case "전자기기":
      return "bg-[#123a63] text-[#9bd4ff]";
    case "환경":
    case "자연/날씨":
      return "bg-[#145232] text-[#93f5b6]";
    case "사무/작업":
      return "bg-[#3c216b] text-[#d6c2ff]";
    case "인간 소리":
    case "말소리":
      return "bg-[#5a4310] text-[#ffe08a]";
    case "음악":
      return "bg-[#5d1f3f] text-[#ffb7d5]";
    case "동물":
      return "bg-[#3f2d14] text-[#f9c878]";
    case "교통":
      return "bg-[#153f4f] text-[#91e3f4]";
    case "생활/가정":
      return "bg-[#4a2f24] text-[#ffc0a8]";
    case "기계/도구":
      return "bg-[#353b45] text-[#cbd5e1]";
    case "충격/파열":
      return "bg-[#5b1b1b] text-[#ffb4b4]";
    case "알림/신호":
      return "bg-[#4c2f0d] text-[#ffd27a]";
    case "스포츠/놀이":
      return "bg-[#173b2f] text-[#a7f3d0]";
    default:
      return "bg-[rgba(148,163,184,.16)] text-[var(--secondary-text)]";
  }
}

function TagCutoffCell({ value, disabled = false, ariaLabel, onChange }: { value: number; disabled?: boolean; ariaLabel: string; onChange: (value: number, source?: "input" | "step") => void }) {
  return (
    <div className={cn("flex h-full min-w-[72px] items-center", disabled && "pointer-events-none opacity-35")}>
      <NumericField value={Number(formatCutoffValue(value))} ariaLabel={ariaLabel} min={0} max={1} step={0.01} wheelStep={0.01} variant="ghost" onChange={(nextValue, source) => onChange(clampTagCutoff(nextValue), source)} />
    </div>
  );
}

export function formatCutoffValue(value: number): string {
  return clampTagCutoff(value).toFixed(2);
}

export function ruleRowId(rule: TagScoreRule): string {
  return String(rule.id);
}
