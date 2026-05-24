import type { ReactNode } from "react";
import type { DataTable, DataTableRow } from "@shared/ipc";
import { defaultCellPaddingX, defaultCheckWidth, defaultColumnWidth, defaultHeaderHeight, defaultRowHeight, minimumColumnWidth } from "./data-grid-types";

export function countDuplicateRows(targetRows: DataTableRow[], clipboardRows: DataTableRow[]): number {
  const targetKeys = new Set(targetRows.map(rowDuplicateKey).filter(Boolean));
  return clipboardRows.filter((row) => targetKeys.has(rowDuplicateKey(row))).length;
}

export function scrollRowToViewportCenter(rowElement: HTMLTableRowElement | null | undefined, viewport: HTMLDivElement | null | undefined): void;
export function scrollRowToViewportCenter(rowId: string, rowElement: HTMLTableRowElement | null | undefined, viewport: HTMLDivElement | null | undefined): void;
export function scrollRowToViewportCenter(
  _rowIdOrElement: string | HTMLTableRowElement | null | undefined,
  rowElementOrViewport: HTMLTableRowElement | HTMLDivElement | null | undefined,
  maybeViewport?: HTMLDivElement | null,
): void {
  const rowElement = typeof _rowIdOrElement === "string" ? (rowElementOrViewport as HTMLTableRowElement | null | undefined) : _rowIdOrElement;
  const viewport = typeof _rowIdOrElement === "string" ? maybeViewport : (rowElementOrViewport as HTMLDivElement | null | undefined);
  if (!rowElement || !viewport) {
    return;
  }

  const rowRect = rowElement.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const visibleHeight = Math.max(rowRect.height, viewport.clientHeight - defaultHeaderHeight);
  const targetTop = viewport.scrollTop + rowRect.top - viewportRect.top - defaultHeaderHeight - (visibleHeight - rowRect.height) / 2;
  viewport.scrollTop = Math.max(0, targetTop);
}

export function resolveColumnWidths(
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

export function estimateFullColumnWidth(table: DataTable, column: DataTable["columns"][number], hasHeaderMenu = false): number {
  const horizontalPadding = defaultCellPaddingX * 2;
  const resizeHandleAllowance = 8;
  const headerMenuAllowance = hasHeaderMenu ? 28 : 0;
  const cellActionAllowance = column.key === "speaker" || column.key === "qcStatus" ? 26 : column.key === "ngCut" ? 34 : 0;
  const headerWidth = estimateTextWidth(column.label) + horizontalPadding + resizeHandleAllowance + headerMenuAllowance;
  const bodyWidth = Math.max(...table.rows.map((row) => estimateTextWidth(row.cells[column.key] || "-") + horizontalPadding + cellActionAllowance + 2), 0);
  const minColumnWidth = resolveMinimumColumnWidth(column.key);
  return Math.ceil(Math.max(headerWidth, bodyWidth, minColumnWidth));
}

export function estimateRowHeight(row: DataTableRow, table: DataTable, columnWidths: Record<string, number>): number {
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

export function resolveRowLineClamp(rowHeight: number): number {
  const verticalPadding = 18;
  const lineHeight = 20;
  return Math.max(1, Math.floor((rowHeight - verticalPadding) / lineHeight));
}

export function omitKey<T>(source: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = source;
  return rest;
}

function rowDuplicateKey(row: DataTableRow): string {
  const raw = row.raw ?? {};
  return normalizeKey(raw.originalPath || raw.original_path || raw.absolute_path || raw.inputPath || raw.input_path || row.sourcePath || row.cells.fileName || row.cells.file_name || row.id);
}

function normalizeKey(value: string | undefined): string {
  return (value ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}

function estimateTextWidth(value: string): number {
  const text = String(value);
  const context = getMeasureContext();
  if (context) {
    return context.measureText(text).width;
  }
  return Array.from(text).reduce((width, char) => width + (char.charCodeAt(0) > 127 ? 16 : 8), 0);
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
