import { useCallback, type MutableRefObject } from "react";
import type { DataTableRow, WorkspaceId } from "@shared/ipc";
import {
  findFirstAudioPath,
  firstNonVirtualPath,
  resolveAudioSelection,
  resolveSliceSourceIdentity,
  resolveSliceSourcePath,
} from "../../model/workspace-runtime-selection";
import {
  numberFromSliceRow,
  partitionSliceComponents,
  readSliceComponents,
  readSliceRowBounds,
  retimeSliceComponents,
  serializeSliceComponents,
  splitSingleSliceComponent,
} from "../../model/slice-segments";
import { createSliceComponentRow, createSliceRowIdAllocator, reindexSliceRows } from "./slice-table-rows";
import { firstNonEmpty, formatSecondsCell, shortName } from "./terminal-state";
import { updateActiveSheet, type WorkspaceRuntimeState, type WorkspaceRuntimeStore } from "../workspace-runtime-store";


type SliceSegmentActionsDeps = {
  statesRef: MutableRefObject<WorkspaceRuntimeStore>;
  updateSheetState: (workspaceId: WorkspaceId, patch: Parameters<typeof updateActiveSheet>[1]) => void;
  updateState: (workspaceId: WorkspaceId, patch: Partial<WorkspaceRuntimeState>) => void;
};

export function useSliceSegmentActions({ statesRef, updateSheetState, updateState }: SliceSegmentActionsDeps) {
  const splitOrUnmergeSliceSegment = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow, componentIds: string[]) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const sourceIndex = state.table.rows.findIndex((row) => row.id === sourceRow.id);
      if (sourceIndex < 0) {
        return;
      }

      const currentSourceRow = state.table.rows[sourceIndex];
      const components = readSliceComponents(currentSourceRow);
      const sourceBounds = readSliceRowBounds(currentSourceRow);
      if (components.length === 0 && sourceBounds.endSec <= sourceBounds.startSec) {
        return;
      }

      const groups = components.length <= 1
        ? splitSingleSliceComponent(components[0] ?? sourceBounds)
        : partitionSliceComponents(currentSourceRow.id, components, componentIds);
      if (groups.length === 0) {
        return;
      }

      const allocateRowId = createSliceRowIdAllocator(state.table.rows);
      const replacementRows = groups.map((group, index) => {
        const id = index === 0 ? currentSourceRow.id : allocateRowId();
        return createSliceComponentRow(currentSourceRow, group, id, state.selectedAudioPath);
      });
      const nextRows = reindexSliceRows([
        ...state.table.rows.slice(0, sourceIndex),
        ...replacementRows,
        ...state.table.rows.slice(sourceIndex + 1),
      ]);
      const selectedRow = nextRows.find((row) => row.id === replacementRows[0]?.id) ?? nextRows[0];
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);

      updateSheetState(workspaceId, {
        table: { ...state.table, rows: nextRows },
        selectedRowId: selectedRow?.id,
        selectedRowIds: selectedRow ? [selectedRow.id] : [],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
      });
      updateState(workspaceId, { statusText: components.length <= 1 ? "Marker split" : "Marker unmerged" });
    },
    [updateSheetState, updateState],
  );

  const mergeSliceSegments = useCallback(
    (workspaceId: WorkspaceId) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const selectedIds = new Set(state.selectedRowIds);
      const selectedEntries = state.table.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => selectedIds.has(row.id));
      if (selectedEntries.length < 2) {
        return;
      }

      const activeSelectedRow = selectedEntries.find(({ row }) => row.id === state.selectedRowId)?.row ?? selectedEntries[0]?.row;
      if (!activeSelectedRow) {
        return;
      }

      const basePath = resolveSliceSourceIdentity(activeSelectedRow, state.selectedAudioPath);
      const mergeEntries = selectedEntries.filter(({ row }) => resolveSliceSourceIdentity(row, state.selectedAudioPath) === basePath);
      if (mergeEntries.length < 2) {
        return;
      }

      const mergeIds = new Set(mergeEntries.map(({ row }) => row.id));
      const orderedMergeEntries = mergeEntries.slice().sort((left, right) => numberFromSliceRow(left.row, "startSec") - numberFromSliceRow(right.row, "startSec") || numberFromSliceRow(left.row, "endSec") - numberFromSliceRow(right.row, "endSec") || left.index - right.index);
      const insertIndex = Math.min(...mergeEntries.map(({ index }) => index));
      const mergedComponents = orderedMergeEntries.flatMap(({ row }) => readSliceComponents(row)).sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
      if (mergedComponents.length === 0) {
        return;
      }

      const mergedId = createSliceRowIdAllocator(state.table.rows)();
      const templateRow = mergeEntries.find(({ row }) => row.id === state.selectedRowId)?.row ?? orderedMergeEntries[0].row;
      const mergedRow = createSliceComponentRow(templateRow, mergedComponents, mergedId, state.selectedAudioPath);
      const mergedRows = state.table.rows.flatMap((row, index) => {
        if (!mergeIds.has(row.id)) {
          return [row];
        }

        return index === insertIndex ? [mergedRow] : [];
      });
      const nextRows = reindexSliceRows(mergedRows);
      const selectedRow = nextRows.find((row) => row.id === mergedId) ?? nextRows[0];
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);
      const nextRowExportChecks = { ...state.rowExportChecks };
      const mergedExportChecked = mergeEntries.some(({ row }) => state.rowExportChecks[row.id] !== false);
      for (const rowId of mergeIds) {
        delete nextRowExportChecks[rowId];
      }
      if (selectedRow) {
        nextRowExportChecks[selectedRow.id] = mergedExportChecked;
      }

      updateSheetState(workspaceId, {
        table: { ...state.table, rows: nextRows },
        selectedRowId: selectedRow?.id,
        selectedRowIds: selectedRow ? [selectedRow.id] : [],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
        rowExportChecks: nextRowExportChecks,
      });
      updateState(workspaceId, { statusText: "Markers merged" });
    },
    [updateSheetState, updateState],
  );

  const addSliceSegment = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow | undefined, requestedStartSec?: number, requestedEndSec?: number) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const fallbackPath = firstNonVirtualPath(state.selectedAudioPath, findFirstAudioPath(state.inputTree), state.selectedFilePath);
      const originalPath = resolveSliceSourcePath(sourceRow, fallbackPath);
      if (!originalPath) {
        return;
      }

      const sourceBounds = readSliceRowBounds(sourceRow);
      const sourceStartSec = sourceRow ? sourceBounds.startSec : 0;
      const sourceEndSec = sourceRow ? sourceBounds.endSec : Math.max(0.001, Number.isFinite(requestedEndSec) ? Number(requestedEndSec) : 0.001);
      const startSec = Math.max(0, Number.isFinite(requestedStartSec) ? Number(requestedStartSec) : sourceStartSec);
      const endSec = Math.max(startSec + 0.001, Number.isFinite(requestedEndSec) ? Number(requestedEndSec) : sourceEndSec);
      if (endSec <= startSec) {
        return;
      }

      const nextIndex = state.table.rows.length + 1;
      const nextRowId = createSliceRowIdAllocator(state.table.rows)();
      const fileName = firstNonEmpty(sourceRow?.raw?.fileName, sourceRow?.raw?.file_name, sourceRow?.cells.fileName, shortName(originalPath));
      const durationSec = Math.max(0, endSec - startSec);
      const markerComponents = serializeSliceComponents([{ startSec, endSec }]);
      const newRow: DataTableRow = {
        id: nextRowId,
        sourcePath: originalPath,
        raw: {
          ...(sourceRow?.raw ?? {}),
          index: `${nextIndex}`,
          chunkIndex: `${nextIndex}`,
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
          markerCount: "1",
          markerComponents,
          marker_components: markerComponents,
          status: "edited",
        },
        cells: {
          ...(sourceRow?.cells ?? {}),
          index: `${nextIndex}`,
          fileName,
          startSec: formatSecondsCell(startSec),
          endSec: formatSecondsCell(endSec),
          rangeSec: formatRangeCell(startSec, endSec),
          durationSec: `${durationSec.toFixed(2)}s`,
          markerCount: "1",
          status: "편집됨",
          remarks: "-",
          outputPath: "",
        },
      };
      const nextRows = reindexSliceRows([...state.table.rows, newRow]);
      const selectedRow = nextRows.find((row) => row.id === newRow.id) ?? nextRows[nextRows.length - 1] ?? newRow;
      const nextTable = {
        ...state.table,
        rows: nextRows,
      };
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, originalPath);
      updateSheetState(workspaceId, {
        table: nextTable,
        selectedRowId: selectedRow.id,
        selectedRowIds: [selectedRow.id],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })),
        rowExportChecks: {
          ...state.rowExportChecks,
          [selectedRow.id]: true,
        },
        browserPreferredSection: "input",
        browserSectionRequestId: state.browserSectionRequestId + 1,
        browserRevealRequestId: state.browserRevealRequestId + 1,
        tableRevealRequestId: state.tableRevealRequestId + 1,
      });
      updateState(workspaceId, { statusText: "Marker added" });
    },
    [updateSheetState, updateState],
  );

  const deleteSliceSegment = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const removeIndex = state.table.rows.findIndex((row) => row.id === sourceRow.id);
      if (removeIndex < 0) {
        return;
      }

      const nextRows = reindexSliceRows(state.table.rows.filter((row) => row.id !== sourceRow.id));
      const nextSelectedRow = nextRows[Math.min(removeIndex, Math.max(0, nextRows.length - 1))] ?? nextRows[removeIndex - 1] ?? nextRows[0];
      const nextRowExportChecks = { ...state.rowExportChecks };
      delete nextRowExportChecks[sourceRow.id];
      const audioSelection = resolveAudioSelection(workspaceId, nextSelectedRow, state.selectedAudioPath || findFirstAudioPath(state.inputTree));

      updateSheetState(workspaceId, {
        table: { ...state.table, rows: nextRows },
        selectedRowId: nextSelectedRow?.id,
        selectedRowIds: nextSelectedRow ? [nextSelectedRow.id] : [],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: nextSelectedRow ? state.table.columns.map((column) => ({ label: column.label, value: nextSelectedRow.cells[column.key] || "" })) : state.details,
        rowExportChecks: nextRowExportChecks,
        browserPreferredSection: "input",
        browserRevealRequestId: state.browserRevealRequestId + 1,
        tableRevealRequestId: state.tableRevealRequestId + 1,
      });
      updateState(workspaceId, { statusText: "Marker removed" });
    },
    [updateSheetState, updateState],
  );

  const updateSliceSegmentBounds = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow, startSec: number, endSec: number) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const safeStartSec = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
      const safeEndSec = Math.max(safeStartSec + 0.001, Number.isFinite(endSec) ? endSec : safeStartSec + 0.001);
      const durationSec = safeEndSec - safeStartSec;
      let updatedRow: DataTableRow | undefined;
      const nextRows: DataTableRow[] = state.table.rows.map((row): DataTableRow => {
        if (row.id !== sourceRow.id) {
          return row;
        }

        const retimedComponents = retimeSliceComponents(row, safeStartSec, safeEndSec);
        const nextRaw: Record<string, string> = {
          ...(row.raw ?? {}),
          startSec: `${safeStartSec}`,
          endSec: `${safeEndSec}`,
          durationSec: `${durationSec}`,
          status: row.raw?.status || "edited",
        };

        if (retimedComponents) {
          const serializedComponents = serializeSliceComponents(retimedComponents);
          nextRaw.markerComponents = serializedComponents;
          nextRaw.marker_components = serializedComponents;
          nextRaw.markerCount = `${retimedComponents.length}`;
        }

        const nextRow: DataTableRow = {
          ...row,
          raw: nextRaw,
          cells: {
            ...row.cells,
            startSec: formatSecondsCell(safeStartSec),
            endSec: formatSecondsCell(safeEndSec),
            rangeSec: formatRangeCell(safeStartSec, safeEndSec),
            durationSec: `${durationSec.toFixed(2)}s`,
            markerCount: retimedComponents ? `${retimedComponents.length}` : row.cells.markerCount,
          },
        };

        updatedRow = nextRow;
        return nextRow;
      });

      if (!updatedRow) {
        return;
      }

      const selectedRow = updatedRow;
      const nextTable = {
        ...state.table,
        rows: nextRows,
      };
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);
      updateSheetState(workspaceId, {
        table: nextTable,
        selectedRowId: selectedRow.id,
        selectedRowIds: [selectedRow.id],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })),
      });
      updateState(workspaceId, { statusText: "Edited" });
    },
    [updateSheetState, updateState],
  );

  return {
    splitOrUnmergeSliceSegment,
    mergeSliceSegments,
    addSliceSegment,
    deleteSliceSegment,
    updateSliceSegmentBounds,
  };
}

function formatRangeCell(startSec: number, endSec: number): string {
  return `${formatSecondsCell(startSec)} - ${formatSecondsCell(endSec)}`;
}
