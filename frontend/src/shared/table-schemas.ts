import type { DataTable, DataTableColumn, WorkspaceId } from "./ipc";

const indexColumn: DataTableColumn = { key: "index", label: "ID" };
const fileNameColumn: DataTableColumn = { key: "fileName", label: "파일명" };
const durationColumn: DataTableColumn = { key: "durationSec", label: "길이(s)" };
const remarksColumn: DataTableColumn = { key: "remarks", label: "비고" };

const fileColumns = [indexColumn, fileNameColumn, durationColumn] as const;

export const workspaceTableColumns: Record<WorkspaceId, DataTableColumn[]> = {
  slice: [
    ...fileColumns,
    { key: "rangeSec", label: "구간" },
    { key: "markerCount", label: "마커" },
    remarksColumn,
  ],
  tagging: [
    ...fileColumns,
    { key: "ngTags", label: "NG 태그" },
    remarksColumn,
  ],
  speaker: [
    ...fileColumns,
    { key: "modelLabel", label: "모델" },
    remarksColumn,
  ],
  overview: [
    ...fileColumns,
    { key: "noise_bak", label: "BAK" },
    { key: "noise_sig", label: "SIG" },
    { key: "noise_ovrl", label: "OVRL" },
    { key: "noise_p808_mos", label: "P808" },
    remarksColumn,
  ],
  batch: [
    ...fileColumns,
    { key: "autoTranscript", label: "자동 전사" },
    { key: "editedTranscript", label: "편집 전사" },
    { key: "speaker", label: "화자" },
    { key: "language", label: "언어" },
    { key: "qcStatus", label: "검수 상태" },
    remarksColumn,
  ],
  training: [
    indexColumn,
    { key: "modelName", label: "모델명" },
    { key: "stage", label: "단계" },
    { key: "epoch", label: "에포크" },
    { key: "step", label: "스텝" },
    { key: "elapsed", label: "걸린 시간" },
    { key: "checkpoint", label: "체크포인트" },
    remarksColumn,
  ],
  inference: [
    indexColumn,
    { key: "modelName", label: "모델명" },
    { key: "mode", label: "모드" },
    { key: "referenceAudio", label: "레퍼런스" },
    { key: "outputAudio", label: "출력" },
    { key: "elapsed", label: "걸린 시간" },
    remarksColumn,
  ],
};

export function createEmptyWorkspaceTable(workspaceId: WorkspaceId): DataTable {
  return {
    columns: workspaceTableColumns[workspaceId],
    rows: [],
  };
}
