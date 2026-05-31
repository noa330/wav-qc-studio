import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { DataTable, DataTableRow } from "@shared/ipc";
import { SCROLL_WINDOW_BUFFER_SCREENS } from "@shared/scroll-window";

export type DataGridSheetTab = {
  id: string;
  label: string;
};

export type DuplicatePasteMode = "overwrite" | "skip";

export type GridMenuState = {
  x: number;
  y: number;
  rowIds: string[];
};

export type ColumnMenuState = {
  key: string;
  left: number;
  top: number;
  width: number;
};

export type DuplicateDialogState = {
  count: number;
};

export type RowRevealRequest = {
  requestId: number;
  rowId: string;
};

export type RowScrollAnchor = {
  rowId: string;
  offset: number;
  scrollTop: number;
  pageIndex: number;
  pageSize: number;
};

export type DataGridViewState = {
  pageSize?: number;
  pageIndex?: number;
  columnWidths?: Record<string, number>;
  autoFitColumns?: Record<string, boolean>;
  rowHeights?: Record<string, number>;
  autoFitRowsActive?: boolean;
};

export type CellRenderContext = {
  row: DataTableRow;
  column: DataTable["columns"][number];
  value: string;
  rowLineClamp: number;
  selected: boolean;
  selectRow: () => void;
};

export type DataGridProps = {
  table: DataTable;
  sheets?: DataGridSheetTab[];
  activeSheetId?: string;
  onSelectSheet?: (sheetId: string) => void;
  onCreateSheet?: () => void;
  onDeleteSheet?: () => void;
  selectedRowId?: string;
  selectedRowIds?: string[];
  selectedRowRevealRequestId?: number;
  onSelectRow?: (row: DataTableRow, additive: boolean) => void;
  onSelectRows?: (rowIds: string[]) => void;
  clipboardRows?: DataTableRow[];
  onCopyRows?: (rowIds: string[]) => void;
  onPasteRows?: (duplicateMode: DuplicatePasteMode) => void;
  rowChecks?: Record<string, boolean>;
  onToggleRowCheck?: (row: DataTableRow) => void;
  onToggleAllRows?: (checked: boolean) => void;
  onToggleRowsCheck?: (checked: boolean, rowIds: string[]) => void;
  columnMenus?: Record<string, ReactNode>;
  renderCell?: (context: CellRenderContext) => ReactNode;
  onVisibleRowsChange?: (rows: DataTableRow[]) => void;
  emptyText?: string;
  showPagination?: boolean;
  fillRemainingColumnKey?: string;
  viewState?: DataGridViewState;
  onViewStateChange?: (state: DataGridViewState) => void;
  suspendWidthTracking?: boolean;
  guideStepId?: string;
  /** footer 오른쪽 슬롯 — 위젯 버튼(필터, 검색·바꾸기 등) */
  footerWidget?: ReactNode;
  /** 외부에서 페이지 크기를 제어할 때 사용 (설정되면 내부 state보다 우선) */
  controlledPageSize?: number;
  /** controlledPageSize 변경 핸들러 */
  onPageSizeChange?: (size: number) => void;
};

export const defaultSheetTabs: DataGridSheetTab[] = [{ id: "default-sheet-1", label: "Sheet1" }];
export const defaultColumnWidth = 140;
export const minimumColumnWidth = 44;
export const defaultCellPaddingX = 8;
export const defaultCheckWidth = 48;
export const rowCheckStickyBaseClass = "sticky left-0 w-[48px] min-w-[48px] max-w-[48px] shrink-0";
export const defaultRowHeight = 42;
export const defaultHeaderHeight = 40;
export const gridRowWindowBufferScreens = SCROLL_WINDOW_BUFFER_SCREENS;

export type OpenGridMenuHandler = (event: ReactMouseEvent, rowIds: string[]) => void;
