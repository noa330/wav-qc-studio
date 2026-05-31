import { useEffect } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceEditableAudioPane } from "../../shared/WorkspaceEditableAudioPane";
import {
  InferenceAuxReferenceField,
  InferenceTranscriptField,
  findAudioRow,
  findDatasetReferenceText,
} from "./InferencePanels";

export function InferenceAudioComparisonPanel({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;

  // Left (Reference) Paths & Texts
  const audioPath = state.selectedAudioPath || settings.referenceAudioPath;
  const datasetReferenceText = findDatasetReferenceText(state.inputTree?.nodes ?? [], audioPath);
  const showMultiReferenceList = settings.selectedModel === "gpt-sovits" && state.inferenceMultiReferenceOpen;

  // Right (Output) Paths
  const outputAudioPath = state.selectedResultAudioPath || settings.outputAudioPath;

  // Sync Dataset Reference Text to Input selection
  useEffect(() => {
    if (!audioPath) {
      return;
    }
    if (audioPath === settings.referenceAudioPath && (!datasetReferenceText || settings.referenceText.trim())) {
      return;
    }
    runtime.setSettings((current) => {
      const nextReferenceText = datasetReferenceText && (audioPath !== current.inference.referenceAudioPath || !current.inference.referenceText.trim())
        ? datasetReferenceText
        : current.inference.referenceText;
      return {
        ...current,
        inference: {
          ...current.inference,
          referenceAudioPath: audioPath,
          referenceText: nextReferenceText,
          referenceTextsByAudioPath: nextReferenceText.trim()
            ? { ...current.inference.referenceTextsByAudioPath, [audioPath]: nextReferenceText }
            : current.inference.referenceTextsByAudioPath,
        },
      };
    });
  }, [audioPath, datasetReferenceText, runtime, settings.referenceAudioPath, settings.referenceText]);

  const updateReferenceText = (value: string) => {
    runtime.setSettings((current) => ({
      ...current,
      inference: {
        ...current.inference,
        referenceText: value,
        referenceTextsByAudioPath: audioPath
          ? { ...current.inference.referenceTextsByAudioPath, [audioPath]: value }
          : current.inference.referenceTextsByAudioPath,
      },
    }));
  };

  // Custom Footers with Divider integrated
  const leftFooter = (
    <div className="flex flex-col min-w-0 min-h-0 w-full">
      {showMultiReferenceList ? (
        <InferenceAuxReferenceField
          paths={state.inferenceAuxReferenceAudioPaths}
          onRemove={(path) => runtime.removeInferenceAuxReferenceAudio(path)}
        />
      ) : (
        <InferenceTranscriptField
          label="레퍼런스 대사"
          value={settings.referenceText}
          onChange={updateReferenceText}
        />
      )}
    </div>
  );

  const rightFooter = (
    <div className="flex flex-col min-w-0 min-h-0 w-full">
      <InferenceTranscriptField
        label="출력 대본"
        value={settings.outputText}
        onChange={(value) =>
          runtime.setSettings((current) => ({
            ...current,
            inference: { ...current.inference, outputText: value },
          }))
        }
      />
    </div>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] relative">
      
      {/* Left Card: Reference Audio */}
      <div 
        className="min-w-0 border border-[var(--panel-stroke)] bg-[var(--card-bg)] rounded-[6px] p-4 flex flex-col h-full min-h-0"
        data-app-tour-target="inference-transcript-card-reference"
      >
        <WorkspaceEditableAudioPane
          row={findAudioRow(audioPath)}
          audioPath={audioPath}
          editable
          emptyText="왼쪽 브라우저에서 레퍼런스 오디오를 선택하세요."
          audioEditScopeId={state.activeSheetId}
          layout="compare"
          compareTitle="레퍼런스 오디오"
          showRuler={false}
          rulerPosition="bottom"
          customFooter={leftFooter}
          syncKey="inference:레퍼런스 대사"
        />
      </div>

      {/* Center Divider with Arrow Button */}
      <div className="flex items-center justify-center relative">
        <div className="absolute size-9 rounded-full bg-[var(--card-bg)] border border-[var(--panel-stroke)] flex items-center justify-center shadow-[var(--compare-arrow-shadow)] z-10 text-[var(--secondary-text)]">
          <ArrowLeftRight className="size-4" />
        </div>
      </div>

      {/* Right Card: Output Audio */}
      <div 
        className="min-w-0 border border-[var(--panel-stroke)] bg-[var(--card-bg)] rounded-[6px] p-4 flex flex-col h-full min-h-0"
        data-app-tour-target="inference-transcript-card-output"
      >
        <WorkspaceEditableAudioPane
          row={findAudioRow(outputAudioPath)}
          audioPath={outputAudioPath}
          editable
          emptyText="추론을 실행하면 출력 오디오가 생성됩니다."
          audioEditScopeId={state.activeSheetId}
          layout="compare"
          compareTitle="출력 오디오"
          showRuler={false}
          rulerPosition="bottom"
          customFooter={rightFooter}
          syncKey="inference:출력 대본"
        />
      </div>

    </div>
  );
}
