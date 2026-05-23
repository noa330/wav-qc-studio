import type { DataTable, DataTableColumn, WorkspaceId } from "./ipc";

export const workspaceTableColumns: Record<WorkspaceId, DataTableColumn[]> = {
  slice: [
    { key: "index", label: "ID" },
    { key: "fileName", label: "파일명" },
    { key: "startSec", label: "시작" },
    { key: "endSec", label: "종료" },
    { key: "durationSec", label: "길이" },
    { key: "channels", label: "CH" },
    { key: "markerCount", label: "마커" },
    { key: "status", label: "상태" },
    { key: "outputPath", label: "출력 파일" },
  ],
  tagging: [
    { key: "index", label: "ID" },
    { key: "fileName", label: "파일명" },
    { key: "durationSec", label: "길이" },
    { key: "channels", label: "CH" },
    { key: "ngTags", label: "NG 태그" },
    { key: "status", label: "상태" },
    { key: "outputPath", label: "출력 파일" },
  ],
  speaker: [
    { key: "index", label: "ID" },
    { key: "fileName", label: "파일명" },
    { key: "modelLabel", label: "모델" },
    { key: "status", label: "상태" },
  ],
  overview: [
    { key: "index", label: "ID" },
    { key: "file_name", label: "파일명" },
    { key: "duration_sec", label: "길이" },
    { key: "sample_rate", label: "SR" },
    { key: "channels", label: "CH" },
    { key: "noise_bak", label: "BAK" },
    { key: "noise_sig", label: "SIG" },
    { key: "noise_ovrl", label: "OVRL" },
    { key: "noise_p808_mos", label: "P808" },
    { key: "status", label: "상태" },
    { key: "error", label: "오류" },
  ],
  batch: [
    { key: "index", label: "ID" },
    { key: "fileName", label: "파일명" },
    { key: "audioStatus", label: "오디오 상태" },
    { key: "autoTranscript", label: "자동 전사" },
    { key: "editedTranscript", label: "편집 전사" },
    { key: "speaker", label: "화자" },
    { key: "language", label: "언어" },
    { key: "qcStatus", label: "검수 상태" },
  ],
  training: [
    { key: "index", label: "ID" },
    { key: "modelName", label: "모델명" },
    { key: "stage", label: "단계" },
    { key: "epoch", label: "에포크" },
    { key: "step", label: "스텝" },
    { key: "elapsed", label: "걸린 시간" },
    { key: "checkpoint", label: "체크포인트" },
    { key: "status", label: "상태" },
  ],
  inference: [
    { key: "index", label: "ID" },
    { key: "modelName", label: "모델명" },
    { key: "mode", label: "모드" },
    { key: "referenceAudio", label: "레퍼런스" },
    { key: "outputAudio", label: "출력" },
    { key: "elapsed", label: "걸린 시간" },
    { key: "status", label: "상태" },
  ],
};

export function createEmptyWorkspaceTable(workspaceId: WorkspaceId): DataTable {
  return {
    columns: workspaceTableColumns[workspaceId],
    rows: [],
  };
}
