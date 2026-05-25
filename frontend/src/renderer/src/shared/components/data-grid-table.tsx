import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Plus } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import type { DataTable, DataTableRow } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { checkPopMotion, tableEmptyMotion, tightPressTap } from "@/shared/motion";
import { ColumnResizeHandle, RowResizeHandle } from "./data-grid-resize-handles";
import { resolveRowLineClamp } from "./data-grid-sizing";
import {
  defaultCheckWidth,
  defaultHeaderHeight,
  defaultRowHeight,
  rowCheckStickyBaseClass,
  type CellRenderContext,
  type ColumnMenuState,
  type DataGridSheetTab,
} from "./data-grid-types";

type DataGridTableProps = {
  table: DataTable;
  sheets: DataGridSheetTab[];
  displaySheets: DataGridSheetTab[];
  displayActiveSheetId?: string;
  showSheetTabs: boolean;
  sheetToolbar?: ReactNode;
  selectedRowIds: string[];
  selectedRowSet: Set<string>;
  headerTargetRows: DataTableRow[];
  allChecked: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  rowRefs: RefObject<Record<string, HTMLTableRowElement | null>>;
  viewportWidth?: number;
  tableWidth: number;
  showsRowChecks: boolean;
  resolvedColumnWidths: Record<string, number>;
  columnMenus: Record<string, ReactNode>;
  columnMenu?: ColumnMenuState;
  windowRows: DataTableRow[];
  rowWindowRange: { start: number; end: number };
  pageRowHeights: number[];
  rowChecks?: Record<string, boolean>;
  renderCell?: (context: CellRenderContext) => ReactNode;
  emptyText: string;
  suppressNextRowClickRef: RefObject<boolean>;
  suppressNextRowClickTimerRef: RefObject<number | undefined>;
  onCreateSheet?: () => void;
  onSelectSheet?: (sheetId: string) => void;
  onSelectRow?: (row: DataTableRow, additive: boolean) => void;
  onToggleRowCheck?: (row: DataTableRow) => void;
  onToggleAllRows?: (checked: boolean) => void;
  onToggleRowsCheck?: (checked: boolean, rowIds: string[]) => void;
  openMenu: (event: ReactMouseEvent, rowIds: string[]) => void;
  handleRowWindowScroll: () => void;
  openColumnMenu: (event: ReactMouseEvent<HTMLButtonElement>, key: string) => void;
  resizeColumn: (column: DataTable["columns"][number], startClientX: number) => void;
  resizeRow: (rowId: string, startClientY: number) => void;
  autoFitColumn: (columnKey: string) => void;
  autoFitRows: () => void;
  suppressNextRowClick: () => void;
};

export function DataGridTable({
  table,
  sheets,
  displaySheets,
  displayActiveSheetId,
  showSheetTabs,
  sheetToolbar,
  selectedRowIds,
  selectedRowSet,
  headerTargetRows,
  allChecked,
  viewportRef,
  rowRefs,
  viewportWidth,
  tableWidth,
  showsRowChecks,
  resolvedColumnWidths,
  columnMenus,
  columnMenu,
  windowRows,
  rowWindowRange,
  pageRowHeights,
  rowChecks,
  renderCell,
  emptyText,
  suppressNextRowClickRef,
  suppressNextRowClickTimerRef,
  onCreateSheet,
  onSelectSheet,
  onSelectRow,
  onToggleRowCheck,
  onToggleAllRows,
  onToggleRowsCheck,
  openMenu,
  handleRowWindowScroll,
  openColumnMenu,
  resizeColumn,
  resizeRow,
  autoFitColumn,
  autoFitRows,
  suppressNextRowClick,
}: DataGridTableProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-transparent">
      {showSheetTabs ? (
        <div
          className="flex h-12 shrink-0 items-end justify-between gap-3 border-b border-[var(--table-header-bg)] bg-transparent px-4"
          data-app-tour-target="data-grid-sheets"
          onContextMenu={(event) => openMenu(event, [])}
        >
          <div className="flex min-w-0 items-end gap-5">
            {displaySheets.map((sheet) => {
              const active = sheet.id === displayActiveSheetId;
              const realSheet = sheets.some((item) => item.id === sheet.id);
              return (
                <MotionUnderlineTab
                  key={sheet.id}
                  label={sheet.label}
                  active={active}
                  onClick={() => onSelectSheet?.(sheet.id)}
                  onContextMenu={(event) => openMenu(event, [])}
                  disabled={!realSheet}
                  className="h-10 min-w-[76px] px-2"
                />
              );
            })}
            {onCreateSheet ? (
              <button type="button" onClick={onCreateSheet} className="mb-[9px] flex size-6 items-center justify-center text-[var(--secondary-text)] hover:text-[var(--primary-text)]" aria-label="새 시트">
                <Plus className="size-4" strokeWidth={1.7} />
              </button>
            ) : null}
          </div>
          {sheetToolbar ? <div className="mb-[7px] flex shrink-0 items-center gap-2">{sheetToolbar}</div> : null}
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className="scroll-window-viewport relative min-h-0 flex-1 overflow-auto"
        data-app-tour-target="data-grid-body"
        onContextMenu={(event) => openMenu(event, selectedRowIds)}
        onScroll={handleRowWindowScroll}
      >
        <table className="border-separate border-spacing-0 table-fixed text-left text-sm" style={{ width: viewportWidth ? Math.max(tableWidth, viewportWidth) : tableWidth, minWidth: "100%" }}>
          <colgroup>
            {showsRowChecks ? <col style={{ width: defaultCheckWidth }} /> : null}
            {table.columns.map((column) => (
              <col key={column.key} style={{ width: resolvedColumnWidths[column.key] }} />
            ))}
          </colgroup>
          <thead className="text-[var(--secondary-text)]">
            <tr className="bg-[var(--table-header-bg)]">
              {showsRowChecks ? (
                <th
                  className={cn(
                    rowCheckStickyBaseClass,
                    "top-0 z-50 h-10 border-b border-r border-[var(--table-header-bg)] bg-[var(--table-header-bg)] px-3 font-normal shadow-[1px_0_0_var(--table-header-bg)]",
                  )}
                  style={{ position: "sticky", left: 0, top: 0 }}
                >
                  <motion.button
                    type="button"
                    aria-label="보이는 행 전체 선택"
                    aria-pressed={allChecked}
                    whileTap={tightPressTap}
                    onClick={() => {
                      if (selectedRowSet.size > 1) {
                        onToggleRowsCheck?.(!allChecked, headerTargetRows.map((row) => row.id));
                        return;
                      }

                      onToggleAllRows?.(!allChecked);
                    }}
                    className={cn(
                      "flex size-[18px] items-center justify-center rounded-[3px] border border-[var(--secondary-text)]",
                      allChecked && "border-[var(--accent-blue)] bg-[var(--accent-blue)]",
                    )}
                  >
                    <AnimatePresence initial={false}>
                      {allChecked ? (
                        <motion.span {...checkPopMotion}>
                          <Check className="size-3 text-[var(--primary-text)]" strokeWidth={1.9} />
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  </motion.button>
                </th>
              ) : null}
              {table.columns.map((column) => (
                <th key={column.key} className="sticky top-0 z-30 border-b border-r border-[var(--table-header-bg)] bg-[var(--table-header-bg)] px-2 font-normal" style={{ height: defaultHeaderHeight }}>
                  <div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                    <div className="flex h-full min-w-0 items-center overflow-hidden text-ellipsis whitespace-nowrap leading-none">{column.label}</div>
                    {columnMenus[column.key] ? (
                      <button
                        type="button"
                        onClick={(event) => openColumnMenu(event, column.key)}
                        className={cn("flex size-6 items-center justify-center rounded-[3px] text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)]", columnMenu?.key === column.key && "bg-[var(--soft-selection-hover)] text-[var(--primary-text)]")}
                        aria-label={`${column.label} 필터`}
                      >
                        <ChevronRight className="size-3.5 rotate-90" strokeWidth={1.9} />
                      </button>
                    ) : null}
                  </div>
                  <ColumnResizeHandle onDragStart={(clientX) => resizeColumn(column, clientX)} onDoubleClick={() => autoFitColumn(column.key)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {windowRows.map((row, offset) => {
              const index = rowWindowRange.start + offset;
              const menuRowIds = selectedRowSet.has(row.id) && selectedRowSet.size > 0 ? Array.from(selectedRowSet) : [row.id];
              const rowHeight = pageRowHeights[index] ?? defaultRowHeight;
              const rowLineClamp = resolveRowLineClamp(rowHeight);
              return (
                <tr
                  key={row.id}
                  ref={(element) => {
                    rowRefs.current[row.id] = element;
                  }}
                  onContextMenu={(event) => openMenu(event, menuRowIds)}
                  onMouseDownCapture={(event) => {
                    const target = event.target;
                    if (target instanceof Element && (target.closest("[data-column-resize-handle]") || target.closest("[data-row-resize-handle]"))) {
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rect.bottom - event.clientY <= 5) {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressNextRowClick();
                      resizeRow(row.id, event.clientY);
                    }
                  }}
                  onClick={(event) => {
                    if (suppressNextRowClickRef.current) {
                      suppressNextRowClickRef.current = false;
                      if (suppressNextRowClickTimerRef.current !== undefined) {
                        window.clearTimeout(suppressNextRowClickTimerRef.current);
                        suppressNextRowClickTimerRef.current = undefined;
                      }
                      return;
                    }
                    onSelectRow?.(row, event.ctrlKey || event.metaKey);
                  }}
                  className={cn(
                    "border-t border-[var(--panel-stroke)] text-[var(--primary-text)]",
                    onSelectRow && "cursor-pointer hover:bg-[var(--table-row-hover)]",
                    selectedRowSet.has(row.id) && "bg-[var(--nav-selected-bg)] hover:bg-[var(--nav-selected-bg)]",
                  )}
                >
                  {showsRowChecks ? (
                    <td className={cn(rowCheckStickyBaseClass, "z-20 border-b border-r border-[var(--table-header-bg)] bg-[var(--table-header-bg)] px-3 shadow-[1px_0_0_var(--table-header-bg)]")} style={{ height: rowHeight }}>
                      <motion.button
                        type="button"
                        aria-label={`${row.cells.fileName || row.cells.file_name || row.id} 내보내기 선택`}
                        aria-pressed={rowChecks?.[row.id] !== false}
                        whileTap={tightPressTap}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleRowCheck?.(row);
                        }}
                        className={cn(
                          "flex size-[18px] items-center justify-center rounded-[3px] border border-[var(--secondary-text)]",
                          rowChecks?.[row.id] !== false && "border-[var(--accent-blue)] bg-[var(--accent-blue)]",
                        )}
                      >
                        <AnimatePresence initial={false}>
                          {rowChecks?.[row.id] !== false ? (
                            <motion.span {...checkPopMotion}>
                              <Check className="size-3 text-[var(--primary-text)]" strokeWidth={1.9} />
                            </motion.span>
                          ) : null}
                        </AnimatePresence>
                      </motion.button>
                      <RowResizeHandle
                        onDragStart={(clientY) => {
                          suppressNextRowClick();
                          resizeRow(row.id, clientY);
                        }}
                        onDoubleClick={autoFitRows}
                      />
                    </td>
                  ) : null}
                  {table.columns.map((column) => {
                    const value = row.cells[column.key] || "";
                    const customCell = renderCell?.({ row, column, value, rowLineClamp, selected: selectedRowSet.has(row.id), selectRow: () => onSelectRow?.(row, false) });
                    return (
                      <td key={column.key} className="relative border-b border-r border-[var(--table-header-bg)] px-2 align-middle" style={{ height: rowHeight }}>
                        {customCell ?? (
                          rowLineClamp <= 1 ? (
                            <div className="max-h-full overflow-hidden truncate whitespace-nowrap leading-5">{value || "-"}</div>
                          ) : (
                            <div className="max-h-full overflow-hidden break-words leading-5" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp }}>
                              {value || "-"}
                            </div>
                          )
                        )}
                        <ColumnResizeHandle onDragStart={(clientX) => resizeColumn(column, clientX)} onDoubleClick={() => autoFitColumn(column.key)} />
                        <RowResizeHandle
                          onDragStart={(clientY) => {
                            suppressNextRowClick();
                            resizeRow(row.id, clientY);
                          }}
                          onDoubleClick={autoFitRows}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <AnimatePresence initial={false}>
          {table.rows.length === 0 ? (
            <motion.div key="empty-table" {...tableEmptyMotion} className="pointer-events-none absolute inset-x-0 bottom-0 top-10 flex items-center justify-center px-4 text-center text-sm text-[var(--secondary-text)]">
              {emptyText}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
