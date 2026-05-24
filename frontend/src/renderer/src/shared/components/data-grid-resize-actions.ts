import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { DataTable } from "@shared/ipc";
import { defaultColumnWidth, defaultRowHeight, minimumColumnWidth } from "./data-grid-types";
import { estimateFullColumnWidth, estimateRowHeight, omitKey } from "./data-grid-sizing";

type GridStateSetter<T> = Dispatch<SetStateAction<T>>;

export function useDataGridResizeActions({
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
}: {
  table: DataTable;
  resolvedColumnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  autoFitColumns: Record<string, boolean>;
  autoFitRowsActive: boolean;
  setColumnWidths: GridStateSetter<Record<string, number>>;
  setAutoFitColumns: GridStateSetter<Record<string, boolean>>;
  setIsColumnResizing: GridStateSetter<boolean>;
  setRowHeights: GridStateSetter<Record<string, number>>;
  setAutoFitRowsActive: GridStateSetter<boolean>;
  suppressNextRowClick: () => void;
}) {
  const resizeColumn = useCallback(
    (column: DataTable["columns"][number], startClientX: number) => {
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
    },
    [resolvedColumnWidths, setAutoFitColumns, setColumnWidths, setIsColumnResizing, table.columns],
  );

  const resizeRow = useCallback(
    (rowId: string, startClientY: number) => {
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
    },
    [rowHeights, setAutoFitRowsActive, setRowHeights, suppressNextRowClick],
  );

  const autoFitColumn = useCallback(
    (columnKey: string) => {
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
    },
    [autoFitColumns, setAutoFitColumns, setColumnWidths, table],
  );

  const autoFitRows = useCallback(() => {
    if (autoFitRowsActive) {
      setRowHeights({});
      setAutoFitRowsActive(false);
      return;
    }

    setRowHeights(Object.fromEntries(table.rows.map((row) => [row.id, estimateRowHeight(row, table, resolvedColumnWidths)])));
    setAutoFitRowsActive(true);
  }, [autoFitRowsActive, resolvedColumnWidths, setAutoFitRowsActive, setRowHeights, table]);

  return { resizeColumn, resizeRow, autoFitColumn, autoFitRows };
}
