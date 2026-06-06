import type { DataTableRow } from "@shared/ipc";
import { resolveSliceSourcePath } from "../../model/workspace-runtime-selection";
import { serializeSliceComponents, type SliceComponent } from "../../model/slice-segments";
import { firstNonEmpty, formatSecondsCell, shortName } from "./terminal-state";

export function createSliceComponentRow(sourceRow: DataTableRow, components: SliceComponent[], id: string, fallbackAudioPath?: string): DataTableRow {
  const sortedComponents = components.slice().sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
  const startSec = Math.min(...sortedComponents.map((component) => component.startSec));
  const endSec = Math.max(...sortedComponents.map((component) => component.endSec));
  const durationSec = Math.max(0, endSec - startSec);
  const originalPath = resolveSliceSourcePath(sourceRow, fallbackAudioPath);
  const fileName = firstNonEmpty(sourceRow.raw?.fileName, sourceRow.raw?.file_name, sourceRow.cells.fileName, shortName(originalPath));
  const markerComponents = serializeSliceComponents(sortedComponents);

  return {
    ...sourceRow,
    id,
    sourcePath: originalPath || sourceRow.sourcePath,
    raw: {
      ...sourceRow.raw,
      fileName,
      file_name: fileName,
      originalPath,
      original_path: originalPath,
      inputPath: originalPath,
      input_path: originalPath,
      absolute_path: originalPath,
      outputPath: "",
      output_path: "",
      startSec: `${startSec}`,
      endSec: `${endSec}`,
      durationSec: `${durationSec}`,
      markerCount: `${sortedComponents.length}`,
      markerComponents,
      marker_components: markerComponents,
      status: "edited",
    },
    cells: {
      ...sourceRow.cells,
      fileName,
      startSec: formatSecondsCell(startSec),
      endSec: formatSecondsCell(endSec),
      rangeSec: formatRangeCell(startSec, endSec),
      durationSec: `${durationSec.toFixed(2)}s`,
      markerCount: `${sortedComponents.length}`,
      status: "edited",
      remarks: "-",
      outputPath: "",
    },
  };
}

export function reindexSliceRows(rows: DataTableRow[]): DataTableRow[] {
  const allocateRowId = createSliceRowIdAllocator(rows);
  const usedRowIds = new Set<string>();
  return rows.map((row, index) => {
    const nextIndex = `${index + 1}`;
    const existingId = row.id.trim();
    const id = existingId && !usedRowIds.has(existingId) ? existingId : allocateRowId();
    usedRowIds.add(id);
    return {
      ...row,
      id,
      raw: {
        ...row.raw,
        index: nextIndex,
        chunkIndex: nextIndex,
      },
      cells: {
        ...row.cells,
        index: nextIndex,
      },
    };
  });
}

export function createSliceRowIdAllocator(rows: DataTableRow[]): () => string {
  const reservedIds = new Set(rows.map((row) => row.id.trim()).filter(Boolean));
  let nextId = rows
    .map((row) => Number(row.id) || Number(row.raw?.index || row.cells.index))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0) + 1;

  return () => {
    while (reservedIds.has(`${nextId}`)) {
      nextId += 1;
    }

    const id = `${nextId}`;
    reservedIds.add(id);
    nextId += 1;
    return id;
  };
}

function formatRangeCell(startSec: number, endSec: number): string {
  return `${formatSecondsCell(startSec)} - ${formatSecondsCell(endSec)}`;
}
