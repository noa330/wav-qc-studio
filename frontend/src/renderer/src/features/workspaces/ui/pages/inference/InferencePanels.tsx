import type { DataTableRow, FileTreeNode, VoiceInferenceSettings } from "@shared/ipc";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { menuMotion, softPressTap, tightPressTap } from "@/shared/motion";
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

export function InferenceActionControls({ runtime }: { runtime: WorkspaceRuntime }) {
  void runtime;
  return null;
}

export function InferenceMultiReferenceButton({ runtime }: { runtime: WorkspaceRuntime }) {
  const state = runtime.getState("inference");
  const settings = runtime.settings.inference;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [bubbleGeometry, setBubbleGeometry] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    caretTop: number;
  } | null>(null);
  const bubbleOpen = state.inferenceMultiReferenceOpen;

  useEffect(() => {
    if (!bubbleOpen) {
      setBubbleGeometry(null);
      return undefined;
    }

    const updateGeometry = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const gap = 12;
      const viewportPad = 12;
      const preferredWidth = 340;
      const left = Math.min(rect.right + gap, window.innerWidth - viewportPad - 300);
      const width = Math.max(300, Math.min(preferredWidth, window.innerWidth - left - viewportPad));
      const top = Math.max(viewportPad, rect.top - 6);
      const maxHeight = Math.max(96, window.innerHeight - top - viewportPad);
      const caretTop = Math.max(18, Math.min(maxHeight - 18, rect.top + rect.height / 2 - top));

      setBubbleGeometry({ left, top, width, maxHeight, caretTop });
    };

    updateGeometry();
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [bubbleOpen]);

  if (settings.selectedModel !== "gpt-sovits") {
    return null;
  }

  return (
    <span
      className="relative flex-none"
      data-app-tour-target="inference-multi-reference-button"
    >
      <motion.button
        ref={buttonRef}
        type="button"
        aria-pressed={bubbleOpen}
        whileTap={softPressTap}
        onClick={() => runtime.setInferenceMultiReferenceOpen(!bubbleOpen)}
        className="wpf-button flex h-8 flex-none items-center gap-2 whitespace-nowrap px-2.5 text-[12px]"
      >
        다중 참고 오디오
      </motion.button>
      {bubbleGeometry
        ? createPortal(
            <InferenceMultiReferenceBubble
              geometry={bubbleGeometry}
              paths={state.inferenceAuxReferenceAudioPaths}
              onClose={() => runtime.setInferenceMultiReferenceOpen(false)}
              onRemove={(path) => runtime.removeInferenceAuxReferenceAudio(path)}
            />,
            document.body,
          )
        : null}
    </span>
  );
}

function InferenceMultiReferenceBubble({
  geometry,
  paths,
  onClose,
  onRemove,
}: {
  geometry: { left: number; top: number; width: number; maxHeight: number; caretTop: number };
  paths: string[];
  onClose: () => void;
  onRemove: (path: string) => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        key="inference-multi-reference-bubble"
        initial={{ opacity: 0, x: -4, scale: 0.985 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: -4, scale: 0.985 }}
        transition={menuMotion.transition}
        className="fixed z-[2300] rounded-[5px] border border-[var(--terminal-dock-bubble-border)] bg-[var(--terminal-dock-bubble-bg)] px-3 py-3 pr-10 text-[13px] font-normal leading-5 text-[var(--secondary-text)] shadow-[var(--terminal-dock-bubble-shadow)] backdrop-blur"
        style={{
          left: geometry.left,
          top: geometry.top,
          width: geometry.width,
          maxHeight: geometry.maxHeight,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-[4px] text-[var(--control-arrow)] hover:bg-[var(--soft-selection-hover)] hover:text-[var(--primary-text)]"
          aria-label="다중 참고 오디오 닫기"
        >
          <X className="size-3.5" strokeWidth={1.8} />
        </button>
        <div
          className="app-scrollbar min-h-[76px] overflow-auto rounded-[4px] bg-transparent pr-1"
          style={{ maxHeight: Math.max(76, geometry.maxHeight - 24) }}
        >
          <InferenceAuxReferenceChips paths={paths} onRemove={onRemove} />
        </div>
        <span
          aria-hidden="true"
          className="absolute left-[-7px] size-3 rotate-45 border border-r-0 border-t-0 border-[var(--terminal-dock-bubble-border)] bg-[var(--terminal-dock-bubble-bg)]"
          style={{ top: geometry.caretTop }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

function InferenceAuxReferenceChips({ paths, onRemove }: { paths: string[]; onRemove: (path: string) => void }) {
  if (paths.length === 0) {
    return (
      <div className="flex h-full min-h-[76px] items-center text-sm font-normal text-[var(--secondary-text)]">
        선택된 다중 참고 오디오가 없습니다.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap content-start gap-2">
      {paths.map((path) => (
        <span
          key={path}
          title={path}
          className="grid max-w-full min-w-0 grid-cols-[minmax(0,1fr)_16px] items-center gap-1 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] px-2 py-1 font-sans text-[13px] leading-5 text-[var(--primary-text)]"
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
