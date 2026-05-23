import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumericField, SelectField, ToggleSwitch } from "@/shared/components/controls";
import {
  describeCustomChip,
  formatMetricValue,
  metricOptions,
  metricProfiles,
  numericOperatorOptions,
  type CustomChip,
  type CustomChipRule,
  type FilterMetric,
  type NumericOperator,
} from "../../../../../model/overview-filter";
import { createDefaultCustomRule, parseRuleValues } from "./filter-rule-utils";

export function CustomChipDraftCard({
  draftName,
  rules,
  onNameChange,
  onRulesChange,
  onSave,
}: {
  draftName: string;
  rules: CustomChipRule[];
  onNameChange: (name: string) => void;
  onRulesChange: (rules: CustomChipRule[]) => void;
  onSave: () => void;
}) {
  return (
    <div className="pt-4">
      <h5 className="mb-3 text-sm font-normal leading-5 text-[var(--primary-text)]">새 커스텀 칩 추가</h5>
      <input className="wpf-field h-[38px] w-full px-3 text-sm outline-none" placeholder="칩 이름을 입력하세요." value={draftName} onChange={(event) => onNameChange(event.target.value)} />
      <div className="app-scrollbar mt-3 max-h-[116px] space-y-2 overflow-auto pr-1">
        {rules.map((rule, index) => (
          <RuleRow
            key={index}
            index={index}
            rule={rule}
            onChange={(nextRule) => onRulesChange(rules.map((item, itemIndex) => (itemIndex === index ? nextRule : item)))}
            onDelete={() => onRulesChange(rules.filter((_, itemIndex) => itemIndex !== index))}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between">
        <button type="button" className="wpf-primary-button px-4 text-sm font-normal" onClick={() => onRulesChange([...rules, createDefaultCustomRule()])}>
          + 규칙 추가
        </button>
        <button type="button" className="wpf-primary-button px-4 text-sm font-normal" onClick={onSave}>
          커스텀 칩 저장
        </button>
      </div>
    </div>
  );
}

function RuleRow({ index, rule, onChange, onDelete }: { index: number; rule: CustomChipRule; onChange: (rule: CustomChipRule) => void; onDelete: () => void }) {
  const setMetric = (metric: FilterMetric) => {
    onChange({ ...rule, metric, value: formatMetricValue(metric, metricProfiles[metric].defaultBoundary) });
  };
  const setOperator = (operator: NumericOperator) => {
    const profile = metricProfiles[rule.metric];
    const singleValue = parseRuleValues(rule.value, rule.metric, 1)[0] ?? profile.defaultBoundary;
    const value = operator === "between" || operator === "notBetween"
      ? `${formatMetricValue(rule.metric, profile.min)}~${formatMetricValue(rule.metric, singleValue)}`
      : formatMetricValue(rule.metric, singleValue);
    onChange({ ...rule, operator, value });
  };

  return (
    <div className="grid grid-cols-[46px_94px_minmax(112px,0.9fr)_100px_minmax(170px,1.65fr)_32px] items-center gap-2">
      <span className="text-[13px] text-[var(--secondary-text)]">규칙 {index + 1}</span>
      <div className={cn(index === 0 && "invisible pointer-events-none")}>
        <SelectField value={rule.join} options={[{ value: "AND", label: "AND" }, { value: "OR", label: "OR" }]} onChange={(value) => onChange({ ...rule, join: value })} ariaLabel="조건 연결" />
      </div>
      <SelectField
        value={rule.metric}
        options={[...metricOptions]}
        onChange={setMetric}
        ariaLabel="Metric"
      />
      <SelectField value={rule.operator} options={[...numericOperatorOptions]} onChange={setOperator} ariaLabel="조건" />
      <RuleValueField rule={rule} onChange={onChange} />
      <button type="button" onClick={onDelete} className="flex size-8 items-center justify-center text-[#ff8c96]" aria-label="규칙 삭제">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function RuleValueField({ rule, onChange }: { rule: CustomChipRule; onChange: (rule: CustomChipRule) => void }) {
  const profile = metricProfiles[rule.metric];
  const dual = rule.operator === "between" || rule.operator === "notBetween";
  const values = parseRuleValues(rule.value, rule.metric, dual ? 2 : 1);

  if (dual) {
    const left = values[0] ?? profile.min;
    const right = values[1] ?? profile.defaultBoundary;
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center">
        <NumericField value={left} min={profile.min} max={profile.max} step={profile.step} onChange={(value) => onChange({ ...rule, value: `${formatMetricValue(rule.metric, value)}~${formatMetricValue(rule.metric, right)}` })} ariaLabel="결과 오디오" />
        <span className="text-center text-[var(--secondary-text)]">~</span>
        <NumericField value={right} min={profile.min} max={profile.max} step={profile.step} onChange={(value) => onChange({ ...rule, value: `${formatMetricValue(rule.metric, left)}~${formatMetricValue(rule.metric, value)}` })} ariaLabel="결과 오디오" />
      </div>
    );
  }

  return (
    <NumericField
      value={values[0] ?? profile.defaultBoundary}
      min={profile.min}
      max={profile.max}
      step={profile.step}
      onChange={(value) => onChange({ ...rule, value: formatMetricValue(rule.metric, value) })}
      ariaLabel="조건값"
    />
  );
}

export function CustomChipCard({ chip, onToggle, onEdit, onDelete }: { chip: CustomChip; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="min-h-[102px] rounded-[5px] border border-[var(--panel-stroke)] bg-transparent p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-normal leading-5 text-[var(--primary-text)]">{chip.name}</p>
        <ToggleSwitch checked={chip.visible ?? true} onChange={onToggle} />
      </div>
      <p className="mt-2 line-clamp-2 whitespace-pre-line text-[13px] leading-5 text-[var(--secondary-text)]">{describeCustomChip(chip)}</p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="wpf-button h-8 px-3 text-sm font-normal" onClick={onEdit}>
          수정
        </button>
        <button type="button" className="ml-auto flex size-8 items-center justify-center text-[#ff8c96]" onClick={onDelete} aria-label="커스텀 칩 삭제">
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
