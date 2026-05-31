import type { DataTableRow } from "@shared/ipc";
import { ArrowLeftRight } from "lucide-react";
import { WorkspaceEditableAudioPane } from "../../shared/WorkspaceEditableAudioPane";

export function SpeakerAudioComparisonPanel({ 
  row, 
  originalPath, 
  resultPath, 
  audioEditScopeId 
}: { 
  row?: DataTableRow; 
  originalPath?: string; 
  resultPath?: string; 
  audioEditScopeId?: string 
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] relative" data-app-tour-target="speaker-audio-compare-panes">
      
      {/* Left Card: Original Audio */}
      <div className="min-w-0 border border-[var(--panel-stroke)] bg-[var(--card-bg)] rounded-[6px] p-4 flex flex-col h-full min-h-0">
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
        />
      </div>

      {/* Center Divider with Arrow Button */}
      <div className="flex items-center justify-center relative">
        <div className="absolute size-9 rounded-full bg-[var(--card-bg)] border border-[var(--panel-stroke)] flex items-center justify-center shadow-[var(--compare-arrow-shadow)] z-10 text-[var(--secondary-text)]">
          <ArrowLeftRight className="size-4" />
        </div>
      </div>

      {/* Right Card: Result Audio */}
      <div className="min-w-0 border border-[var(--panel-stroke)] bg-[var(--card-bg)] rounded-[6px] p-4 flex flex-col h-full min-h-0">
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
        />
      </div>

    </div>
  );
}
