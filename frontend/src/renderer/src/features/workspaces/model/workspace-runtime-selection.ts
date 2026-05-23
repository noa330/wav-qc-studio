import { AUDIO_INPUT_EXTENSIONS, WAV_AUDIO_EXTENSIONS } from "@shared/ipc";
import type { BatchQcExportJob, DataTable, DataTableRow, FileTreeResult, WorkspaceId } from "@shared/ipc";

export type WorkspaceAudioSelection = {
  selectedFilePath?: string;
  selectedAudioPath?: string;
  selectedResultAudioPath?: string;
};

export const virtualRowPathPrefix = "wqcs://row/";

export function buildBatchJobs(table: DataTable): BatchQcExportJob[] {
  return table.rows.map((row, index) => ({
    id: row.id || `${index + 1}`,
    fileName: row.raw?.file_name || row.raw?.fileName || row.cells.file_name || row.cells.fileName || `row_${index + 1}.wav`,
    originalPath: row.raw?.originalPath || row.raw?.original_path || row.raw?.absolute_path || row.sourcePath || "",
    transcript: row.cells.editedTranscript || row.raw?.editedTranscript || row.raw?.edited_transcript || row.raw?.transcript || row.cells.transcript || "",
    language: row.raw?.language || row.cells.language || "",
    speaker: row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "",
  }));
}

export function resolveAudioSelection(workspaceId: WorkspaceId, row?: DataTableRow, fallbackAudioPath = ""): WorkspaceAudioSelection {
  if (!row) {
    return {
      selectedFilePath: fallbackAudioPath || undefined,
      selectedAudioPath: fallbackAudioPath || undefined,
      selectedResultAudioPath: undefined,
    };
  }

  const raw = row.raw ?? {};
  const originalPath = workspaceId === "slice" || workspaceId === "tagging"
    ? resolveSliceSourcePath(row, fallbackAudioPath)
    : firstNonVirtualPath(
        raw.originalPath,
        raw.original_path,
        raw.absolute_path,
        raw.inputPath,
        raw.input_path,
        workspaceId === "speaker" ? "" : row.sourcePath,
        fallbackAudioPath,
      );
  const resultPath = firstNonVirtualPath(raw.finalOutputPath, raw.sidonOutputPath, raw.resembleOutputPath, raw.voiceFixerOutputPath, raw.outputPath, raw.outputAudioPath, row.sourcePath);

  if (workspaceId === "speaker") {
    return {
      selectedFilePath: firstNonEmpty(originalPath, resultPath) || undefined,
      selectedAudioPath: firstNonEmpty(originalPath, fallbackAudioPath) || undefined,
      selectedResultAudioPath: resultPath || undefined,
    };
  }

  if (workspaceId === "training") {
    const checkpointPath = firstNonVirtualPath(raw.checkpointPath, raw.checkpoint_path, raw.outputPath);
    const datasetPath = firstNonVirtualPath(raw.datasetPath, raw.dataset_path, raw.inputPath, raw.input_path, row.sourcePath);
    return {
      selectedFilePath: firstNonEmpty(checkpointPath, datasetPath, fallbackAudioPath) || undefined,
      selectedAudioPath: isAudioPath(fallbackAudioPath) ? fallbackAudioPath : undefined,
      selectedResultAudioPath: checkpointPath || undefined,
    };
  }

  if (workspaceId === "inference") {
    const referencePath = firstNonVirtualPath(raw.referenceAudioPath, raw.reference_audio_path, fallbackAudioPath);
    const outputPath = firstNonVirtualPath(raw.outputAudioPath, raw.output_audio_path, raw.outputPath, row.sourcePath);
    return {
      selectedFilePath: firstNonEmpty(outputPath, referencePath, fallbackAudioPath) || undefined,
      selectedAudioPath: firstNonEmpty(referencePath, fallbackAudioPath) || undefined,
      selectedResultAudioPath: outputPath || undefined,
    };
  }

  if (workspaceId === "slice") {
    return {
      selectedFilePath: rowSelectionPath(workspaceId, row),
      selectedAudioPath: firstNonEmpty(originalPath, fallbackAudioPath, resultPath) || undefined,
      selectedResultAudioPath: resultPath || undefined,
    };
  }

  if (workspaceId === "tagging") {
    return {
      selectedFilePath: firstNonEmpty(originalPath, resultPath) || undefined,
      selectedAudioPath: firstNonEmpty(originalPath, fallbackAudioPath, resultPath) || undefined,
      selectedResultAudioPath: resultPath || undefined,
    };
  }

  return {
    selectedFilePath: firstNonEmpty(originalPath, resultPath, fallbackAudioPath) || undefined,
    selectedAudioPath: firstNonEmpty(originalPath, fallbackAudioPath, resultPath) || undefined,
    selectedResultAudioPath: resultPath || undefined,
  };
}

export function findRowForPath(rows: DataTableRow[], path: string): DataTableRow | undefined {
  const virtualRowId = parseVirtualRowId(path);
  if (virtualRowId) {
    return rows.find((row) => row.id === virtualRowId);
  }

  const normalizedPath = normalizePath(path);
  const pathName = fileName(path);
  return rows.find((row) => {
    const raw = row.raw ?? {};
    const candidates = [
      row.sourcePath,
      raw.originalPath,
      raw.original_path,
      raw.absolute_path,
      raw.finalOutputPath,
      raw.sidonOutputPath,
      raw.resembleOutputPath,
      raw.voiceFixerOutputPath,
      raw.outputPath,
      raw.outputAudioPath,
      raw.output_audio_path,
      raw.referenceAudioPath,
      raw.reference_audio_path,
      raw.checkpointPath,
      raw.checkpoint_path,
      raw.datasetPath,
      raw.dataset_path,
    ].filter(Boolean);

    const rowIndex = row.raw?.index || row.cells.index || "";
    return (
      candidates.some((candidate) => normalizePath(candidate) === normalizedPath) ||
      fileName(firstNonEmpty(...candidates, row.cells.fileName)) === pathName ||
      Boolean(rowIndex && pathName.startsWith(`${rowIndex.padStart(6, "0")}_`))
    );
  });
}

export function rowSelectionPath(workspaceId: WorkspaceId, row: DataTableRow): string | undefined {
  if (workspaceId === "slice") {
    return `${virtualRowPathPrefix}${encodeURIComponent(row.id)}`;
  }

  const raw = row.raw ?? {};
  if (workspaceId === "inference") {
    return firstNonEmpty(raw.outputAudioPath, raw.output_audio_path, row.sourcePath, raw.referenceAudioPath, raw.reference_audio_path, raw.outputPath) || undefined;
  }
  if (workspaceId === "training") {
    return firstNonEmpty(raw.checkpointPath, raw.checkpoint_path, row.sourcePath, raw.datasetPath, raw.dataset_path, raw.outputPath) || undefined;
  }
  return firstNonEmpty(raw.originalPath, raw.original_path, raw.absolute_path, raw.inputPath, raw.input_path, row.sourcePath, raw.outputPath, raw.outputAudioPath, raw.output_audio_path, raw.referenceAudioPath, raw.reference_audio_path, raw.checkpointPath, raw.checkpoint_path, raw.datasetPath, raw.dataset_path) || undefined;
}

export function findFirstAudioPath(tree?: FileTreeResult): string {
  if (!tree) {
    return "";
  }

  const stack = [...tree.nodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }

    if (node.kind === "file" && isAudioPath(node.path)) {
      return node.path;
    }

    if (node.children) {
      stack.push(...node.children);
    }
  }

  return "";
}

export function resolveSliceSourcePath(row?: DataTableRow, fallbackAudioPath = ""): string {
  const raw = row?.raw ?? {};
  return firstNonVirtualPath(
    raw.originalPath,
    raw.original_path,
    raw.inputPath,
    raw.input_path,
    raw.absolute_path,
    row?.sourcePath,
    fallbackAudioPath,
  );
}

export function resolveSliceSourceIdentity(row?: DataTableRow, fallbackAudioPath = ""): string {
  return normalizePath(resolveSliceSourcePath(row, fallbackAudioPath));
}

export function firstNonVirtualPath(...values: Array<string | undefined>): string {
  return values.find((value) => {
    const trimmed = value?.trim();
    return Boolean(trimmed && !isVirtualRowPath(trimmed));
  })?.trim() ?? "";
}

export function isVirtualRowPath(path: string | undefined): boolean {
  return (path ?? "").trim().toLowerCase().startsWith(virtualRowPathPrefix);
}

export function isAudioPath(path: string): boolean {
  return AUDIO_INPUT_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));
}

export function isWavPath(path: string): boolean {
  return WAV_AUDIO_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));
}

export function wavCacheFileNameKey(path: string): string {
  const name = fileName(path);
  const dotIndex = name.lastIndexOf(".");
  return `${dotIndex > 0 ? name.slice(0, dotIndex) : name}.wav`;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").toLowerCase();
}

function fileName(path: string | undefined): string {
  const parts = (path ?? "").split(/[\\/]/u).filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function parseVirtualRowId(path: string): string {
  if (!path.startsWith(virtualRowPathPrefix)) {
    return "";
  }

  return decodeURIComponent(path.slice(virtualRowPathPrefix.length));
}
