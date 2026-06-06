import type { DataTableRow } from "@shared/ipc";
import { WorkspaceAudioComparisonLayout } from "../../shared/WorkspaceAudioComparisonLayout";
import { WorkspaceEditableAudioPane } from "../../shared/WorkspaceEditableAudioPane";

export function SpeakerAudioComparisonPanel({
  row,
  originalPath,
  resultPath,
  audioEditScopeId,
}: {
  row?: DataTableRow;
  originalPath?: string;
  resultPath?: string;
  audioEditScopeId?: string;
}) {
  return (
    <WorkspaceAudioComparisonLayout
      rootTourTarget="speaker-audio-compare-panes"
      left={(
        <WorkspaceEditableAudioPane
          row={row}
          audioPath={originalPath}
          editable
          emptyText="원본 오디오를 선택하세요."
          audioEditScopeId={audioEditScopeId}
          layout="compare"
          compareTitle="원본 오디오"
          showRuler={false}
          rulerPosition="bottom"
          syncKey="speaker:원본 오디오"
        />
      )}
      right={(
        <WorkspaceEditableAudioPane
          row={row}
          audioPath={resultPath}
          editable
          emptyText="결과 오디오가 아직 없습니다."
          audioEditScopeId={audioEditScopeId}
          layout="compare"
          compareTitle="결과 오디오"
          showRuler={false}
          rulerPosition="bottom"
          syncKey="speaker:결과 오디오"
        />
      )}
    />
  );
}
