import type { DataTableRow, VoiceInferenceSettings } from "@shared/ipc";
import { useEffect } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { softPressTap } from "@/shared/motion";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { WorkspaceAudioPlaybackPanel } from "../../shared/WorkspaceAudioPlaybackPanel";
export { InferenceSettingsBody } from "./InferenceSettingsBody";

const modelOptions = [
  { value: "gpt-sovits", title: "GPT-SoVITS", subtitle: "공식 GPT-SoVITS TTS 파이프라인으로 제로샷 레퍼런스 오디오와 체크포인트 가중치를 사용합니다." },
  { value: "omnivoice", title: "OmniVoice", subtitle: "공식 OmniVoice CLI 추론으로 제로샷 음성 복제, 보이스 디자인, 파인튜닝 체크포인트를 사용합니다." },
] as const;

export function InferenceModelBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const selectModel = (selectedModel: VoiceInferenceSettings["selectedModel"]) => {
    runtime.setSettings((current) => ({
      ...current,
      inference: { ...current.inference, selectedModel },
      training: { ...current.training, selectedModel },
    }));
  };

  return (
    <div className="app-scrollbar h-full min-h-0 min-w-0 space-y-3 overflow-auto pr-1">
      {modelOptions.map((option) => (
        <motion.button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={settings.selectedModel === option.value}
          onClick={() => selectModel(option.value)}
          whileTap={softPressTap}
          className={cn(
            "grid w-full min-w-0 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-[5px] bg-transparent px-2 py-2.5 text-left transition-[background-color,border-color] focus-visible:outline-none",
            settings.selectedModel === option.value
              ? "border-2 border-[var(--nav-selected-bg)]"
              : "border border-[var(--panel-stroke)] hover:bg-[var(--soft-selection-hover)] focus-visible:border-2 focus-visible:border-[var(--nav-selected-bg)] focus-visible:bg-[var(--soft-selection-hover)]",
          )}
        >
          <span className={cn("relative size-[18px] rounded-full border border-[var(--panel-stroke)]", settings.selectedModel === option.value && "border-[var(--accent-blue)]")}>
            {settings.selectedModel === option.value ? <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-blue)]" /> : null}
          </span>
          <div className="min-w-0">
            <span className="text-sm font-normal text-[var(--primary-text)]">{option.title}</span>
            <p className="mt-1 text-[13px] leading-[18px] text-[var(--secondary-text)]">{option.subtitle}</p>
          </div>
        </motion.button>
      ))}
    </div>
  );
}

export function InferenceReferenceBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  const audioPath = state.selectedAudioPath || settings.referenceAudioPath;
  useEffect(() => {
    if (!audioPath || audioPath === settings.referenceAudioPath) {
      return;
    }
    runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, referenceAudioPath: audioPath } }));
  }, [audioPath, runtime, settings.referenceAudioPath]);

  return (
    <AudioTranscriptCard
      row={findAudioRow(audioPath)}
      audioPath={audioPath}
      emptyText="왼쪽 브라우저에서 레퍼런스 오디오를 선택하세요."
      label="레퍼런스 대사"
      value={settings.referenceText}
      onChange={(value) => runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, referenceText: value } }))}
    />
  );
}

export function InferenceOutputBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const state = runtime.getState("inference");
  const outputAudioPath = state.selectedResultAudioPath || settings.outputAudioPath;

  return (
    <AudioTranscriptCard
      row={findAudioRow(outputAudioPath)}
      audioPath={outputAudioPath}
      emptyText="추론을 실행하면 출력 오디오가 생성됩니다."
      label="출력 대본"
      value={settings.outputText}
      onChange={(value) => runtime.setSettings((current) => ({ ...current, inference: { ...current.inference, outputText: value } }))}
    />
  );
}

function AudioTranscriptCard({
  row,
  audioPath,
  emptyText,
  label,
  value,
  onChange,
}: {
  row?: DataTableRow;
  audioPath?: string;
  emptyText: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[calc(50%+12.5px)_auto_minmax(0,calc(50%-37.5px))]">
      <div className="min-h-0 min-w-0 overflow-hidden">
        <WorkspaceAudioPlaybackPanel row={row} audioPath={audioPath} emptyText={emptyText} syncKey={`inference:${label}`} />
      </div>
      <div className="my-3 h-px shrink-0 bg-[var(--panel-stroke)]" />
      <InferenceTranscriptField label={label} value={value} onChange={onChange} />
    </div>
  );
}

function InferenceTranscriptField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,clamp(58px,34%,112px))_minmax(0,1fr)] items-stretch gap-2">
      <label className="min-w-0 pt-[9px] text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">{label}</label>
      <textarea
        className="wpf-field app-scrollbar h-full min-h-0 min-w-0 resize-none overflow-auto px-3 py-2 text-sm leading-5 text-[var(--primary-text)] outline-none"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function findAudioRow(audioPath?: string): DataTableRow | undefined {
  if (!audioPath) {
    return undefined;
  }
  const name = audioPath.split(/[\\/]/u).pop() ?? audioPath;
  return {
    id: audioPath,
    sourcePath: audioPath,
    raw: { fileName: name, originalPath: audioPath },
    cells: { index: "1", fileName: name },
  };
}
