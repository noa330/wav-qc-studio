import type { DataTableRow, WorkspaceExportProgressEvent } from "@shared/ipc";

export type ExportRowOutcome = {
  row: DataTableRow;
  includeAudio: boolean;
  sourcePath: string;
  outputPath: string;
  copied: boolean;
  mutedIntervals?: number;
  error?: string;
};

export type WorkspaceExportProgressHandler = (progress: WorkspaceExportProgressEvent) => void;
