import type { ColumnMenuState } from "./data-grid-types";

export function resolveGridPagination({
  rowCount,
  pageSize,
  pageIndex,
  showPagination,
}: {
  rowCount: number;
  pageSize: number;
  pageIndex: number;
  showPagination: boolean;
}) {
  const safePageSize = showPagination ? Math.max(1, Math.trunc(pageSize || 1)) : Math.max(1, rowCount || 1);
  const pageCount = Math.max(1, Math.ceil(rowCount / safePageSize));
  const safePageIndex = showPagination ? Math.min(pageIndex, pageCount - 1) : 0;
  return { safePageSize, pageCount, safePageIndex };
}

export function buildRowOffsets(rowHeights: number[]): number[] {
  const offsets = [0];
  for (const height of rowHeights) {
    offsets.push(offsets[offsets.length - 1] + height);
  }
  return offsets;
}

export function resolveRowWindowRange({
  rowWindowStart,
  maxRowWindowStart,
  rowCount,
  rowWindowChunkSize,
}: {
  rowWindowStart: number;
  maxRowWindowStart: number;
  rowCount: number;
  rowWindowChunkSize: number;
}) {
  const start = Math.min(rowWindowStart, maxRowWindowStart);
  return { start, end: Math.min(rowCount, start + rowWindowChunkSize) };
}

export function resolveColumnMenuState({
  current,
  key,
  triggerRect,
  windowWidth,
  windowHeight,
}: {
  current: ColumnMenuState | undefined;
  key: string;
  triggerRect: DOMRect;
  windowWidth: number;
  windowHeight: number;
}): ColumnMenuState | undefined {
  return current?.key === key
    ? undefined
    : {
        key,
        left: Math.min(Math.max(12, triggerRect.left - 168), Math.max(12, windowWidth - 240 - 12)),
        top: Math.min(triggerRect.bottom + 6, windowHeight - 260),
        width: 240,
      };
}
