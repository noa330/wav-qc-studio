import type { DataTableRow } from "@shared/ipc";
import { WorkspaceEditableAudioPane } from "../../shared/WorkspaceEditableAudioPane";

export function SpeakerAudioComparisonPanel({ row, originalPath, resultPath, audioEditScopeId }: { row?: DataTableRow; originalPath?: string; resultPath?: string; audioEditScopeId?: string }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] grid-rows-[auto_6px_minmax(0,1fr)]">
      <div className="flex items-start">
        <p className="text-[13px] font-normal text-[var(--secondary-text)]">원본 오디오</p>
      </div>
      <div />
      <div className="relative flex items-start">
        <p className="text-[13px] font-normal text-[var(--secondary-text)]">결과 오디오</p>
      </div>
      <div className="row-start-3 min-w-0">
        <WorkspaceEditableAudioPane row={row} audioPath={originalPath} editable emptyText="원본 오디오를 선택하세요." audioEditScopeId={audioEditScopeId} />
      </div>
      <div className="row-start-3" />
      <div className="row-start-3 min-w-0">
        <WorkspaceEditableAudioPane row={row} audioPath={resultPath} editable emptyText="결과 오디오가 아직 없습니다." audioEditScopeId={audioEditScopeId} />
      </div>
    </div>
  );
}
