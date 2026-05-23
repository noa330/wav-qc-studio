import type { DataTable, DataTableRow } from "@shared/ipc";

export type BatchFilterState = {
  query: string;
  queryColumns: string[];
  includeUnchecked: boolean;
  includeEdited: boolean;
  includeChecked: boolean;
};

export const defaultBatchFilterState: BatchFilterState = {
  query: "",
  queryColumns: [],
  includeUnchecked: true,
  includeEdited: true,
  includeChecked: true,
};

export function filterBatchTable(table: DataTable, filter: BatchFilterState, speakerChecks: Record<string, boolean>): DataTable {
  const query = filter.query.trim().toLowerCase();

  return {
    ...table,
    rows: table.rows.filter((row) => {
      const speaker = speakerKey(row);
      if (speaker && speakerChecks[speaker] === false) {
        return false;
      }

      if (query && !searchText(row, filter.queryColumns.length > 0 ? filter.queryColumns : table.columns.map((column) => column.key).filter((key) => key !== "index")).includes(query)) {
        return false;
      }

      const status = reviewStatus(row);
      if (status === "edited") {
        return filter.includeEdited;
      }

      if (status === "checked") {
        return filter.includeChecked;
      }

      return filter.includeUnchecked;
    }),
  };
}

export function collectBatchSpeakers(rows: DataTableRow[]): string[] {
  return Array.from(new Set(rows.map(speakerKey).filter(Boolean))).sort((left, right) => left.localeCompare(right, "ko"));
}

export function speakerKey(row: DataTableRow): string {
  const activeStage = (row.raw?.activeStage || row.raw?.active_stage || "").toLowerCase();
  if (activeStage === "diarizing" || activeStage === "preparing_diarization") {
    return "";
  }

  if (row.cells.speaker === "화자구분 중") {
    return "";
  }

  return row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "";
}

function searchText(row: DataTableRow, columns: string[]): string {
  return columns.map((key) => (key === "sourcePath" ? row.sourcePath ?? "" : row.cells[key] ?? row.raw?.[key] ?? "")).join(" ").toLowerCase();
}

function reviewStatus(row: DataTableRow): "unchecked" | "edited" | "checked" {
  const status = (row.cells.qcStatus || row.raw?.qcStatus || row.raw?.qc_status || row.raw?.status || "").toLowerCase();
  if (status.includes("수정") || status.includes("edited")) {
    return "edited";
  }

  if (status.includes("검수됨") || status.includes("checked") || status.includes("completed")) {
    return "checked";
  }

  return "unchecked";
}

