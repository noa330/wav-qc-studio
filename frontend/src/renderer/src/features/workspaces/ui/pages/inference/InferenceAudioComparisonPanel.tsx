import { useEffect } from "react";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceAudioComparisonLayout } from "../../shared/WorkspaceAudioComparisonLayout";
import { WorkspaceEditableAudioPane } from "../../shared/WorkspaceEditableAudioPane";
import {
  InferenceMultiReferenceButton,
  InferenceTranscriptField,
  findAudioRow,
  findDatasetReferenceText,
} from "./InferencePanels";

export function InferenceAudioComparisonPanel({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  const audioPath = state.selectedAudioPath || settings.referenceAudioPath;
  const datasetReferenceText = findDatasetReferenceText(state.inputTree?.nodes ?? [], audioPath);
  const outputAudioPath = state.selectedResultAudioPath || settings.outputAudioPath;

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

  const leftFooter = (
    <InferenceTranscriptField
      label="레퍼런스 대사"
      value={settings.referenceText}
      onChange={updateReferenceText}
    />
  );

  const rightFooter = (
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
  );

  return (
    <WorkspaceAudioComparisonLayout
      leftTourTarget="inference-transcript-card-reference"
      rightTourTarget="inference-transcript-card-output"
      left={(
        <WorkspaceEditableAudioPane
          row={findAudioRow(audioPath)}
          audioPath={audioPath}
          editable
          emptyText="왼쪽 브라우저에서 레퍼런스 오디오를 선택하세요."
          audioEditScopeId={state.activeSheetId}
          layout="compare"
          compareTitle="레퍼런스 오디오"
          compareHeaderAction={<InferenceMultiReferenceButton runtime={runtime} />}
          showRuler={false}
          rulerPosition="bottom"
          customFooter={<div className="flex min-h-0 min-w-0 flex-col">{leftFooter}</div>}
          syncKey="inference:레퍼런스 대사"
        />
      )}
      right={(
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
          customFooter={<div className="flex min-h-0 min-w-0 flex-col">{rightFooter}</div>}
          syncKey="inference:출력 대본"
        />
      )}
    />
  );
}
