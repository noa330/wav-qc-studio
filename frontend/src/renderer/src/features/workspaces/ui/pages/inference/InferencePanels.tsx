import type { DataTableRow, FileTreeNode, VoiceInferenceSettings } from "@shared/ipc";
import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkPopMotion, softPressTap, tightPressTap } from "@/shared/motion";
import { collectInferenceReferenceAudioNodes, normalizeInferenceReferencePath, setInferenceReferencePathsChecked } from "../../../model/inference-reference-selection";
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
    if (selectedModel !== "gpt-sovits") {
      runtime.setInferenceMultiReferenceOpen(false);
    }
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

export function InferenceBrowserHeaderControls({ runtime }: { runtime: WorkspaceRuntime }) {
  const settings = runtime.settings.inference;
  const state = runtime.getState("inference");
  const visibleReferenceNodes = collectInferenceReferenceAudioNodes(state.inputTree?.nodes ?? []);
  const checkedPathSet = new Set(settings.batchReferenceAudioPaths.map(normalizeInferenceReferencePath));
  const allVisibleChecked = visibleReferenceNodes.length > 0 && visibleReferenceNodes.every((node) => checkedPathSet.has(normalizeInferenceReferencePath(node.path)));
  const showBatchSelector = settings.inferenceRunMode === "batch";
  const setMode = (inferenceRunMode: VoiceInferenceSettings["inferenceRunMode"]) => {
    runtime.setSettings((current) => {
      const seedBatchPaths = inferenceRunMode === "batch" && current.inference.batchReferenceAudioPaths.length === 0 && state.selectedAudioPath
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
  const setVisibleChecked = (checked: boolean) => {
    runtime.setSettings((current) => ({
      ...current,
      inference: {
        ...current.inference,
        batchReferenceAudioPaths: setInferenceReferencePathsChecked(
          current.inference.batchReferenceAudioPaths,
          visibleReferenceNodes.map((node) => node.path),
          checked,
        ),
      },
    }));
  };

  return (
    <div className="mt-3 flex h-8 min-w-0 items-center gap-2" data-app-tour-target="inference-browser-run-mode">
      {showBatchSelector ? (
        <div className="flex min-w-0 shrink items-center gap-2 text-sm font-normal text-[var(--secondary-text)]">
          <HeaderCheckButton
            checked={allVisibleChecked}
            disabled={visibleReferenceNodes.length === 0}
            ariaLabel="표시된 오디오 전체 선택"
            onToggle={() => setVisibleChecked(!allVisibleChecked)}
          />
          <span className="min-w-0 truncate">선택 {settings.batchReferenceAudioPaths.length}개</span>
        </div>
      ) : null}
      <div className={cn(
        "grid h-8 grid-cols-2 overflow-hidden rounded-[5px] border border-[var(--panel-stroke)]",
        showBatchSelector ? "ml-auto min-w-[168px] shrink-0" : "w-full min-w-0",
      )}>
        {[
          { value: "single", label: "단일 추론" },
          { value: "batch", label: "일괄 추론" },
        ].map((item) => (
          <motion.button
            key={item.value}
            type="button"
            aria-pressed={settings.inferenceRunMode === item.value}
            onClick={() => setMode(item.value as VoiceInferenceSettings["inferenceRunMode"])}
            whileTap={softPressTap}
            className={cn(
              "min-w-0 px-3 text-sm font-normal leading-5 text-[var(--secondary-text)] transition-[background-color,color]",
              settings.inferenceRunMode === item.value && "bg-[var(--accent-blue)] text-[var(--primary-text)]",
              settings.inferenceRunMode !== item.value && "hover:text-[var(--primary-text)]",
            )}
          >
            {item.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function HeaderCheckButton({ checked, disabled = false, ariaLabel, onToggle }: { checked: boolean; disabled?: boolean; ariaLabel: string; onToggle: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      whileTap={disabled ? undefined : tightPressTap}
      onClick={onToggle}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border border-[var(--secondary-text)]",
        checked && "border-[var(--accent-blue)] bg-[var(--accent-blue)]",
        disabled && "opacity-45",
      )}
    >
      <AnimatePresence initial={false}>
        {checked ? (
          <motion.span {...checkPopMotion}>
            <Check className="size-3 text-[var(--primary-text)]" strokeWidth={1.9} />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}

export function InferenceReferenceHeaderControl({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  if (settings.selectedModel !== "gpt-sovits") {
    return null;
  }

  return (
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
  );
}

export function InferenceReferenceBody({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  const audioPath = state.selectedAudioPath || settings.referenceAudioPath;
  const datasetReferenceText = findDatasetReferenceText(state.inputTree?.nodes ?? [], audioPath);
  const showMultiReferenceList = settings.selectedModel === "gpt-sovits" && state.inferenceMultiReferenceOpen;
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

  return (
    <AudioTranscriptCard
      row={findAudioRow(audioPath)}
      audioPath={audioPath}
      emptyText="왼쪽 브라우저에서 레퍼런스 오디오를 선택하세요."
      label="레퍼런스 대사"
      value={settings.referenceText}
      onChange={updateReferenceText}
      field={showMultiReferenceList ? (
        <InferenceAuxReferenceField
          paths={state.inferenceAuxReferenceAudioPaths}
          onRemove={(path) => runtime.removeInferenceAuxReferenceAudio(path)}
        />
      ) : undefined}
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
  field,
}: {
  row?: DataTableRow;
  audioPath?: string;
  emptyText: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  field?: ReactNode;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-rows-[calc(50%+12.5px)_auto_minmax(0,calc(50%-37.5px))]" data-app-tour-target={`inference-transcript-card-${label === "레퍼런스 대사" ? "reference" : "output"}`}>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <WorkspaceAudioPlaybackPanel row={row} audioPath={audioPath} emptyText={emptyText} syncKey={`inference:${label}`} />
      </div>
      <div className="my-3 h-px shrink-0 bg-[var(--panel-stroke)]" />
      {field ?? <InferenceTranscriptField label={label} value={value} onChange={onChange} />}
    </div>
  );
}

function InferenceAuxReferenceField({ paths, onRemove }: { paths: string[]; onRemove: (path: string) => void }) {
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

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() || path;
}

function findDatasetReferenceText(nodes: FileTreeNode[], audioPath?: string): string {
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
