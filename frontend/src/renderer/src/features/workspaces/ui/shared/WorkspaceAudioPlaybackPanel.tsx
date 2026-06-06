import type { DataTableRow } from "@shared/ipc";
import { WorkspaceEditableAudioPane } from "./WorkspaceEditableAudioPane";

export function WorkspaceAudioPlaybackPanel({
  row,
  audioPath,
  emptyText = "오디오 행을 선택하세요.",
  syncKey,
  muteIntervals = [],
  muteIntervalsEnabled = false,
  audioEditScopeId,
}: {
  row?: DataTableRow;
  audioPath?: string;
  cropEnabled?: boolean;
  emptyText?: string;
  syncKey?: string;
  muteIntervals?: Array<{ start: number; end: number }>;
  muteIntervalsEnabled?: boolean;
  audioEditScopeId?: string;
}) {
  return (
    <WorkspaceEditableAudioPane
      row={row}
      audioPath={audioPath}
      editable
      emptyText={emptyText}
      syncKey={syncKey}
      muteIntervals={muteIntervals}
      muteIntervalsEnabled={muteIntervalsEnabled}
      audioEditScopeId={audioEditScopeId}
      showRuler={true}
      rulerPosition="top"
      layout="playback"
    />
  );
}
