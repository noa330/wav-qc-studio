import { CircleCheck, CircleOff, ListChecks, RotateCcw, Tags, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ColumnSearchField } from "@/shared/components/column-search-field";
import { NumericField, ToggleSwitch } from "@/shared/components/controls";
import { DataGrid, type CellRenderContext } from "@/shared/components/data-grid";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSeparator } from "@/shared/components/dropdown-menu";
import { dialogPanelMotion, menuMotion, tightPressTap } from "@/shared/motion";
import {
  clampTagCutoff,
  defaultTagCutoffScore,
  hydrateTagScoreRule,
  isDefaultAutoApplied,
  type TagScoreRule,
} from "../../../model/pretrained-sed-tagging";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { formatCutoffValue, ruleRowId, SegmentedTagRuleFilter, TagCategoryColumnMenu, TaggingScoreCutCell, TagRuleStats, type TagRuleFilter } from "./TaggingScoreCutControls";
export { TaggingSchemaBody } from "./TaggingSchemaBody";

const text = {
  selectAllAuto: "\uc804\uccb4 \uc790\ub3d9 \uc801\uc6a9",
  autoApply: "\uc790\ub3d9 \uc801\uc6a9",
  priority: "\uc6b0\uc120 \uc801\uc6a9",
  selectedTag: "\uc120\ud0dd \ud0dc\uadf8",
  ngCut: "NG \ucef7",
  noSelectedFile: "\uc120\ud0dd\ub41c \ud30c\uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
  noTagScores: "\uc120\ud0dd\ub41c \ud30c\uc77c\uc758 \ud0dc\uadf8 \uc810\uc218\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.",
} as const;

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
      <motion.div {...dialogPanelMotion} data-app-tour-target="tagging-score-dialog" className="flex h-[min(780px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-5 shadow-2xl">
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
        <TagRuleStats total={orderedRules.length} active={activeCount} inactive={inactiveCount} />
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
