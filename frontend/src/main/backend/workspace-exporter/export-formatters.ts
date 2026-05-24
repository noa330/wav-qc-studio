import type { DataTable, DataTableColumn, WorkspaceExportRequest } from "@shared/ipc";
import { formatExportStatus } from "./export-paths";
import type { ExportRowOutcome } from "./types";

export function buildCsv(table: DataTable, outcomes: ExportRowOutcome[]): string {
  const columns = insertPathColumn(table.columns);
  const lines = [columns.map((column) => escapeCsv(column.label)).join(",")];
  const outcomeByRowId = new Map(outcomes.map((outcome) => [outcome.row.id, outcome]));

  for (const row of table.rows) {
    const outcome = outcomeByRowId.get(row.id);
    lines.push(
      columns
        .map((column) => {
          if (column.key === "__exportPath") {
            return escapeCsv(outcome?.outputPath ?? "");
          }

          return escapeCsv(row.cells[column.key] ?? row.raw?.[column.key] ?? "");
        })
        .join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}

function insertPathColumn(columns: DataTableColumn[]): DataTableColumn[] {
  const pathColumn: DataTableColumn = { key: "__exportPath", label: "寃쎈줈" };
  const fileNameIndex = columns.findIndex((column) => column.key === "fileName" || column.key === "file_name");
  if (fileNameIndex < 0) {
    return [pathColumn, ...columns];
  }

  return [...columns.slice(0, fileNameIndex + 1), pathColumn, ...columns.slice(fileNameIndex + 1)];
}

export function buildLog(request: WorkspaceExportRequest, outcomes: ExportRowOutcome[], sessionPath: string, csvPath: string): string {
  const copied = outcomes.filter((outcome) => outcome.copied);
  const checked = outcomes.filter((outcome) => outcome.includeAudio);
  const unchecked = outcomes.filter((outcome) => !outcome.includeAudio);
  const lines = [
    `WAV QC Studio export`,
    `Workspace: ${request.workspaceId}`,
    `Input: ${request.paths.inputPath}`,
    `Output: ${sessionPath}`,
    `CSV: ${csvPath}`,
    `Rows: ${outcomes.length}`,
    `Audio: ${checked.length}`,
    `NG: ${unchecked.length}`,
    `Copied: ${copied.length}`,
    "",
  ];

  for (const [index, outcome] of outcomes.entries()) {
    const bucket = outcome.includeAudio ? "audio" : "ng";
    const status = outcome.copied ? formatExportStatus(outcome) : `FAILED ${outcome.error ?? ""}`.trim();
    lines.push(`${index + 1}. [${status}] ${bucket} | ${outcome.sourcePath || "-"} -> ${outcome.outputPath || "-"}`);
  }

  return `${lines.join("\r\n")}\r\n`;
}

function escapeCsv(value: string): string {
  if (!/[",\r\n]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '""')}"`;
}
