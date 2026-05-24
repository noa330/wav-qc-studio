import { CircleCheck, CircleOff, ListChecks, RotateCcw, Tags, X } from "lucide-react";
import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ColumnSearchField } from "@/shared/components/column-search-field";
import { NumericField, ToggleSwitch } from "@/shared/components/controls";
import { DataGrid, type CellRenderContext } from "@/shared/components/data-grid";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator } from "@/shared/components/dropdown-menu";
import { dialogPanelMotion, menuMotion, softPressTap, tightPressTap, timelineFocusItemVariants, timelineFocusTransition } from "@/shared/motion";
import {
  clampTagCutoff,
  createFrameTagRowClassifier,
  defaultTagCutoffScore,
  formatTagScore,
  hydrateTagScoreRule,
  isDefaultAutoApplied,
  parseFrameTagRows,
  type FrameTagDisplayRow,
  type FrameTagRow,
  type TagScoreRule,
} from "../../../model/pretrained-sed-tagging";
import { ScrollWindowViewport, type ScrollWindowHandle } from "@/shared/components/virtual-scroll";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { EmptyPanel } from "../../shared/workspace-panel-primitives";
import { requestWorkspaceAudioSeek, useWorkspaceAudioSync } from "../../shared/workspace-audio-sync";

const text = {
  selectAllAuto: "\uc804\uccb4 \uc790\ub3d9 \uc801\uc6a9",
  autoApply: "\uc790\ub3d9 \uc801\uc6a9",
  priority: "\uc6b0\uc120 \uc801\uc6a9",
  selectedTag: "\uc120\ud0dd \ud0dc\uadf8",
  ngCut: "NG \ucef7",
  noSelectedFile: "\uc120\ud0dd\ub41c \ud30c\uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
  noTagScores: "\uc120\ud0dd\ub41c \ud30c\uc77c\uc758 \ud0dc\uadf8 \uc810\uc218\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.",
} as const;

type TagRuleFilter = "all" | "active" | "inactive";
type TagRulePresetSheet = {
  id: string;
  label: string;
  rules: TagScoreRule[];
  filter: TagRuleFilter;
  categoryChecks: Record<string, boolean>;
};
const tagRuleSearchOptions = [
  { key: "selectedTag", label: "상황 태그" },
  { key: "category", label: "카테고리" },
  { key: "description", label: "설명" },
];
const frameTagRowHeight = 126;
const frameTagRowGap = 8;
type FrameRevealRequest = {
  index: number;
  timeoutIds: number[];
};
const frameTagBufferScreens = 1;

export function TaggingScoreCutDialog({ runtime, onClose }: { runtime: WorkspaceRuntime; onClose: () => void }) {
  const [sheets, setSheets] = useState<TagRulePresetSheet[]>(() => [
    { id: "tag-rule-sheet-1", label: "Sheet1", rules: runtime.tagScoreRules.map((rule) => hydrateTagScoreRule(rule)), filter: "all", categoryChecks: {} },
  ]);
  const [activeSheetId, setActiveSheetId] = useState("tag-rule-sheet-1");
  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0];
  const updateActiveSheet = (patch: Partial<Omit<TagRulePresetSheet, "id" | "label">>) => {
    setSheets((current) => current.map((sheet) => (sheet.id === activeSheet.id ? { ...sheet, ...patch } : sheet)));
  };
  const createSheet = () => {
    const nextNumber = sheets.length + 1;
    const nextSheet = {
      id: `tag-rule-sheet-${Date.now()}`,
      label: `Sheet${nextNumber}`,
      rules: activeSheet.rules.map((rule) => hydrateTagScoreRule(rule)),
      filter: activeSheet.filter,
      categoryChecks: { ...activeSheet.categoryChecks },
    };
    setSheets((current) => [...current, nextSheet]);
    setActiveSheetId(nextSheet.id);
  };
  const deleteSheet = () => {
    if (sheets.length <= 1) {
      return;
    }

    const sheetIndex = sheets.findIndex((sheet) => sheet.id === activeSheet.id);
    const nextSheets = sheets.filter((sheet) => sheet.id !== activeSheet.id);
    const nextSheet = nextSheets[Math.max(0, Math.min(sheetIndex, nextSheets.length - 1))];
    if (!nextSheet) {
      return;
    }

    setSheets(nextSheets);
    setActiveSheetId(nextSheet.id);
  };
  const applyAndClose = () => {
    runtime.setTagScoreRules(activeSheet.rules.map((rule) => hydrateTagScoreRule(rule)));
    onClose();
  };
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#05080dcc] px-6 py-6">
      <motion.div {...dialogPanelMotion} className="flex h-[min(780px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
              <ListChecks className="size-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-base font-normal leading-5 text-[var(--primary-text)]">이벤트별 NG 점수 상한 설정</h4>
            </div>
          </div>
          <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]" aria-label="닫기">
            <X className="size-4" />
          </motion.button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <TaggingScoreCutBody
            key={activeSheet.id}
            rules={activeSheet.rules}
            onRulesChange={(rules) => updateActiveSheet({ rules })}
            filter={activeSheet.filter}
            onFilterChange={(filter) => updateActiveSheet({ filter })}
            categoryChecks={activeSheet.categoryChecks}
            onCategoryChecksChange={(categoryChecks) => updateActiveSheet({ categoryChecks })}
            sheets={sheets.map((sheet) => ({ id: sheet.id, label: sheet.label }))}
            activeSheetId={activeSheet.id}
            onSelectSheet={setActiveSheetId}
            onCreateSheet={createSheet}
            onDeleteSheet={deleteSheet}
            onApply={applyAndClose}
            onCancel={onClose}
          />
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function TaggingScoreCutBody({
  rules,
  onRulesChange,
  filter,
  onFilterChange,
  categoryChecks,
  onCategoryChecksChange,
  sheets,
  activeSheetId,
  onSelectSheet,
  onCreateSheet,
  onDeleteSheet,
  onApply,
  onCancel,
}: {
  rules: TagScoreRule[];
  onRulesChange: (rules: TagScoreRule[]) => void;
  filter: TagRuleFilter;
  onFilterChange: (filter: TagRuleFilter) => void;
  categoryChecks: Record<string, boolean>;
  onCategoryChecksChange: (categoryChecks: Record<string, boolean>) => void;
  sheets: Array<{ id: string; label: string }>;
  activeSheetId: string;
  onSelectSheet: (sheetId: string) => void;
  onCreateSheet: () => void;
  onDeleteSheet: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [queryColumns, setQueryColumns] = useState<string[]>([]);
  const [bulkEdit, setBulkEdit] = useState(false);
  const [checkedRows, setCheckedRows] = useState<Record<string, boolean>>(() => Object.fromEntries(rules.map((rule) => [ruleRowId(rule), true])));
  const updateRules = (updater: (current: TagScoreRule[]) => TagScoreRule[]) => onRulesChange(updater(rules).map((rule) => hydrateTagScoreRule(rule)));
  const orderedRules = useMemo(
    () =>
      [...rules].sort((left, right) => {
        if (left.isPriority && right.isPriority) {
          return (left.priorityOrder ?? 0) - (right.priorityOrder ?? 0) || left.id - right.id;
        }
        if (left.isPriority) {
          return -1;
        }
        if (right.isPriority) {
          return 1;
        }
        return left.id - right.id;
      }),
    [rules],
  );
  const categoryOptions = useMemo(() => Array.from(new Set(orderedRules.map((rule) => rule.category || "-"))).sort((left, right) => left.localeCompare(right, "ko")), [orderedRules]);
  const categoryEnabled = (category: string) => categoryChecks[category] !== false;
  const setAllCategories = (checked: boolean) => {
    onCategoryChecksChange(Object.fromEntries(categoryOptions.map((category) => [category, checked])));
  };
  const selectCategory = (category: string) => {
    const onlySelected = categoryOptions.every((option) => categoryChecks[option] === (option === category));
    onCategoryChecksChange(onlySelected ? Object.fromEntries(categoryOptions.map((option) => [option, true])) : Object.fromEntries(categoryOptions.map((option) => [option, option === category])));
  };
  const filteredRules = useMemo(
    () =>
      orderedRules.filter((rule) => {
        if (!categoryEnabled(rule.category || "-")) {
          return false;
        }
        if (filter === "active" && !rule.isAutoApplied) {
          return false;
        }
        if (filter === "inactive" && rule.isAutoApplied) {
          return false;
        }

        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) {
          return true;
        }

        const searchTargets: Record<string, string> = {
          selectedTag: `${rule.displayLabel} ${rule.label}`,
          category: rule.category || "-",
          description: rule.description || "-",
        };
        const columns = queryColumns.length > 0 ? queryColumns : Object.keys(searchTargets);
        return columns.some((column) => searchTargets[column]?.toLocaleLowerCase().includes(normalizedQuery));
      }),
    [categoryChecks, filter, orderedRules, query, queryColumns],
  );
  const activeCount = orderedRules.filter((rule) => rule.isAutoApplied).length;
  const inactiveCount = orderedRules.length - activeCount;
  const visibleRuleIds = useMemo(() => new Set(filteredRules.map((rule) => ruleRowId(rule))), [filteredRules]);
  const visibleCheckedRuleIds = useMemo(() => new Set(filteredRules.filter((rule) => checkedRows[ruleRowId(rule)] === true).map((rule) => ruleRowId(rule))), [checkedRows, filteredRules]);
  const selectedCount = visibleCheckedRuleIds.size;
  const rowChecks = useMemo(() => Object.fromEntries(filteredRules.map((rule) => [ruleRowId(rule), checkedRows[ruleRowId(rule)] === true])), [checkedRows, filteredRules]);
  const ruleById = useMemo(() => new Map(filteredRules.map((rule) => [ruleRowId(rule), rule])), [filteredRules]);
  const updateCutoff = (rowId: string, cutoffScore: number, source: "input" | "step" = "input") => {
    updateRules((current) => {
      const target = current.find((rule) => ruleRowId(rule) === rowId);
      const appliesBulk = bulkEdit && Boolean(target) && visibleCheckedRuleIds.has(rowId) && visibleCheckedRuleIds.size > 0;
      const delta = target ? clampTagCutoff(cutoffScore) - clampTagCutoff(target.cutoffScore) : 0;
      return current.map((rule) => {
        const currentRowId = ruleRowId(rule);
        if (appliesBulk && visibleCheckedRuleIds.has(currentRowId)) {
          return { ...rule, cutoffScore: source === "step" ? clampTagCutoff(rule.cutoffScore + delta) : clampTagCutoff(cutoffScore) };
        }
        return currentRowId === rowId ? { ...rule, cutoffScore: clampTagCutoff(cutoffScore) } : rule;
      });
    });
  };
  const updateAutoApplied = (rowId: string, isAutoApplied: boolean) => {
    updateRules((current) => {
      const appliesBulk = bulkEdit && visibleCheckedRuleIds.has(rowId) && visibleCheckedRuleIds.size > 0;
      return current.map((rule) => {
        const currentRowId = ruleRowId(rule);
        return (appliesBulk && visibleCheckedRuleIds.has(currentRowId)) || currentRowId === rowId ? { ...rule, isAutoApplied } : rule;
      });
    });
  };
  const resetCutoffs = () => {
    updateRules((current) => current.map((rule) => ({ ...rule, cutoffScore: defaultTagCutoffScore, isAutoApplied: isDefaultAutoApplied(rule.category, rule.label) })));
  };
  const table = useMemo(
    () => ({
      columns: [
        { key: "id", label: "번호" },
        { key: "selectedTag", label: "상황 태그" },
        { key: "category", label: "카테고리" },
        { key: "ngActive", label: "NG 적용" },
        { key: "ngCut", label: "NG 상한" },
        { key: "description", label: "설명" },
      ],
      rows: filteredRules.map((rule, index) => ({
        id: ruleRowId(rule),
        cells: {
          id: String(index + 1),
          selectedTag: rule.displayLabel,
          category: rule.category || "-",
          ngActive: rule.isAutoApplied ? "적용" : "비활성",
          ngCut: formatCutoffValue(rule.cutoffScore),
          description: rule.description || "-",
        },
      })),
    }),
    [filteredRules],
  );
  useEffect(() => {
    if (selectedCount === 0 && bulkEdit) {
      setBulkEdit(false);
    }
  }, [bulkEdit, selectedCount]);
  useEffect(() => {
    setCheckedRows((current) => ({
      ...Object.fromEntries(rules.map((rule) => [ruleRowId(rule), true])),
      ...current,
    }));
  }, [rules]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <div className="min-w-[280px] flex-1">
          <ColumnSearchField value={query} onChange={setQuery} options={tagRuleSearchOptions} selectedKeys={queryColumns} onSelectedKeysChange={setQueryColumns} ariaLabel="검색" />
        </div>
        <TagRuleStatCard icon={<Tags className="size-4" />} label="전체" value={orderedRules.length} tone="violet" />
        <TagRuleStatCard icon={<CircleCheck className="size-4" />} label="NG 적용" value={activeCount} tone="green" />
        <TagRuleStatCard icon={<CircleOff className="size-4" />} label="비활성" value={inactiveCount} tone="muted" />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <SegmentedTagRuleFilter value={filter} onChange={onFilterChange} />
        <div className="flex items-center gap-2">
          <motion.button type="button" whileTap={selectedCount === 0 ? undefined : tightPressTap} disabled={selectedCount === 0} onClick={() => setBulkEdit((current) => !current)} className={cn("wpf-button flex h-8 items-center gap-1.5 px-3 text-sm font-normal leading-5 disabled:opacity-45", bulkEdit && "border-[var(--accent-blue)]")}>
            <ListChecks className="size-3.5" />
            {bulkEdit ? "개별 수정" : "일괄 수정"}{selectedCount > 0 ? ` ${selectedCount}` : ""}
          </motion.button>
          <motion.button type="button" whileTap={tightPressTap} onClick={resetCutoffs} className="wpf-button flex h-8 items-center gap-1.5 px-3 text-sm font-normal leading-5">
            <RotateCcw className="size-3.5" />
            기본값 복원
          </motion.button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DataGrid
          table={table}
          sheets={sheets}
          activeSheetId={activeSheetId}
          onSelectSheet={onSelectSheet}
          onCreateSheet={onCreateSheet}
          onDeleteSheet={onDeleteSheet}
          fillRemainingColumnKey="description"
          rowChecks={rowChecks}
          onToggleRowCheck={(row) => setCheckedRows((current) => ({ ...current, [row.id]: current[row.id] !== true }))}
          onToggleAllRows={(checked) => setCheckedRows((current) => ({ ...current, ...Object.fromEntries(filteredRules.map((rule) => [ruleRowId(rule), checked])) }))}
          onToggleRowsCheck={(checked, rowIds) => setCheckedRows((current) => ({ ...current, ...Object.fromEntries(rowIds.filter((rowId) => visibleRuleIds.has(rowId)).map((rowId) => [rowId, checked])) }))}
          columnMenus={{
            category: (
              <TagCategoryColumnMenu
                categories={categoryOptions}
                categoryChecks={categoryChecks}
                onSelectCategory={selectCategory}
                onToggleAll={setAllCategories}
              />
            ),
          }}
          renderCell={(context) => (
            <TaggingScoreCutCell
              context={context}
              rule={ruleById.get(context.row.id)}
              bulkDisabled={bulkEdit && checkedRows[context.row.id] !== true}
              onUpdateAutoApplied={updateAutoApplied}
              onUpdateCutoff={updateCutoff}
            />
          )}
          emptyText="표시할 태그가 없습니다."
        />
      </div>
      <div className="mt-4 flex shrink-0 justify-end gap-3 border-t border-[var(--panel-stroke)] pt-4">
        <motion.button type="button" onClick={onCancel} whileTap={tightPressTap} className="wpf-button px-8 text-sm">취소</motion.button>
        <motion.button type="button" onClick={onApply} whileTap={tightPressTap} className="wpf-primary-button px-8 text-sm">적용</motion.button>
      </div>
    </div>
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

function SegmentedTagRuleFilter({ value, onChange }: { value: TagRuleFilter; onChange: (value: TagRuleFilter) => void }) {
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

function TagCategoryColumnMenu({
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

function TaggingScoreCutCell({ context, rule, bulkDisabled, onUpdateAutoApplied, onUpdateCutoff }: { context: CellRenderContext; rule?: TagScoreRule; bulkDisabled: boolean; onUpdateAutoApplied: (rowId: string, isAutoApplied: boolean) => void; onUpdateCutoff: (rowId: string, cutoffScore: number, source?: "input" | "step") => void }) {
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
    return <TagCutoffCell value={rule.cutoffScore} disabled={bulkDisabled} ariaLabel={`${rule.displayLabel} ${text.ngCut}`} onChange={(nextValue, source) => onUpdateCutoff(context.row.id, nextValue, source)} />;
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

function formatCutoffValue(value: number): string {
  return clampTagCutoff(value).toFixed(2);
}

function ruleRowId(rule: TagScoreRule): string {
  return String(rule.id);
}

function buildTagRuleCacheKey(rules: TagScoreRule[]): string {
  return rules.map((rule) => `${rule.id}:${rule.isAutoApplied ? 1 : 0}:${rule.cutoffScore}`).join("|");
}

export function TaggingSchemaBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("tagging");
  const audioSync = useWorkspaceAudioSync("tagging");
  const selectedRow = useMemo(() => state.table.rows.find((row) => row.id === state.selectedRowId) ?? state.table.rows[0], [state.selectedRowId, state.table.rows]);
  const frames = useMemo(() => parseFrameTagRows(selectedRow), [selectedRow]);
  const audioSyncReady = sameAudioPath(audioSync.audioPath, state.selectedAudioPath);
  const schemaCurrentTime = audioSyncReady ? audioSync.currentTime : 0;
  const schemaFocusRequestId = audioSyncReady ? audioSync.focusRequest?.id : undefined;
  const frameSetKey = useMemo(
    () => `${selectedRow?.id ?? "empty"}:${frames.length}:${frames[0]?.startSec ?? 0}:${frames[frames.length - 1]?.endSec ?? 0}`,
    [frames, selectedRow?.id],
  );

  if (!selectedRow) {
    return <EmptyPanel text={text.noSelectedFile} />;
  }

  if (frames.length === 0) {
    return <EmptyPanel text={text.noTagScores} />;
  }

  return <FrameTagList frames={frames} rules={runtime.tagScoreRules} currentTime={schemaCurrentTime} focusRequestId={schemaFocusRequestId} autoFocusEnabled={audioSyncReady} frameSetKey={frameSetKey} />;
}

function FrameTagList({
  frames,
  rules,
  currentTime,
  focusRequestId,
  autoFocusEnabled,
  frameSetKey,
}: {
  frames: FrameTagRow[];
  rules: TagScoreRule[];
  currentTime: number;
  focusRequestId?: number;
  autoFocusEnabled: boolean;
  frameSetKey: string;
}) {
  const scrollRef = useRef<ScrollWindowHandle | null>(null);
  const activeIndex = useMemo(() => findActiveFrameIndex(frames, currentTime), [currentTime, frames]);
  const lastFocusRequestRef = useRef<number | undefined>(undefined);
  const lastAutoFocusedIndexRef = useRef<number | undefined>(undefined);
  const lastFrameSetKeyRef = useRef<string | undefined>(undefined);
  const frameRevealRequestRef = useRef<FrameRevealRequest | undefined>(undefined);
  const rulesCacheKey = useMemo(() => buildTagRuleCacheKey(rules), [rules]);
  const frameCacheKey = useMemo(() => `${frames.length}:${frames[0]?.startSec ?? 0}:${frames[frames.length - 1]?.endSec ?? 0}`, [frames]);
  const classifyFrame = useMemo(() => createFrameTagRowClassifier(rules), [rules]);
  const seekFrame = useCallback((time: number) => requestWorkspaceAudioSeek("tagging", time), []);

  useEffect(() => () => clearFrameRevealRequest(frameRevealRequestRef.current), []);

  useLayoutEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    const frameSetChanged = frameSetKey !== lastFrameSetKeyRef.current;
    if (frameSetChanged) {
      lastFrameSetKeyRef.current = frameSetKey;
      clearFrameRevealRequest(frameRevealRequestRef.current);
      frameRevealRequestRef.current = undefined;
      lastAutoFocusedIndexRef.current = undefined;
      lastFocusRequestRef.current = focusRequestId;
    }

    if (activeIndex < 0) {
      return;
    }

    if (!autoFocusEnabled) {
      if (frameSetChanged) {
        scrollRef.current.scrollToIndex(0, "start");
        lastAutoFocusedIndexRef.current = 0;
      }
      return;
    }

    const requested = focusRequestId !== undefined && focusRequestId !== lastFocusRequestRef.current;
    const shouldAutoFocus = activeIndex !== lastAutoFocusedIndexRef.current;
    if (requested || shouldAutoFocus) {
      clearFrameRevealRequest(frameRevealRequestRef.current);
      frameRevealRequestRef.current = { index: activeIndex, timeoutIds: [] };
      scrollRef.current.scrollToIndex(activeIndex, "center");
      scheduleFrameReveal(frameRevealRequestRef.current, scrollRef);
    }
    if (requested) {
      lastFocusRequestRef.current = focusRequestId;
    }
    if (shouldAutoFocus) {
      lastAutoFocusedIndexRef.current = activeIndex;
    }
  }, [activeIndex, autoFocusEnabled, focusRequestId, frameSetKey]);

  return (
    <ScrollWindowViewport
      ref={scrollRef}
      itemCount={frames.length}
      itemSize={frameTagRowHeight}
      itemGap={frameTagRowGap}
      bufferScreens={frameTagBufferScreens}
      cacheKey={`${frameCacheKey}:${rulesCacheKey}`}
      className="px-1 py-1 pr-2"
      getItemKey={(index) => {
        const frame = frames[index];
        return `${frame.startSec}:${frame.endSec}`;
      }}
      resolveItem={(index) => classifyFrame(frames[index])}
      renderItem={({ index, item }) => {
        return (
          <FrameTagListRow
            frame={item as FrameTagDisplayRow}
            index={index}
            active={index === activeIndex}
            onSeek={seekFrame}
          />
        );
      }}
    />
  );
}

const FrameTagListRow = memo(forwardRef<HTMLButtonElement, { frame: FrameTagDisplayRow; index: number; active: boolean; onSeek: (time: number) => void }>(function FrameTagListRow({ frame, index, active, onSeek }, ref) {
  return (
    <motion.button
      ref={ref}
      type="button"
      data-frame-index={index}
      onClick={() => onSeek(frame.startSec)}
      whileTap={softPressTap}
      variants={timelineFocusItemVariants}
      animate={active ? "active" : "idle"}
      transition={timelineFocusTransition}
      aria-pressed={active}
      className={cn(
        "grid h-full w-full grid-cols-[92px_minmax(0,1fr)] gap-3 overflow-hidden rounded-[5px] border px-3 py-2 text-left transition-colors",
        active
          ? "border-[var(--nav-selected-bg)] bg-[rgba(124,77,255,.13)]"
          : "border-[var(--panel-stroke)] bg-[var(--field-bg)] hover:bg-[var(--soft-selection-hover)]",
      )}
    >
          <div className="text-[12px] leading-5 text-[var(--secondary-text)]">
            <div>{formatFrameTime(frame.startSec)}</div>
            <div>{formatFrameTime(frame.endSec)}</div>
          </div>
          <div className="flex min-w-0 flex-wrap content-start gap-1.5 overflow-hidden">
            {frame.tags.length > 0 ? frame.tags.map((tag) => (
              <span
                key={`${tag.label}-${tag.rank}`}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-[4px] border px-2 py-1 text-[12px] leading-none",
                  tag.isNg
                    ? "border-[#ff6b78]/70 bg-[#5b1b1b] text-[#ffb4b4]"
                    : "border-[var(--panel-stroke)] bg-[rgba(148,163,184,.10)] text-[var(--primary-text)]",
                )}
                title={`${tag.label} ${formatTagScore(tag.score)}`}
              >
                <span className="min-w-0 truncate">{tag.displayLabel}</span>
                <span className={cn("shrink-0", tag.isNg ? "text-[#ffd1d5]" : "text-[var(--secondary-text)]")}>{formatTagScore(tag.score)}</span>
              </span>
            )) : <span className="text-sm text-[var(--secondary-text)]">-</span>}
          </div>
        </motion.button>
  );
}));

function scheduleFrameReveal(
  request: FrameRevealRequest,
  scrollRef: RefObject<ScrollWindowHandle | null>,
): void {
  const delays = [0, 80, 180];
  for (const delay of delays) {
    const timeoutId = window.setTimeout(() => {
      scrollRef.current?.scrollToIndex(request.index, "center");
    }, delay);
    request.timeoutIds.push(timeoutId);
  }

  const cleanupId = window.setTimeout(() => {
    clearFrameRevealRequest(request);
  }, 260);
  request.timeoutIds.push(cleanupId);
}

function clearFrameRevealRequest(request: FrameRevealRequest | undefined): void {
  if (!request) {
    return;
  }

  for (const timeoutId of request.timeoutIds) {
    window.clearTimeout(timeoutId);
  }
  request.timeoutIds = [];
}

function findActiveFrameIndex(frames: FrameTagRow[], time: number): number {
  if (!Number.isFinite(time) || frames.length === 0) {
    return -1;
  }

  const epsilon = 0.000001;
  let low = 0;
  let high = frames.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const frame = frames[mid];
    if (frame.startSec <= time + epsilon) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate >= 0) {
    return candidate;
  }

  return time + epsilon >= frames[0].startSec ? 0 : -1;
}

function sameAudioPath(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeAudioPath(left);
  const normalizedRight = normalizeAudioPath(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizeAudioPath(path?: string): string {
  return path?.trim().replace(/\\/gu, "/").toLocaleLowerCase() ?? "";
}

function formatFrameTime(value: number): string {
  if (!Number.isFinite(value)) {
    return "00:00.000";
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

