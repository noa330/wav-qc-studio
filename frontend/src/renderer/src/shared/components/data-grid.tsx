import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import type { DataTable, DataTableRow } from "@shared/ipc";
import { SCROLL_WINDOW_BUFFER_SCREENS, resolveScrollWindowMetrics } from "@shared/scroll-window";
import { cn } from "@/lib/utils";
import { NumericField } from "@/shared/components/controls";
import { DropdownMenuSurface } from "@/shared/components/dropdown-menu";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { checkPopMotion, dialogPanelMotion, menuMotion, softPressTap, tableEmptyMotion, tightPressTap, uiSpring } from "@/shared/motion";
import { Check, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ClipboardPaste, Copy, MousePointer2, Plus } from "lucide-react";

type DataGridSheetTab = {
  id: string;
  label: string;
};

type DuplicatePasteMode = "overwrite" | "skip";

type GridMenuState = {
  x: number;
  y: number;
  rowIds: string[];
};

type ColumnMenuState = {
  key: string;
  left: number;
  top: number;
  width: number;
};

type DuplicateDialogState = {
  count: number;
};

type RowRevealRequest = {
  requestId: number;
  rowId: string;
};

type RowScrollAnchor = {
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

const defaultSheetTabs: DataGridSheetTab[] = [{ id: "default-sheet-1", label: "Sheet1" }];
const defaultColumnWidth = 140;
const minimumColumnWidth = 44;
const defaultCellPaddingX = 8;
const defaultCheckWidth = 48;
const rowCheckStickyBaseClass = "sticky left-0 w-[48px] min-w-[48px] max-w-[48px] shrink-0";
const defaultRowHeight = 42;
const defaultHeaderHeight = 40;
const gridRowWindowBufferScreens = SCROLL_WINDOW_BUFFER_SCREENS;

export function DataGrid({
  table,
  sheets = [],
  activeSheetId,
  onSelectSheet,
  onCreateSheet,
  selectedRowId,
  selectedRowIds = [],
  selectedRowRevealRequestId,
  onSelectRow,
  onSelectRows,
  clipboardRows = [],
  onCopyRows,
  onPasteRows,
  rowChecks,
  onToggleRowCheck,
  onToggleAllRows,
  onToggleRowsCheck,
  sheetToolbar,
  columnMenus = {},
  renderCell,
  onVisibleRowsChange,
  emptyText = "표시할 결과가 없습니다.",
  showSheetTabs = true,
  showPagination = true,
  fillRemainingColumnKey,
  viewState,
  onViewStateChange,
  suspendWidthTracking = false,
}: {
  table: DataTable;
  sheets?: DataGridSheetTab[];
  activeSheetId?: string;
  onSelectSheet?: (sheetId: string) => void;
  onCreateSheet?: () => void;
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
  sheetToolbar?: ReactNode;
  columnMenus?: Record<string, ReactNode>;
  renderCell?: (context: CellRenderContext) => ReactNode;
  onVisibleRowsChange?: (rows: DataTableRow[]) => void;
  emptyText?: string;
  showSheetTabs?: boolean;
  showPagination?: boolean;
  fillRemainingColumnKey?: string;
  viewState?: DataGridViewState;
  onViewStateChange?: (state: DataGridViewState) => void;
  suspendWidthTracking?: boolean;
}) {
  const [pageSize, setPageSize] = useState(() => Math.max(1, Math.trunc(viewState?.pageSize ?? 50)));
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, Math.trunc(viewState?.pageIndex ?? 0)));
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => viewState?.columnWidths ?? {});
  const [autoFitColumns, setAutoFitColumns] = useState<Record<string, boolean>>(() => viewState?.autoFitColumns ?? {});
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(() => viewState?.rowHeights ?? {});
  const [autoFitRowsActive, setAutoFitRowsActive] = useState(() => viewState?.autoFitRowsActive ?? false);
  const [menu, setMenu] = useState<GridMenuState | undefined>();
  const [columnMenu, setColumnMenu] = useState<ColumnMenuState | undefined>();
  const [duplicateDialog, setDuplicateDialog] = useState<DuplicateDialogState | undefined>();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const rowRevealRequestRef = useRef<RowRevealRequest | undefined>(undefined);
  const rowScrollAnchorRef = useRef<RowScrollAnchor | undefined>(undefined);
  const pendingViewportScrollTopRef = useRef<number | undefined>(undefined);
  const lastHandledSelectedRowRevealRef = useRef<number | undefined>(undefined);
  const gridInstanceId = useId();
  const suppressNextRowClickRef = useRef(false);
  const suppressNextRowClickTimerRef = useRef<number | undefined>(undefined);
  const [viewportWidth, setViewportWidth] = useState<number | undefined>();
  const [rowWindowViewport, setRowWindowViewport] = useState({ height: 0, scrollTop: 0 });
  const [rowWindowStart, setRowWindowStart] = useState(0);
  const [isColumnResizing, setIsColumnResizing] = useState(false);

  const showsRowChecks = Boolean(rowChecks && onToggleRowCheck);
  const selectedRowSet = useMemo(() => new Set(selectedRowIds.length > 0 ? selectedRowIds : selectedRowId ? [selectedRowId] : []), [selectedRowId, selectedRowIds]);
  const primarySelectedRowId = selectedRowId ?? selectedRowIds[0];
  const headerTargetRows = selectedRowSet.size > 1 ? table.rows.filter((row) => selectedRowSet.has(row.id)) : table.rows;
  const checkedCount = showsRowChecks ? headerTargetRows.filter((row) => rowChecks?.[row.id] !== false).length : 0;
  const allChecked = showsRowChecks && headerTargetRows.length > 0 && checkedCount === headerTargetRows.length;
  const displaySheets = sheets.length > 0 ? sheets : defaultSheetTabs;
  const displayActiveSheetId = activeSheetId ?? displaySheets[0]?.id;
  const safePageSize = showPagination ? Math.max(1, Math.trunc(pageSize || 1)) : Math.max(1, table.rows.length || 1);
  const pageCount = Math.max(1, Math.ceil(table.rows.length / safePageSize));
  const safePageIndex = showPagination ? Math.min(pageIndex, pageCount - 1) : 0;
  const pageRows = table.rows.slice(safePageIndex * safePageSize, safePageIndex * safePageSize + safePageSize);
  const resolvedColumnWidths = useMemo(() => resolveColumnWidths(table, columnWidths, columnMenus, showsRowChecks, viewportWidth, isColumnResizing, fillRemainingColumnKey), [table, columnWidths, columnMenus, showsRowChecks, viewportWidth, isColumnResizing, fillRemainingColumnKey]);
  const tableWidth = (showsRowChecks ? defaultCheckWidth : 0) + table.columns.reduce((total, column) => total + resolvedColumnWidths[column.key], 0);
  const pageRowHeights = useMemo(
    () =>
      pageRows.map((row) => {
        const selectedAutoHeight = selectedRowSet.has(row.id) ? estimateRowHeight(row, table, resolvedColumnWidths) : defaultRowHeight;
        return Math.max(rowHeights[row.id] ?? defaultRowHeight, selectedAutoHeight);
      }),
    [pageRows, resolvedColumnWidths, rowHeights, selectedRowSet, table],
  );
  const pageRowOffsets = useMemo(() => {
    const offsets = [0];
    for (const height of pageRowHeights) {
      offsets.push(offsets[offsets.length - 1] + height);
    }
    return offsets;
  }, [pageRowHeights]);
  const { chunkSize: rowWindowChunkSize, stepSize: rowWindowStepSize } = resolveScrollWindowMetrics({
    viewportExtent: rowWindowViewport.height - defaultHeaderHeight,
    itemExtent: defaultRowHeight,
    itemCount: pageRows.length,
    bufferScreens: gridRowWindowBufferScreens,
  });
  const maxRowWindowStart = Math.max(0, pageRows.length - rowWindowChunkSize);
  const rowWindowRange = useMemo(() => {
    const start = Math.min(rowWindowStart, maxRowWindowStart);
    return { start, end: Math.min(pageRows.length, start + rowWindowChunkSize) };
  }, [maxRowWindowStart, pageRows.length, rowWindowChunkSize, rowWindowStart]);
  const windowRows = pageRows.slice(rowWindowRange.start, rowWindowRange.end);

  useEffect(() => {
    onViewStateChange?.({
      pageSize,
      pageIndex,
      columnWidths,
      autoFitColumns,
      rowHeights,
      autoFitRowsActive,
    });
  }, [autoFitColumns, autoFitRowsActive, columnWidths, onViewStateChange, pageIndex, pageSize, rowHeights]);
  const captureRowScrollAnchor = useCallback(
    (scrollTop: number) => {
      if (windowRows.length === 0) {
        rowScrollAnchorRef.current = undefined;
        return;
      }

      const windowTop = pageRowOffsets[rowWindowRange.start] ?? 0;
      const viewportTop = Math.max(0, scrollTop);
      let anchorIndex = rowWindowRange.start;
      while (anchorIndex < rowWindowRange.end - 1 && (pageRowOffsets[anchorIndex + 1] ?? 0) - windowTop <= viewportTop) {
        anchorIndex += 1;
      }

      rowScrollAnchorRef.current = {
        rowId: pageRows[anchorIndex].id,
        offset: Math.max(0, viewportTop - ((pageRowOffsets[anchorIndex] ?? 0) - windowTop)),
        scrollTop,
        pageIndex: safePageIndex,
        pageSize: safePageSize,
      };
    },
    [pageRowOffsets, pageRows, rowWindowRange.end, rowWindowRange.start, safePageIndex, safePageSize, windowRows.length],
  );
  const updateRowWindowViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const nextHeight = viewport.clientHeight;
    const nextScrollTop = viewport.scrollTop;
    captureRowScrollAnchor(nextScrollTop);
    setRowWindowViewport((current) =>
      current.height === nextHeight && current.scrollTop === nextScrollTop
        ? current
        : { height: nextHeight, scrollTop: nextScrollTop },
    );
  }, [captureRowScrollAnchor]);

  const handleRowWindowScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const nextScrollTop = viewport.scrollTop;
    captureRowScrollAnchor(nextScrollTop);
    setRowWindowViewport((current) =>
      current.height === viewport.clientHeight && current.scrollTop === nextScrollTop
        ? current
        : { height: viewport.clientHeight, scrollTop: nextScrollTop },
    );

    const nearTop = nextScrollTop <= defaultRowHeight;
    const nearBottom = nextScrollTop + viewport.clientHeight >= viewport.scrollHeight - defaultRowHeight;
    if (nearBottom && rowWindowRange.end < pageRows.length) {
      const shift = Math.min(rowWindowStepSize, pageRows.length - rowWindowRange.end);
      const shiftedHeight = (pageRowOffsets[rowWindowRange.start + shift] ?? 0) - (pageRowOffsets[rowWindowRange.start] ?? 0);
      setRowWindowStart((current) => Math.min(maxRowWindowStart, current + shift));
      window.requestAnimationFrame(() => {
        viewport.scrollTop = Math.max(0, viewport.scrollTop - shiftedHeight);
        updateRowWindowViewport();
      });
      return;
    }

    if (nearTop && rowWindowRange.start > 0) {
      const shift = Math.min(rowWindowStepSize, rowWindowRange.start);
      const shiftedHeight = (pageRowOffsets[rowWindowRange.start] ?? 0) - (pageRowOffsets[rowWindowRange.start - shift] ?? 0);
      setRowWindowStart((current) => Math.max(0, current - shift));
      window.requestAnimationFrame(() => {
        viewport.scrollTop = Math.max(0, viewport.scrollTop + shiftedHeight);
        updateRowWindowViewport();
      });
    }
  }, [captureRowScrollAnchor, maxRowWindowStart, pageRowOffsets, pageRows.length, rowWindowRange.end, rowWindowRange.start, rowWindowStepSize, updateRowWindowViewport]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    setRowWindowStart((current) => Math.min(current, maxRowWindowStart));
  }, [maxRowWindowStart]);

  useEffect(() => {
    if (!primarySelectedRowId || selectedRowRevealRequestId === undefined || selectedRowRevealRequestId === lastHandledSelectedRowRevealRef.current) {
      return;
    }

    const selectedIndex = table.rows.findIndex((row) => row.id === primarySelectedRowId);
    if (selectedIndex < 0) {
      return;
    }

    lastHandledSelectedRowRevealRef.current = selectedRowRevealRequestId;
    rowRevealRequestRef.current = {
      requestId: selectedRowRevealRequestId,
      rowId: primarySelectedRowId,
    };
    const nextPageIndex = Math.floor(selectedIndex / safePageSize);
    setPageIndex((current) => {
      return current === nextPageIndex ? current : nextPageIndex;
    });
  }, [primarySelectedRowId, safePageSize, selectedRowRevealRequestId, table.rows]);

  useEffect(() => {
    if (!primarySelectedRowId) {
      return;
    }

    const rowElement = rowRefs.current[primarySelectedRowId];
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const request = rowRevealRequestRef.current;
    if (request && request.rowId === primarySelectedRowId && !rowElement) {
      const pageRowIndex = pageRows.findIndex((row) => row.id === primarySelectedRowId);
      if (pageRowIndex >= 0) {
        const nextWindowStart = Math.max(0, Math.min(maxRowWindowStart, pageRowIndex - Math.floor((rowWindowChunkSize - 1) / 2)));
        const windowTop = pageRowOffsets[nextWindowStart] ?? 0;
        const rowTop = pageRowOffsets[pageRowIndex] ?? pageRowIndex * defaultRowHeight;
        const rowHeight = pageRowHeights[pageRowIndex] ?? defaultRowHeight;
        setRowWindowStart(nextWindowStart);
        pendingViewportScrollTopRef.current = Math.max(0, rowTop - windowTop - (viewport.clientHeight - defaultHeaderHeight - rowHeight) / 2);
        rowRevealRequestRef.current = undefined;
      }
      return;
    }
    if (!rowElement) {
      return;
    }

    if (request && request.rowId === primarySelectedRowId) {
      scrollRowToViewportCenter(rowElement, viewport);
      updateRowWindowViewport();
      rowRevealRequestRef.current = undefined;
    }
  }, [maxRowWindowStart, pageRowHeights, pageRowOffsets, pageRows, primarySelectedRowId, rowWindowChunkSize, safePageIndex, updateRowWindowViewport]);

  useEffect(() => {
    onVisibleRowsChange?.(pageRows);
  }, [onVisibleRowsChange, pageRows]);

  useLayoutEffect(() => {
    updateRowWindowViewport();
  }, [pageRows.length, safePageIndex, updateRowWindowViewport]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const pendingScrollTop = pendingViewportScrollTopRef.current;
    const anchor = rowScrollAnchorRef.current;
    let targetScrollTop: number | undefined = pendingScrollTop;

    if (targetScrollTop === undefined && anchor && anchor.pageIndex === safePageIndex && anchor.pageSize === safePageSize) {
      const anchorIndex = pageRows.findIndex((row) => row.id === anchor.rowId);
      if (anchorIndex >= 0) {
        if (anchorIndex < rowWindowRange.start || anchorIndex >= rowWindowRange.end) {
          setRowWindowStart(Math.max(0, Math.min(maxRowWindowStart, anchorIndex - Math.floor((rowWindowChunkSize - 1) / 2))));
          return;
        }

        const windowTop = pageRowOffsets[rowWindowRange.start] ?? 0;
        const rowHeight = pageRowHeights[anchorIndex] ?? defaultRowHeight;
        targetScrollTop = (pageRowOffsets[anchorIndex] ?? 0) - windowTop + Math.min(anchor.offset, Math.max(0, rowHeight - 1));
      } else {
        targetScrollTop = anchor.scrollTop;
      }
    }

    if (targetScrollTop === undefined) {
      updateRowWindowViewport();
      return;
    }

    pendingViewportScrollTopRef.current = undefined;
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));
    if (Math.abs(viewport.scrollTop - nextScrollTop) > 1) {
      viewport.scrollTop = nextScrollTop;
    }

    captureRowScrollAnchor(viewport.scrollTop);
    setRowWindowViewport((current) =>
      current.height === viewport.clientHeight && current.scrollTop === viewport.scrollTop
        ? current
        : { height: viewport.clientHeight, scrollTop: viewport.scrollTop },
    );
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || suspendWidthTracking) {
      return;
    }

    let frameId = 0;
    const updateWidth = () => {
      frameId = 0;
      const nextWidth = Math.round(viewport.clientWidth || viewport.getBoundingClientRect().width);
      setViewportWidth((current) => (current === undefined || Math.abs(current - nextWidth) > 1 ? nextWidth : current));
    };
    const scheduleUpdateWidth = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(updateWidth);
    };

    scheduleUpdateWidth();
    const observer = new ResizeObserver(scheduleUpdateWidth);
    observer.observe(viewport);
    window.addEventListener("resize", scheduleUpdateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdateWidth);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [suspendWidthTracking, table.columns.length, table.rows.length]);

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      setMenu(undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(undefined);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  useEffect(() => {
    if (!columnMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && columnMenuRef.current?.contains(target)) {
        return;
      }
      setColumnMenu(undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setColumnMenu(undefined);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [columnMenu]);

  if (table.columns.length === 0) {
    return (
      <div className="flex h-full min-h-[150px] items-center justify-center rounded-[5px] border border-[var(--panel-stroke)] bg-transparent text-sm text-[var(--secondary-text)]">
        {emptyText}
      </div>
    );
  }

  const goToPage = (nextIndex: number) => {
    rowScrollAnchorRef.current = undefined;
    pendingViewportScrollTopRef.current = 0;
    setRowWindowStart(0);
    setPageIndex(Math.max(0, Math.min(pageCount - 1, nextIndex)));
  };
  const selectedMenuRowIds = menu?.rowIds ?? [];

  const openMenu = (event: ReactMouseEvent, rowIds: string[]) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, rowIds });
  };

  const copyMenuRows = () => {
    if (selectedMenuRowIds.length > 0) {
      onCopyRows?.(selectedMenuRowIds);
    }
    setMenu(undefined);
  };

  const pasteRows = (mode: DuplicatePasteMode) => {
    onPasteRows?.(mode);
    setDuplicateDialog(undefined);
    setMenu(undefined);
  };

  const suppressNextRowClick = () => {
    suppressNextRowClickRef.current = true;
    if (suppressNextRowClickTimerRef.current !== undefined) {
      window.clearTimeout(suppressNextRowClickTimerRef.current);
    }
    suppressNextRowClickTimerRef.current = window.setTimeout(() => {
      suppressNextRowClickRef.current = false;
      suppressNextRowClickTimerRef.current = undefined;
    }, 350);
  };

  const requestPaste = () => {
    const duplicateCount = countDuplicateRows(table.rows, clipboardRows);
    if (duplicateCount > 0) {
      setDuplicateDialog({ count: duplicateCount });
      return;
    }

    pasteRows("overwrite");
  };

  const resizeColumn = (column: DataTable["columns"][number], startClientX: number) => {
    const frozenWidths = Object.fromEntries(
      table.columns.map((item) => [item.key, Math.max(minimumColumnWidth, resolvedColumnWidths[item.key] ?? defaultColumnWidth)]),
    );
    const startWidth = frozenWidths[column.key] ?? defaultColumnWidth;
    let moved = false;
    setColumnWidths(frozenWidths);
    setIsColumnResizing(true);
    const handleMove = (event: MouseEvent) => {
      if (!moved) {
        moved = true;
        setAutoFitColumns((current) => omitKey(current, column.key));
      }
      setColumnWidths((current) => ({
        ...current,
        [column.key]: Math.max(minimumColumnWidth, startWidth + event.clientX - startClientX),
      }));
    };
    const handleUp = () => {
      setIsColumnResizing(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const resizeRow = (rowId: string, startClientY: number) => {
    const startHeight = rowHeights[rowId] ?? defaultRowHeight;
    let moved = false;
    const handleMove = (event: MouseEvent) => {
      if (!moved) {
        moved = true;
        setAutoFitRowsActive(false);
      }
      setRowHeights((current) => ({
        ...current,
        [rowId]: Math.max(28, startHeight + event.clientY - startClientY),
      }));
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      suppressNextRowClick();
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const autoFitColumn = (columnKey: string) => {
    if (autoFitColumns[columnKey]) {
      setColumnWidths((current) => ({
        ...current,
        [columnKey]: defaultColumnWidth,
      }));
      setAutoFitColumns((current) => omitKey(current, columnKey));
      return;
    }

    const column = table.columns.find((item) => item.key === columnKey);
    if (!column) {
      return;
    }
    setColumnWidths((current) => ({
      ...current,
      [columnKey]: estimateFullColumnWidth(table, column),
    }));
    setAutoFitColumns((current) => ({ ...current, [columnKey]: true }));
  };

  const openColumnMenu = (event: ReactMouseEvent<HTMLButtonElement>, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setColumnMenu((current) =>
      current?.key === key
        ? undefined
        : {
            key,
            left: Math.min(Math.max(12, rect.left - 168), Math.max(12, window.innerWidth - 240 - 12)),
            top: Math.min(rect.bottom + 6, window.innerHeight - 260),
            width: 240,
          },
    );
  };

  const autoFitRows = () => {
    if (autoFitRowsActive) {
      setRowHeights({});
      setAutoFitRowsActive(false);
      return;
    }

    setRowHeights(Object.fromEntries(table.rows.map((row) => [row.id, estimateRowHeight(row, table, resolvedColumnWidths)])));
    setAutoFitRowsActive(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-transparent">
      {showSheetTabs ? <div className="flex h-12 shrink-0 items-end justify-between gap-3 border-b border-[var(--table-header-bg)] bg-transparent px-4" onContextMenu={(event) => openMenu(event, [])}>
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
      </div> : null}

      <div
        ref={viewportRef}
        className="scroll-window-viewport relative min-h-0 flex-1 overflow-auto"
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
                <th className={cn(
                    rowCheckStickyBaseClass,
                    "top-0 z-50 h-10 border-b border-r border-[var(--table-header-bg)] bg-[var(--table-header-bg)] px-3 font-normal shadow-[1px_0_0_var(--table-header-bg)]",
                  )}
                  style={{ position: "sticky", left: 0, top: 0 }}>
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
                    <AnimatePresence initial={false}>{allChecked ? <motion.span {...checkPopMotion}><Check className="size-3 text-[var(--primary-text)]" strokeWidth={1.9} /></motion.span> : null}</AnimatePresence>
                  </motion.button>
                </th>
              ) : null}
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  className="sticky top-0 z-30 border-b border-r border-[var(--table-header-bg)] bg-[var(--table-header-bg)] px-2 font-normal"
                  style={{ height: defaultHeaderHeight }}
                >
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
                  <ColumnResizeHandle
                    onDragStart={(clientX) => resizeColumn(column, clientX)}
                    onDoubleClick={() => autoFitColumn(column.key)}
                  />
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
                        <AnimatePresence initial={false}>{rowChecks?.[row.id] !== false ? <motion.span {...checkPopMotion}><Check className="size-3 text-[var(--primary-text)]" strokeWidth={1.9} /></motion.span> : null}</AnimatePresence>
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
                          <div
                            className="max-h-full overflow-hidden break-words leading-5"
                            style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: rowLineClamp }}
                          >
                            {value || "-"}
                          </div>
                        )
                      )}
                      <ColumnResizeHandle
                        onDragStart={(clientX) => resizeColumn(column, clientX)}
                        onDoubleClick={() => autoFitColumn(column.key)}
                      />
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

      {showPagination ? (
        <GridFooter
          instanceId={gridInstanceId}
          totalRows={table.rows.length}
          pageSize={safePageSize}
          pageIndex={safePageIndex}
          pageCount={pageCount}
          onPageSizeChange={(value) => {
            const nextSize = Math.max(1, Math.trunc(value));
            rowScrollAnchorRef.current = undefined;
            pendingViewportScrollTopRef.current = 0;
            setRowWindowStart(0);
            setPageSize(nextSize);
            setPageIndex(0);
          }}
          onPageChange={goToPage}
        />
      ) : null}

      {menu ? (
        <GridContextMenu
          refEl={menuRef}
          menu={menu}
          canCopy={selectedMenuRowIds.length > 0}
          canPaste={clipboardRows.length > 0}
          onNewSheet={onCreateSheet ? () => {
            onCreateSheet();
            setMenu(undefined);
          } : undefined}
          onCopy={copyMenuRows}
          onPaste={requestPaste}
          onSelectAll={() => {
            onSelectRows?.(table.rows.map((row) => row.id));
            setMenu(undefined);
          }}
        />
      ) : null}

      {columnMenu ? (
        <ColumnFilterMenu
          refEl={columnMenuRef}
          menu={columnMenu}
        >
          {columnMenus[columnMenu.key]}
        </ColumnFilterMenu>
      ) : null}

      {duplicateDialog ? (
        <DuplicatePasteDialog
          count={duplicateDialog.count}
          onOverwrite={() => pasteRows("overwrite")}
          onSkip={() => pasteRows("skip")}
          onClose={() => setDuplicateDialog(undefined)}
        />
      ) : null}
    </div>
  );
}

function ColumnResizeHandle({ onDragStart, onDoubleClick }: { onDragStart: (clientX: number) => void; onDoubleClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="열 너비 조절"
      data-column-resize-handle
      className="absolute bottom-0 right-0 top-0 z-20 w-2 cursor-col-resize bg-transparent"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail > 1) {
          return;
        }
        onDragStart(event.clientX);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    />
  );
}

function RowResizeHandle({ onDragStart, onDoubleClick }: { onDragStart: (clientY: number) => void; onDoubleClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="행 높이 조절"
      data-row-resize-handle
      className="absolute bottom-[-4px] left-0 right-0 z-30 h-2 cursor-row-resize bg-transparent"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail > 1) {
          return;
        }
        onDragStart(event.clientY);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClick();
      }}
    />
  );
}

export function GridFooter({
  instanceId = "grid-footer",
  totalRows,
  pageSize,
  pageIndex,
  pageCount,
  onPageSizeChange,
  onPageChange,
}: {
  instanceId?: string;
  totalRows: number;
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  onPageSizeChange: (value: number) => void;
  onPageChange: (index: number) => void;
}) {
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const pageNumbers = buildPageNumbers(pageIndex, pageCount);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const updateCompact = () => {
      setCompact(footer.getBoundingClientRect().width < 430);
    };
    updateCompact();
    const observer = new ResizeObserver(updateCompact);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={footerRef}
      className={cn(
        "mt-2 grid shrink-0 items-center gap-x-3 px-4 text-[13px] text-[var(--secondary-text)]",
        compact ? "h-[76px] grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[38px_38px]" : "h-[38px] grid-cols-[auto_minmax(0,1fr)_auto]",
      )}
    >
      <div className={cn("grid grid-cols-[auto_82px] items-center gap-2", compact && "col-start-1 row-start-1")}>
        <span>페이지당</span>
        <NumericField value={pageSize} min={1} step={1} wheelStep={1} ariaLabel="페이지당 행 수" onChange={onPageSizeChange} />
      </div>
      <div className={cn("flex min-w-0 items-center justify-center gap-2 overflow-hidden", compact && "col-span-3 col-start-1 row-start-2")}>
        <FooterButton disabled={pageIndex === 0} onClick={() => onPageChange(0)} label="처음">
          <ChevronFirst className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
        <FooterButton disabled={pageIndex === 0} onClick={() => onPageChange(pageIndex - 1)} label="이전">
          <ChevronLeft className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
        {pageNumbers.map((page, index) => page === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="flex h-7 min-w-7 items-center justify-center text-[13px] text-[var(--secondary-text)]">...</span>
        ) : (
          <motion.button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            whileTap={tightPressTap}
            className={cn(
              "relative flex h-7 min-w-7 items-center justify-center overflow-hidden rounded-[3px] px-2 text-[13px] font-medium text-[var(--primary-text)]",
              page === pageIndex ? "bg-[var(--accent-blue)]" : "bg-transparent hover:text-[var(--primary-text)]",
            )}
          >
            {page === pageIndex ? <motion.span layoutId={`grid-active-page-${instanceId}`} transition={uiSpring} className="absolute inset-0 rounded-[3px] bg-[var(--accent-blue)]" /> : null}
            <span className="relative z-10">
            {page + 1}
            </span>
          </motion.button>
        ))}
        <FooterButton disabled={pageIndex >= pageCount - 1} onClick={() => onPageChange(pageIndex + 1)} label="다음">
          <ChevronRight className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
        <FooterButton disabled={pageIndex >= pageCount - 1} onClick={() => onPageChange(pageCount - 1)} label="끝">
          <ChevronLast className="size-[18px]" strokeWidth={1.9} />
        </FooterButton>
      </div>
      <div className={cn("justify-self-end whitespace-nowrap", compact && "col-start-3 row-start-1")}>전체 {totalRows}개 행</div>
    </div>
  );
}

function ColumnFilterMenu({ refEl, menu, children }: { refEl: RefObject<HTMLDivElement | null>; menu: ColumnMenuState; children: ReactNode }) {
  return createPortal(
    <DropdownMenuSurface
      ref={refEl}
      className="z-[1300]"
      style={{ left: menu.left, top: menu.top, width: menu.width, maxHeight: 320 }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </DropdownMenuSurface>,
    document.body,
  );
}

function FooterButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      className="flex size-7 items-center justify-center rounded-[3px] bg-transparent text-[13px] text-[var(--primary-text)] hover:text-[var(--primary-text)] disabled:text-[var(--secondary-text)] disabled:opacity-45"
    >
      {children}
    </motion.button>
  );
}

function GridContextMenu({
  refEl,
  menu,
  canCopy,
  canPaste,
  onNewSheet,
  onCopy,
  onPaste,
  onSelectAll,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  menu: GridMenuState;
  canCopy: boolean;
  canPaste: boolean;
  onNewSheet?: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
}) {
  return createPortal(
    <motion.div
      ref={refEl}
      {...menuMotion}
      className="fixed z-[1100] min-w-[180px] rounded-[4px] border border-[var(--panel-stroke)] bg-[var(--field-bg)] py-1 text-sm shadow-[0_14px_32px_rgba(0,0,0,.34)]"
      style={{ left: menu.x, top: menu.y }}
    >
      {onNewSheet ? <MenuItem icon={<Plus className="size-4" />} label="새 시트" onClick={onNewSheet} /> : null}
      <MenuItem icon={<Copy className="size-4" />} label="복사" disabled={!canCopy} onClick={onCopy} />
      <MenuItem icon={<ClipboardPaste className="size-4" />} label="붙여넣기" disabled={!canPaste} onClick={onPaste} />
      <div className="my-1 h-px bg-[var(--panel-stroke)]" />
      <MenuItem icon={<MousePointer2 className="size-4" />} label="전체 선택" onClick={onSelectAll} />
    </motion.div>,
    document.body,
  );
}

function MenuItem({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : softPressTap}
      className={cn(
        "grid h-9 w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2 px-3 text-left text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]",
        disabled && "text-[var(--secondary-text)] opacity-55 hover:bg-transparent",
      )}
    >
      {icon}
      <span>{label}</span>
    </motion.button>
  );
}

function DuplicatePasteDialog({ count, onOverwrite, onSkip, onClose }: { count: number; onOverwrite: () => void; onSkip: () => void; onClose: () => void }) {
  const [applyAll, setApplyAll] = useState(true);
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 px-4">
      <motion.div {...dialogPanelMotion} className="w-[430px] rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--shell-chrome-card-bg)] p-4 shadow-[0_18px_44px_rgba(0,0,0,.45)]">
        <h4 className="text-base font-normal text-[var(--primary-text)]">같은 오디오가 있습니다</h4>
        <p className="mt-3 text-sm leading-5 text-[var(--secondary-text)]">같은 경로의 오디오 {count}개가 현재 시트에 이미 있습니다. 붙여넣을 행으로 덮어쓰거나 기존 행을 유지하고 건너뛸 수 있습니다.</p>
        <label className="mt-4 flex items-center gap-2 text-sm text-[var(--primary-text)]">
          <input type="checkbox" checked={applyAll} onChange={(event) => setApplyAll(event.target.checked)} />
          같은 충돌에 이 선택 계속 적용
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="wpf-button px-4 text-sm" onClick={onClose}>취소</button>
          <button type="button" className="wpf-button px-4 text-sm" onClick={() => (applyAll ? onSkip() : onSkip())}>건너뛰기</button>
          <button type="button" className="wpf-primary-button px-4 text-sm" onClick={() => (applyAll ? onOverwrite() : onOverwrite())}>덮어쓰기</button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function buildPageNumbers(pageIndex: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  if (pageIndex < 5) {
    return [0, 1, 2, 3, 4, "ellipsis", pageCount - 1];
  }

  if (pageIndex > pageCount - 6) {
    return [0, "ellipsis", pageCount - 5, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1];
  }

  return [0, "ellipsis", pageIndex - 1, pageIndex, pageIndex + 1, "ellipsis", pageCount - 1];
}

function countDuplicateRows(targetRows: DataTableRow[], clipboardRows: DataTableRow[]): number {
  const targetKeys = new Set(targetRows.map(rowDuplicateKey).filter(Boolean));
  return clipboardRows.filter((row) => targetKeys.has(rowDuplicateKey(row))).length;
}

function rowDuplicateKey(row: DataTableRow): string {
  const raw = row.raw ?? {};
  return normalizeKey(raw.originalPath || raw.original_path || raw.absolute_path || raw.inputPath || raw.input_path || row.sourcePath || row.cells.fileName || row.cells.file_name || row.id);
}

function normalizeKey(value: string | undefined): string {
  return (value ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}

function scrollRowToViewportCenter(rowElement: HTMLTableRowElement | null | undefined, viewport: HTMLDivElement | null | undefined): void;
function scrollRowToViewportCenter(rowId: string, rowElement: HTMLTableRowElement | null | undefined, viewport: HTMLDivElement | null | undefined): void;
function scrollRowToViewportCenter(
  _rowIdOrElement: string | HTMLTableRowElement | null | undefined,
  rowElementOrViewport: HTMLTableRowElement | HTMLDivElement | null | undefined,
  maybeViewport?: HTMLDivElement | null,
): void {
  const rowElement = typeof _rowIdOrElement === "string" ? rowElementOrViewport as HTMLTableRowElement | null | undefined : _rowIdOrElement;
  const viewport = typeof _rowIdOrElement === "string" ? maybeViewport : rowElementOrViewport as HTMLDivElement | null | undefined;
  if (!rowElement || !viewport) {
    return;
  }

  const rowRect = rowElement.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const visibleHeight = Math.max(rowRect.height, viewport.clientHeight - defaultHeaderHeight);
  const targetTop = viewport.scrollTop + rowRect.top - viewportRect.top - defaultHeaderHeight - (visibleHeight - rowRect.height) / 2;
  viewport.scrollTop = Math.max(0, targetTop);
}

function estimateTextWidth(value: string): number {
  const text = String(value);
  const context = getMeasureContext();
  if (context) {
    return context.measureText(text).width;
  }
  return Array.from(text).reduce((width, char) => width + (char.charCodeAt(0) > 127 ? 16 : 8), 0);
}

function resolveColumnWidths(
  table: DataTable,
  columnWidths: Record<string, number>,
  columnMenus: Record<string, ReactNode>,
  showsRowChecks: boolean,
  viewportWidth: number | undefined,
  isColumnResizing: boolean,
  fillRemainingColumnKey?: string,
): Record<string, number> {
  const resolved = Object.fromEntries(
    table.columns.map((column) => [
      column.key,
      Math.max(minimumColumnWidth, columnWidths[column.key] ?? estimateDefaultColumnWidth(table, column, Boolean(columnMenus[column.key]))),
    ]),
  );
  if (!viewportWidth || table.columns.length === 0) {
    return resolved;
  }

  const fixedWidth = showsRowChecks ? defaultCheckWidth : 0;
  const defaultColumns = table.columns.filter((column) => columnWidths[column.key] === undefined);
  const currentTotal = fixedWidth + table.columns.reduce((total, column) => total + resolved[column.key], 0);
  const hasManualWidths = Object.keys(columnWidths).length > 0;
  if (isColumnResizing) {
    return resolved;
  }

  if (hasManualWidths && currentTotal > viewportWidth) {
    return resolved;
  }

  if (currentTotal < viewportWidth) {
    if (fillRemainingColumnKey) {
      const fillColumns = resolveRemainingWidthColumns(table.columns, defaultColumns, fillRemainingColumnKey);
      return distributeWidthEvenly(resolved, fillColumns, viewportWidth - currentTotal);
    }

    const fillColumns = resolveRemainingWidthColumns(table.columns, defaultColumns);
    const naturalWidths = Object.fromEntries(
      fillColumns.map((column) => [column.key, estimateFullColumnWidth(table, column, Boolean(columnMenus[column.key]))]),
    );
    return distributeWidthByNeed(resolved, fillColumns, naturalWidths, viewportWidth - currentTotal);
  }

  if (currentTotal <= viewportWidth || defaultColumns.length === 0) {
    return resolved;
  }

  const targetWidth = viewportWidth - fixedWidth;
  return shrinkColumnsEvenly(resolved, defaultColumns.filter((column) => resolved[column.key] > defaultColumnWidth), defaultColumnWidth, targetWidth);
}

function resolveRemainingWidthColumns(columns: DataTable["columns"], defaultColumns: DataTable["columns"], fillRemainingColumnKey?: string): DataTable["columns"] {
  if (fillRemainingColumnKey) {
    const fillColumn = columns.find((column) => column.key === fillRemainingColumnKey);
    if (fillColumn) {
      return [fillColumn];
    }
  }
  return defaultColumns.length > 0 ? defaultColumns : columns.length > 0 ? [columns[columns.length - 1]] : [];
}

function distributeWidthEvenly(widths: Record<string, number>, columns: DataTable["columns"], extraWidth: number): Record<string, number> {
  if (columns.length === 0 || extraWidth <= 0) {
    return widths;
  }
  const expanded = { ...widths };
  const extraPerColumn = extraWidth / columns.length;
  for (const column of columns) {
    expanded[column.key] += extraPerColumn;
  }
  return expanded;
}

function distributeWidthByNeed(widths: Record<string, number>, columns: DataTable["columns"], naturalWidths: Record<string, number>, extraWidth: number): Record<string, number> {
  if (columns.length === 0 || extraWidth <= 0) {
    return widths;
  }

  const expanded = { ...widths };
  let remainingExtra = extraWidth;
  let needyColumns = columns.filter((column) => naturalWidths[column.key] > expanded[column.key] + 0.01);

  while (remainingExtra > 0.01 && needyColumns.length > 0) {
    const extraPerColumn = remainingExtra / needyColumns.length;
    let applied = 0;
    for (const column of needyColumns) {
      const neededWidth = naturalWidths[column.key] - expanded[column.key];
      const delta = Math.min(extraPerColumn, neededWidth);
      expanded[column.key] += delta;
      applied += delta;
    }

    remainingExtra -= applied;
    needyColumns = needyColumns.filter((column) => naturalWidths[column.key] > expanded[column.key] + 0.01);
    if (applied <= 0) {
      break;
    }
  }

  return remainingExtra > 0.01 ? distributeWidthEvenly(expanded, columns, remainingExtra) : expanded;
}

function shrinkColumnsEvenly(widths: Record<string, number>, columns: DataTable["columns"], minWidth: number, targetTotalWidth: number): Record<string, number> {
  const shrunk = { ...widths };
  let remainingShrink = Object.values(shrunk).reduce((total, width) => total + width, 0) - targetTotalWidth;
  let shrinkable = columns.filter((column) => shrunk[column.key] > minWidth);

  while (remainingShrink > 0.01 && shrinkable.length > 0) {
    const perColumn = remainingShrink / shrinkable.length;
    let applied = 0;
    for (const column of shrinkable) {
      const delta = Math.min(perColumn, shrunk[column.key] - minWidth);
      shrunk[column.key] -= delta;
      applied += delta;
    }
    remainingShrink -= applied;
    shrinkable = shrinkable.filter((column) => shrunk[column.key] > minWidth + 0.01);
    if (applied <= 0) {
      break;
    }
  }

  return shrunk;
}

function estimateDefaultColumnWidth(table: DataTable, column: DataTable["columns"][number], hasHeaderMenu = false): number {
  const naturalWidth = estimateFullColumnWidth(table, column, hasHeaderMenu);
  const minColumnWidth = resolveMinimumColumnWidth(column.key);
  const maxDefaultWidth = Math.max(defaultColumnWidth, minColumnWidth);
  return Math.ceil(Math.min(naturalWidth, maxDefaultWidth));
}

function resolveMinimumColumnWidth(columnKey: string): number {
  return columnKey === "ngCut" ? 116 : minimumColumnWidth;
}

function estimateFullColumnWidth(table: DataTable, column: DataTable["columns"][number], hasHeaderMenu = false): number {
  const horizontalPadding = defaultCellPaddingX * 2;
  const resizeHandleAllowance = 8;
  const headerMenuAllowance = hasHeaderMenu ? 28 : 0;
  const cellActionAllowance = column.key === "speaker" || column.key === "qcStatus" ? 26 : column.key === "ngCut" ? 34 : 0;
  const headerWidth = estimateTextWidth(column.label) + horizontalPadding + resizeHandleAllowance + headerMenuAllowance;
  const bodyWidth = Math.max(...table.rows.map((row) => estimateTextWidth(row.cells[column.key] || "-") + horizontalPadding + cellActionAllowance + 2), 0);
  const minColumnWidth = resolveMinimumColumnWidth(column.key);
  return Math.ceil(Math.max(headerWidth, bodyWidth, minColumnWidth));
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) {
    return measureContext;
  }
  if (typeof document === "undefined") {
    measureContext = null;
    return measureContext;
  }
  const canvas = document.createElement("canvas");
  measureContext = canvas.getContext("2d");
  if (measureContext) {
    measureContext.font = '14px "Noto Sans KR", "Segoe UI", system-ui, sans-serif';
  }
  return measureContext;
}

function estimateRowHeight(row: DataTableRow, table: DataTable, columnWidths: Record<string, number>): number {
  const lines = Math.max(
    1,
    ...table.columns.map((column) => {
      const width = columnWidths[column.key] ?? defaultColumnWidth;
      const charsPerLine = Math.max(4, Math.floor((width - 32) / 8));
      return Math.ceil(String(row.cells[column.key] || "-").length / charsPerLine);
    }),
  );
  return Math.max(defaultRowHeight, lines * 20 + 22);
}

function resolveRowLineClamp(rowHeight: number): number {
  const verticalPadding = 18;
  const lineHeight = 20;
  return Math.max(1, Math.floor((rowHeight - verticalPadding) / lineHeight));
}

function omitKey<T>(source: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = source;
  return rest;
}
