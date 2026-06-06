import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pencil, Search, X } from "lucide-react";
import { motion } from "motion/react";
import type { DataTableRow } from "@shared/ipc";
import type { PersistedBatchReplaceState } from "@/app/app-persistence";
import { NumericField, SelectionCheck, SelectField } from "@/shared/components/controls";
import { DataGrid, type CellRenderContext } from "@/shared/components/data-grid";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { dialogPanelMotion, menuMotion, tightPressTap } from "@/shared/motion";
import {
  buildBatchReplaceMatch,
  escapeRegExp,
  rowFileNameForBatch,
  type BatchReplaceMatch,
  type BatchReplaceTextRange,
} from "./batch-transcript-replace-model";
type BatchReplaceMode = "bulk" | "single";
type BatchReplaceScopes = {
  visible: boolean;
  checked: boolean;
  displayed: boolean;
};

const batchReplaceTableSelectorClass = "w-[clamp(7.5rem,12vw,10.5rem)] min-w-0 shrink";

export function BatchTranscriptReplaceDialog({
  allRows,
  displayedRows,
  visibleRows,
  rowChecks,
  sheets,
  activeSheetId,
  defaultTimelineScoreThreshold,
  onSelectSheet,
  onApply,
  onClose,
  initialState,
  onStateChange,
}: {
  allRows: DataTableRow[];
  displayedRows: DataTableRow[];
  visibleRows: DataTableRow[];
  rowChecks: Record<string, boolean>;
  sheets: Array<{ id: string; label: string }>;
  activeSheetId?: string;
  defaultTimelineScoreThreshold: number;
  onSelectSheet: (sheetId: string) => void;
  onApply: (rowId: string, value: string) => void;
  onClose: () => void;
  initialState?: PersistedBatchReplaceState;
  onStateChange?: (state: PersistedBatchReplaceState) => void;
}) {
  const [mode, setMode] = useState<BatchReplaceMode>(() => initialState?.mode ?? "bulk");
  const [scopes, setScopes] = useState<BatchReplaceScopes>(() => initialState?.scopes ?? { visible: false, checked: false, displayed: true });
  const [query, setQuery] = useState(() => initialState?.query ?? "");
  const [replacement, setReplacement] = useState(() => initialState?.replacement ?? "");
  const [caseSensitive, setCaseSensitive] = useState(() => initialState?.caseSensitive ?? false);
  const [wholeWord, setWholeWord] = useState(() => initialState?.wholeWord ?? false);
  const [timelineScoreFilterEnabled, setTimelineScoreFilterEnabled] = useState(() => initialState?.timelineScoreFilterEnabled ?? false);
  const [timelineScoreThreshold, setTimelineScoreThreshold] = useState(() => {
    const persistedThreshold = initialState?.timelineScoreThreshold;
    return Math.max(0, persistedThreshold !== undefined && persistedThreshold >= 0 ? persistedThreshold : defaultTimelineScoreThreshold);
  });
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>(() => initialState?.selectedIds ?? {});
  const [pageSize, setPageSize] = useState<number>(() => initialState?.pageSize ?? 50);

  const scopedRows = useMemo(() => {
    const displayedIds = new Set(displayedRows.map((row) => row.id));
    const visibleIds = new Set(visibleRows.map((row) => row.id));
    return allRows.filter((row) => {
      if (scopes.displayed && !displayedIds.has(row.id)) {
        return false;
      }
      if (scopes.visible && !visibleIds.has(row.id)) {
        return false;
      }
      if (scopes.checked && rowChecks[row.id] === false) {
        return false;
      }
      return true;
    });
  }, [allRows, displayedRows, visibleRows, rowChecks, scopes]);
  const matches = useMemo(
    () =>
      scopedRows
        .map((row) =>
          buildBatchReplaceMatch(row, query, replacement, {
            caseSensitive,
            wholeWord,
            timelineScoreFilterEnabled,
            timelineScoreThreshold,
          }),
        )
        .filter((match): match is BatchReplaceMatch => Boolean(match)),
    [caseSensitive, query, replacement, scopedRows, timelineScoreFilterEnabled, timelineScoreThreshold, wholeWord],
  );
  const matchByRowId = useMemo(() => new Map(matches.map((match) => [match.row.id, match])), [matches]);
  const resultTable = useMemo(
    () => ({
      columns: [
        { key: "index", label: "ID" },
        { key: "fileName", label: "파일명" },
        { key: "preview", label: "미리보기" },
        { key: "action", label: "작업" },
      ],
      rows: matches.map((match) => ({
        id: match.row.id,
        cells: {
          index: match.row.cells.index || match.row.id,
          fileName: rowFileNameForBatch(match.row),
          preview: "미리보기",
          action: "작업",
        },
        sourcePath: match.row.sourcePath,
        raw: match.row.raw,
      })),
    }),
    [matches],
  );
  const activeIds = matches.filter((match) => selectedIds[match.row.id] !== false).map((match) => match.row.id);

  useEffect(() => {
    setSelectedIds((current) => ({
      ...Object.fromEntries(matches.map((match) => [match.row.id, current[match.row.id] !== false])),
    }));
  }, [matches]);
  useEffect(() => {
    setSelectedIds({});
  }, [activeSheetId, caseSensitive, query, replacement, scopes, timelineScoreFilterEnabled, timelineScoreThreshold, wholeWord]);

  useEffect(() => {
    onStateChange?.({
      mode,
      scopes,
      query,
      replacement,
      caseSensitive,
      wholeWord,
      timelineScoreFilterEnabled,
      timelineScoreThreshold,
      selectedIds,
      pageSize,
    });
  }, [caseSensitive, mode, onStateChange, query, replacement, scopes, selectedIds, timelineScoreFilterEnabled, timelineScoreThreshold, wholeWord, pageSize]);

  const applyRows = (rowIds: string[]) => {
    const targets = new Set(rowIds);
    for (const match of matches) {
      if (targets.has(match.row.id)) {
        onApply(match.row.id, match.after);
      }
    }
  };
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#05080dcc] px-6 py-6">
	      <motion.div {...dialogPanelMotion} data-app-tour-target="batch-replace-dialog" className="flex h-[min(780px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-4 shadow-[var(--app-dialog-shadow)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center">
            <h4 className="min-w-0 truncate text-base font-semibold leading-5 text-[var(--primary-text)]">내용 검색 및 바꾸기</h4>
          </div>
          <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="flex size-8 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]" aria-label="닫기">
            <X className="size-4" />
          </motion.button>
        </div>

	        <div className="grid min-h-0 flex-1 grid-cols-[322px_16px_minmax(0,1fr)]">
	          <div className="flex min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-transparent px-4 pb-0 pt-0">
	            <div className="-mx-4 border-b border-[var(--panel-stroke)] px-4 pt-[10px]">
	              <div className="grid grid-cols-2">
	                <BatchReplaceTab label="일괄 수정" active={mode === "bulk"} onClick={() => setMode("bulk")} />
                <BatchReplaceTab label="개별 수정" active={mode === "single"} onClick={() => setMode("single")} />
              </div>
            </div>
	            <div className="app-scrollbar app-scrollbar-tight min-h-0 flex-1 overflow-auto pt-4">
	              <div className="mb-5">
	                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">검색할 내용</p>
	                <div className="relative">
	                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--icon-brush)]" />
	                  <input className="wpf-field h-[38px] w-full px-9 text-sm outline-none" placeholder="검색할 내용을 입력하세요." value={query} onChange={(event) => setQuery(event.target.value)} />
	                </div>
	              </div>

	              <div className="mb-5">
	                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">바꿀 내용</p>
	                <input className="wpf-field h-[38px] w-full px-3 text-sm outline-none" placeholder="바꿀 내용을 입력하세요." value={replacement} onChange={(event) => setReplacement(event.target.value)} />
	              </div>

	              <div className="mb-5 border-t border-[var(--panel-stroke)] pt-3">
	                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">검색 범위</p>
	                <div className="space-y-3">
	                  <BatchReplaceCheckRow label="현재 화면" checked={scopes.visible} onChange={(checked) => setScopes((current) => ({ ...current, visible: checked }))} />
                  <BatchReplaceCheckRow label="체크된 행" checked={scopes.checked} onChange={(checked) => setScopes((current) => ({ ...current, checked }))} />
                  <BatchReplaceCheckRow label="표시 내용" checked={scopes.displayed} onChange={(checked) => setScopes((current) => ({ ...current, displayed: checked }))} />
                </div>
              </div>

		              <div className="border-t border-[var(--panel-stroke)] pt-3">
		                <p className="mb-3 text-sm font-normal text-[var(--primary-text)]">옵션</p>
		                <div className="space-y-3">
                  <BatchReplaceCheckRow label="대소문자 구분" checked={caseSensitive} onChange={setCaseSensitive} />
                  <BatchReplaceCheckRow label="전체 단어 일치" checked={wholeWord} onChange={setWholeWord} />
                  <BatchReplaceScoreFilterRow
                    label="타임라인 점수 이상"
                    value={timelineScoreThreshold}
                    enabled={timelineScoreFilterEnabled}
                    onValueChange={(value) => setTimelineScoreThreshold(Math.max(0, value))}
                    onEnabledChange={setTimelineScoreFilterEnabled}
                  />
                </div>
              </div>
            </div>
            <div className="-mx-4 mt-4 border-t border-[var(--panel-stroke)] px-4 py-4">
              <div className="grid grid-cols-[1fr_12px_1fr]">
            <motion.button type="button" className="wpf-primary-button text-sm font-normal" disabled={activeIds.length === 0} whileTap={activeIds.length === 0 ? undefined : tightPressTap} onClick={() => applyRows(activeIds)}>모두 바꾸기</motion.button>
                <div />
                <motion.button type="button" className="wpf-button text-sm font-normal" whileTap={tightPressTap} onClick={onClose}>취소</motion.button>
              </div>
            </div>
          </div>

          <div />

	          <div className="flex min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-transparent px-4 pb-0 pt-4">
	            <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
	              <div className="flex items-center gap-3">
	                <h5 className="text-base font-semibold leading-5 text-[var(--primary-text)]">검색 결과</h5>
	              </div>
                <div className="flex min-w-0 shrink items-center justify-end gap-2">
                  {sheets.length > 0 && (
                    <div className={batchReplaceTableSelectorClass}>
                      <SelectField
                        value={activeSheetId ?? ""}
                        options={sheets.map((s) => ({ value: s.id, label: s.label }))}
                        onChange={onSelectSheet}
                        ariaLabel="시트 선택"
                        dropdownClassName="z-[1300]"
                        density="header"
                      />
                    </div>
                  )}
                  <div className={batchReplaceTableSelectorClass}>
                    <SelectField
                      value={String(pageSize)}
                      options={[
                        { value: "10", label: "10개씩" },
                        { value: "20", label: "20개씩" },
                        { value: "50", label: "50개씩" },
                        { value: "100", label: "100개씩" },
                        { value: "200", label: "200개씩" },
                        { value: "500", label: "500개씩" },
                      ]}
                      onChange={(val) => setPageSize(Number(val))}
                      ariaLabel="표시 행 수"
                      dropdownClassName="z-[1300]"
                      density="header"
                    />
                  </div>
                </div>
	            </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden -mx-4">
                <DataGrid
                  table={resultTable}
                  sheets={sheets}
                  activeSheetId={activeSheetId}
                  fillRemainingColumnKey="preview"
                  onSelectSheet={onSelectSheet}
                  controlledPageSize={pageSize}
                  onPageSizeChange={setPageSize}
                  rowChecks={selectedIds}
                  onToggleRowCheck={(row) => setSelectedIds((current) => ({ ...current, [row.id]: current[row.id] === false }))}
                  onToggleAllRows={(checked) => setSelectedIds(Object.fromEntries(matches.map((match) => [match.row.id, checked])))}
                  onToggleRowsCheck={(checked, rowIds) => setSelectedIds((current) => ({ ...current, ...Object.fromEntries(rowIds.map((rowId) => [rowId, checked])) }))}
                  renderCell={(context) => (
                    <BatchReplaceResultCell
                      context={context}
                      match={matchByRowId.get(context.row.id)}
                      mode={mode}
                      query={query}
                      replacement={replacement}
                      caseSensitive={caseSensitive}
                      wholeWord={wholeWord}
                      onApply={applyRows}
                    />
                  )}
                  emptyText="검색 결과가 없습니다."
                />
              </div>
	          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function BatchReplaceTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <MotionUnderlineTab label={label} active={active} onClick={onClick} underlineId="batch-replace-mode-tabs" />
  );
}

function BatchReplaceCheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      whileTap={tightPressTap}
      className="group flex w-full min-w-0 items-center gap-2.5 text-left"
    >
      <SelectionCheck checked={checked} />
      <span className="min-w-0 whitespace-normal break-words text-[13px] leading-[18px] text-[var(--secondary-text)]">{label}</span>
    </motion.button>
  );
}

function BatchReplaceScoreFilterRow({
  label,
  value,
  enabled,
  onValueChange,
  onEnabledChange,
}: {
  label: string;
  value: number;
  enabled: boolean;
  onValueChange: (value: number) => void;
  onEnabledChange: (checked: boolean) => void;
}) {
  return (
    <div className="inline-grid max-w-full grid-cols-[minmax(0,max-content)_116px] items-stretch gap-3">
      <motion.button
        type="button"
        role="checkbox"
        aria-checked={enabled}
        onClick={() => onEnabledChange(!enabled)}
        whileTap={tightPressTap}
        className="group flex min-w-0 items-center gap-2.5 text-left"
      >
        <SelectionCheck checked={enabled} />
        <span className="min-w-0 whitespace-normal break-words text-[13px] leading-[18px] text-[var(--secondary-text)]">{label}</span>
      </motion.button>
      <NumericField value={value} min={0} step={0.01} onChange={onValueChange} ariaLabel={label} />
    </div>
  );
}

function BatchReplaceResultCell({
  context,
  match,
  mode,
  query,
  replacement,
  caseSensitive,
  wholeWord,
  onApply,
}: {
  context: CellRenderContext;
  match?: BatchReplaceMatch;
  mode: BatchReplaceMode;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  onApply: (rowIds: string[]) => void;
}) {
  const { column, value, row } = context;
  if (column.key === "fileName") {
    return <div className="truncate font-normal leading-5">{value || "-"}</div>;
  }

  if (column.key === "preview" && match) {
    return (
      <div className="my-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] p-3">
        <p className="mb-1 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">변경 전</p>
        <p className="line-clamp-2 text-sm leading-5">{highlightReplaceText(match.before, query, { caseSensitive, wholeWord, className: "text-[#ff8c96] font-normal", ranges: match.ranges })}</p>
        <div className="my-2 h-px bg-[var(--panel-stroke)]" />
        <p className="mb-1 text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">변경 후</p>
        <p className="line-clamp-2 text-sm leading-5">{highlightReplaceText(match.after, replacement, { caseSensitive, wholeWord: false, className: "text-[#8ee36f] font-normal" })}</p>
      </div>
    );
  }

  if (column.key === "action") {
    return (
      <motion.button type="button" whileTap={mode === "single" ? tightPressTap : undefined} className="mx-auto flex size-9 items-center justify-center rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] text-[var(--primary-text)] disabled:opacity-45" disabled={mode !== "single"} onClick={() => onApply([row.id])} aria-label="개별 적용">
        <Pencil className="size-4" strokeWidth={1.8} />
      </motion.button>
    );
  }

  return <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>;
}

function highlightReplaceText(text: string, pattern: string, options: { caseSensitive: boolean; wholeWord: boolean; className: string; ranges?: BatchReplaceTextRange[] }): ReactNode {
  const value = text || "-";
  if (options.ranges) {
    return highlightTextRanges(value, options.ranges, options.className);
  }

  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return value;
  }

  const flags = options.caseSensitive ? "g" : "gi";
  const source = options.wholeWord ? `\\b${escapeRegExp(trimmedPattern)}\\b` : escapeRegExp(trimmedPattern);
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch {
    return value;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(regex)) {
    const index = match.index ?? 0;
    const matchText = match[0];
    if (!matchText) {
      continue;
    }
    if (index > lastIndex) {
      parts.push(value.slice(lastIndex, index));
    }
    parts.push(
      <span key={`${index}-${matchText}`} className={options.className}>
        {matchText}
      </span>,
    );
    lastIndex = index + matchText.length;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts.length > 0 ? parts : value;
}

function highlightTextRanges(text: string, ranges: BatchReplaceTextRange[], className: string): ReactNode {
  if (ranges.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <span key={`${range.start}-${range.end}`} className={className}>
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}
