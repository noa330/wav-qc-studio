import type { DataTableRow } from "@shared/ipc";
import { readSliceRowBounds } from "../../../model/slice-segments";
import { clamp } from "../../shared/workspace-ui-utils";
import type { SliceEditorViewState } from "./SliceEditorPanel";

const minSliceViewSpan = 0.035;

export function zoomSliceView(view: SliceEditorViewState, factor: number, anchor: number): SliceEditorViewState {
  const safeStart = clamp(view.viewStart, 0, 1);
  const safeEnd = clamp(view.viewEnd, safeStart + minSliceViewSpan, 1);
  const currentSpan = safeEnd - safeStart;
  const nextSpan = clamp(currentSpan * factor, minSliceViewSpan, 1);
  const safeAnchor = clamp(anchor, 0, 1);
  let nextStart = safeStart + currentSpan * safeAnchor - nextSpan * safeAnchor;
  let nextEnd = nextStart + nextSpan;

  if (nextStart < 0) {
    nextEnd -= nextStart;
    nextStart = 0;
  }

  if (nextEnd > 1) {
    nextStart -= nextEnd - 1;
    nextEnd = 1;
  }

  return {
    ...view,
    viewStart: clamp(nextStart, 0, 1 - minSliceViewSpan),
    viewEnd: clamp(nextEnd, minSliceViewSpan, 1),
  };
}

export function setSliceViewRange(view: SliceEditorViewState, start: number, end: number): SliceEditorViewState {
  const safeStart = clamp(start, 0, 1);
  const safeEnd = clamp(end, safeStart + minSliceViewSpan, 1);
  const span = Math.max(minSliceViewSpan, safeEnd - safeStart);
  const nextStart = clamp(safeStart, 0, 1 - span);

  return {
    ...view,
    viewStart: nextStart,
    viewEnd: clamp(nextStart + span, minSliceViewSpan, 1),
  };
}

export function focusSliceViewOnRow(view: SliceEditorViewState, rows: DataTableRow[], selectedRow: DataTableRow, totalSeconds: number): SliceEditorViewState {
  const orderedRows = rows
    .map((row) => ({
      row,
      ...readSliceRowBounds(row),
    }))
    .filter((entry) => entry.endSec > entry.startSec)
    .sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
  const selected = orderedRows.find((entry) => entry.row.id === selectedRow.id) ?? orderedRows[0];

  if (totalSeconds <= 0 || !selected) {
    return {
      ...view,
      viewStart: 0,
      viewEnd: 1,
    };
  }

  const rangeStart = selected.startSec;
  const rangeEnd = selected.endSec;
  const rawSpan = Math.max(1, rangeEnd - rangeStart);
  const padding = Math.max(1, rawSpan * 2);
  const desiredSpan = Math.min(totalSeconds, Math.max(30, rawSpan + padding * 2));
  const center = (selected.startSec + selected.endSec) / 2;

  let start = center - desiredSpan / 2;
  let end = start + desiredSpan;
  if (start > rangeStart - padding) {
    start = rangeStart - padding;
    end = start + desiredSpan;
  }

  if (end < rangeEnd + padding) {
    end = rangeEnd + padding;
    start = end - desiredSpan;
  }

  start = clamp(start, 0, Math.max(0, totalSeconds - desiredSpan));
  end = clamp(start + desiredSpan, start + 0.001, totalSeconds);

  return {
    ...view,
    viewStart: clamp(start / totalSeconds, 0, 1),
    viewEnd: clamp(end / totalSeconds, start / totalSeconds, 1),
  };
}
