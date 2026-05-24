import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { resolveScrollWindowMetrics } from "@shared/scroll-window";
import { useColumnMenuController, useDataGridViewStateSync, useDataGridViewportWidth, useDismissibleGridPortal } from "./data-grid-effects";
import { EmptyDataGrid } from "./data-grid-empty";
import { GridFooter } from "./data-grid-footer";
import { buildRowOffsets, resolveGridPagination, resolveRowWindowRange } from "./data-grid-model";
import { ColumnFilterMenu, DuplicatePasteDialog, GridContextMenu } from "./data-grid-overlays";
import { useDataGridResizeActions } from "./data-grid-resize-actions";
import { countDuplicateRows, estimateRowHeight, resolveColumnWidths, scrollRowToViewportCenter } from "./data-grid-sizing";
import { DataGridTable } from "./data-grid-table";
import { defaultCheckWidth, defaultHeaderHeight, defaultRowHeight, defaultSheetTabs, gridRowWindowBufferScreens, type ColumnMenuState, type DataGridProps, type DuplicateDialogState, type DuplicatePasteMode, type GridMenuState, type RowRevealRequest, type RowScrollAnchor } from "./data-grid-types";

export type { CellRenderContext, DataGridViewState } from "./data-grid-types";

export function DataGrid({
  table,
  sheets = [],
  activeSheetId,
  onSelectSheet,
  onCreateSheet,
  onDeleteSheet,
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
}: DataGridProps) {
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
  const [rowWindowViewport, setRowWindowViewport] = useState({ height: 0, scrollTop: 0 });
  const [rowWindowStart, setRowWindowStart] = useState(0);
  const [isColumnResizing, setIsColumnResizing] = useState(false);
  const viewportWidth = useDataGridViewportWidth({
    viewportRef,
    suspendWidthTracking,
    columnCount: table.columns.length,
    rowCount: table.rows.length,
  });

  const showsRowChecks = Boolean(rowChecks && onToggleRowCheck);
  const selectedRowSet = useMemo(() => new Set(selectedRowIds.length > 0 ? selectedRowIds : selectedRowId ? [selectedRowId] : []), [selectedRowId, selectedRowIds]);
  const primarySelectedRowId = selectedRowId ?? selectedRowIds[0];
  const headerTargetRows = selectedRowSet.size > 1 ? table.rows.filter((row) => selectedRowSet.has(row.id)) : table.rows;
  const checkedCount = showsRowChecks ? headerTargetRows.filter((row) => rowChecks?.[row.id] !== false).length : 0;
  const allChecked = showsRowChecks && headerTargetRows.length > 0 && checkedCount === headerTargetRows.length;
  const displaySheets = sheets.length > 0 ? sheets : defaultSheetTabs;
  const displayActiveSheetId = activeSheetId ?? displaySheets[0]?.id;
  const canDeleteSheet = Boolean(onDeleteSheet && sheets.length > 1 && displayActiveSheetId);
  const { safePageSize, pageCount, safePageIndex } = resolveGridPagination({ rowCount: table.rows.length, pageSize, pageIndex, showPagination });
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
  const pageRowOffsets = useMemo(() => buildRowOffsets(pageRowHeights), [pageRowHeights]);
  const { chunkSize: rowWindowChunkSize, stepSize: rowWindowStepSize } = resolveScrollWindowMetrics({
    viewportExtent: rowWindowViewport.height - defaultHeaderHeight,
    itemExtent: defaultRowHeight,
    itemCount: pageRows.length,
    bufferScreens: gridRowWindowBufferScreens,
  });
  const maxRowWindowStart = Math.max(0, pageRows.length - rowWindowChunkSize);
  const rowWindowRange = useMemo(() => resolveRowWindowRange({ rowWindowStart, maxRowWindowStart, rowCount: pageRows.length, rowWindowChunkSize }), [maxRowWindowStart, pageRows.length, rowWindowChunkSize, rowWindowStart]);
  const windowRows = pageRows.slice(rowWindowRange.start, rowWindowRange.end);

  useDataGridViewStateSync({ pageSize, pageIndex, columnWidths, autoFitColumns, rowHeights, autoFitRowsActive, onViewStateChange });
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

  const closeMenu = useCallback(() => setMenu(undefined), []);
  const closeColumnMenu = useCallback(() => setColumnMenu(undefined), []);
  useDismissibleGridPortal({ active: Boolean(menu), refEl: menuRef, onClose: closeMenu });
  useDismissibleGridPortal({ active: Boolean(columnMenu), refEl: columnMenuRef, onClose: closeColumnMenu });
  const openColumnMenu = useColumnMenuController(setColumnMenu);

  const suppressNextRowClick = useCallback(() => {
    suppressNextRowClickRef.current = true;
    if (suppressNextRowClickTimerRef.current !== undefined) {
      window.clearTimeout(suppressNextRowClickTimerRef.current);
    }
    suppressNextRowClickTimerRef.current = window.setTimeout(() => {
      suppressNextRowClickRef.current = false;
      suppressNextRowClickTimerRef.current = undefined;
    }, 350);
  }, []);

  const { resizeColumn, resizeRow, autoFitColumn, autoFitRows } = useDataGridResizeActions({
    table,
    resolvedColumnWidths,
    rowHeights,
    autoFitColumns,
    autoFitRowsActive,
    setColumnWidths,
    setAutoFitColumns,
    setIsColumnResizing,
    setRowHeights,
    setAutoFitRowsActive,
    suppressNextRowClick,
  });

  if (table.columns.length === 0) {
    return <EmptyDataGrid emptyText={emptyText} />;
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

  const requestPaste = () => {
    const duplicateCount = countDuplicateRows(table.rows, clipboardRows);
    if (duplicateCount > 0) {
      setDuplicateDialog({ count: duplicateCount });
      return;
    }

    pasteRows("overwrite");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DataGridTable
        table={table}
        sheets={sheets}
        displaySheets={displaySheets}
        displayActiveSheetId={displayActiveSheetId}
        showSheetTabs={showSheetTabs}
        sheetToolbar={sheetToolbar}
        selectedRowIds={selectedRowIds}
        selectedRowSet={selectedRowSet}
        headerTargetRows={headerTargetRows}
        allChecked={allChecked}
        viewportRef={viewportRef}
        rowRefs={rowRefs}
        viewportWidth={viewportWidth}
        tableWidth={tableWidth}
        showsRowChecks={showsRowChecks}
        resolvedColumnWidths={resolvedColumnWidths}
        columnMenus={columnMenus}
        columnMenu={columnMenu}
        windowRows={windowRows}
        rowWindowRange={rowWindowRange}
        pageRowHeights={pageRowHeights}
        rowChecks={rowChecks}
        renderCell={renderCell}
        emptyText={emptyText}
        suppressNextRowClickRef={suppressNextRowClickRef}
        suppressNextRowClickTimerRef={suppressNextRowClickTimerRef}
        onCreateSheet={onCreateSheet}
        onSelectSheet={onSelectSheet}
        onSelectRow={onSelectRow}
        onToggleRowCheck={onToggleRowCheck}
        onToggleAllRows={onToggleAllRows}
        onToggleRowsCheck={onToggleRowsCheck}
        openMenu={openMenu}
        handleRowWindowScroll={handleRowWindowScroll}
        openColumnMenu={openColumnMenu}
        resizeColumn={resizeColumn}
        resizeRow={resizeRow}
        autoFitColumn={autoFitColumn}
        autoFitRows={autoFitRows}
        suppressNextRowClick={suppressNextRowClick}
      />

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
          onDeleteSheet={onDeleteSheet ? () => {
            onDeleteSheet();
            setMenu(undefined);
          } : undefined}
          canDeleteSheet={canDeleteSheet}
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
