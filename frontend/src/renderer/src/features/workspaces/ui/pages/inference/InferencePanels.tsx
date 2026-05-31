import type { DataTableRow, FileTreeNode, VoiceInferenceSettings } from "@shared/ipc";
import { useEffect, type ReactNode } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/shared/components/controls";
import { softPressTap, tightPressTap } from "@/shared/motion";
import { normalizeInferenceReferencePath } from "../../../model/inference-reference-selection";
import type { WorkspaceRuntime } from "../../../state/use-workspace-runtime";
import { ModelSelectionPanel, ModelOptionItem } from "../../shared/workspace-panel-primitives";
export { InferenceSettingsBody } from "./InferenceSettingsBody";

export function InferenceModelBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const selectModel = (selectedModel: VoiceInferenceSettings["selectedModel"]) => {
    if (selectedModel !== "gpt-sovits") {
      runtime.setInferenceMultiReferenceOpen(false);
    }
    runtime.setSettings((current) => ({
      ...current,
      inference: { ...current.inference, selectedModel },
      training: { ...current.training, selectedModel },
    }));
  };

  const options: ModelOptionItem<VoiceInferenceSettings["selectedModel"]>[] = [
    {
      value: "gpt-sovits",
      title: "GPT-SoVITS",
      description: "공식 GPT-SoVITS TTS 파이프라인으로 제로샷 레퍼런스 오디오와 체크포인트 가중치를 사용합니다.",
      badgeText: "추론 지원",
      badgeType: "purple",
      tags: ["음성 합성", "제로샷"],
    },
    {
      value: "omnivoice",
      title: "OmniVoice",
      description: "공식 OmniVoice CLI 추론으로 제로샷 음성 복제, 보이스 디자인, 파인튜닝 체크포인트를 사용합니다.",
      badgeText: "추론 지원",
      badgeType: "blue",
      tags: ["보이스 복제", "대형 모델"],
    },
  ];

  return (
    <ModelSelectionPanel
      title="추론 모델"
      subtitle="추론에 사용할 모델을 선택하세요."
      options={options}
      selectedValue={settings.selectedModel}
      onSelect={selectModel}
      helpText="모델에 대한 자세한 정보는 도움말을 참고하세요."
      helpHref="https://github.com"
    />
  );
}

export function InferenceBatchModeToggle({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const state = runtime.getState("inference");
  const setBatchMode = (enabled: boolean) => {
    runtime.setSettings((current) => {
      const inferenceRunMode: VoiceInferenceSettings["inferenceRunMode"] = enabled ? "batch" : "single";
      const seedBatchPaths = enabled && current.inference.batchReferenceAudioPaths.length === 0 && state.selectedAudioPath
        ? [state.selectedAudioPath]
        : current.inference.batchReferenceAudioPaths;
      return {
        ...current,
        inference: {
          ...current.inference,
          inferenceRunMode,
          batchReferenceAudioPaths: seedBatchPaths,
        },
      };
    });
  };

  return (
    <span className="flex min-w-max shrink-0 items-center gap-2" data-app-tour-target="inference-batch-mode-toggle">
      <ToggleSwitch checked={settings.inferenceRunMode === "batch"} onChange={setBatchMode} />
      <span className="text-sm text-[var(--primary-text)]">일괄 추론</span>
    </span>
  );
}

export function InferenceReferenceHeaderControl({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  if (settings.selectedModel !== "gpt-sovits") {
    return <InferenceBatchModeToggle runtime={runtime} />;
  }

  return (
    <>
      <InferenceBatchModeToggle runtime={runtime} />
      <motion.button
        type="button"
        aria-pressed={state.inferenceMultiReferenceOpen}
        whileTap={softPressTap}
        onClick={() => runtime.setInferenceMultiReferenceOpen(!state.inferenceMultiReferenceOpen)}
        data-app-tour-target="inference-multi-reference-button"
        className="wpf-button flex h-8 items-center gap-2 px-3 text-[13px]"
      >
        {state.inferenceMultiReferenceOpen ? "다중 참고 오디오 닫기" : "다중 참고 오디오 넣기"}
      </motion.button>
    </>
  );
}

export function InferenceAuxReferenceField({ paths, onRemove }: { paths: string[]; onRemove: (path: string) => void }) {
  return (
    <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,clamp(58px,34%,112px))_minmax(0,1fr)] items-stretch gap-2">
      <label className="min-w-0 pt-[9px] text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]">다중 참고오디오</label>
      <div className="wpf-field app-scrollbar h-full min-h-0 min-w-0 overflow-auto px-2 py-2">
        {paths.length > 0 ? (
          <div className="flex min-w-0 flex-wrap content-start gap-2">
            {paths.map((path) => (
              <span
                key={path}
                title={path}
                className="grid max-w-full min-w-0 grid-cols-[minmax(0,1fr)_16px] items-center gap-1 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] px-2 py-1 text-[13px] leading-5 text-[var(--primary-text)]"
              >
                <span className="min-w-0 truncate">{fileName(path)}</span>
                <motion.button
                  type="button"
                  aria-label={`${fileName(path)} 제거`}
                  title="제거"
                  whileTap={tightPressTap}
                  onClick={() => onRemove(path)}
                  className="flex size-4 items-center justify-center text-[var(--secondary-text)] hover:text-[var(--primary-text)]"
                >
                  <X className="size-3" strokeWidth={1.9} />
                </motion.button>
              </span>
            ))}
          </div>
        ) : (
          <p className="px-1 py-0.5 text-sm text-[var(--secondary-text)]">선택된 다중 참고 오디오가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

export function InferenceTranscriptField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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

export function findAudioRow(audioPath?: string): DataTableRow | undefined {
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

export function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() || path;
}

export function findDatasetReferenceText(nodes: FileTreeNode[], audioPath?: string): string {
  const target = normalizeInferenceReferencePath(audioPath ?? "");
  if (!target) {
    return "";
  }

  for (const node of nodes) {
    if (normalizeInferenceReferencePath(node.path) === target) {
      return node.dataset?.text?.trim() ?? "";
    }
    const childText = node.children ? findDatasetReferenceText(node.children, audioPath) : "";
    if (childText) {
      return childText;
    }
  }
  return "";
}
