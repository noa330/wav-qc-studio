import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ChartNoAxesColumnIncreasing, RefreshCw, X } from "lucide-react";
import type { TensorBoardSessionResult, VoiceTrainingSettings } from "@shared/ipc";
import { cn } from "@/lib/utils";
import { studioBackend } from "@/services/studio-backend";
import { dialogPanelMotion, menuMotion, softPressTap, tightPressTap } from "@/shared/motion";

type TensorBoardPanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; session: TensorBoardSessionResult }
  | { status: "error"; error: string; logDir?: string };

export function VoiceTensorBoardDialog({ settings, autoStart = true, onClose }: { settings: VoiceTrainingSettings; autoStart?: boolean; onClose: () => void }) {
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={menuMotion.transition} className="fixed inset-0 z-[1200] flex items-center justify-center bg-[#05080dcc] px-6 py-6">
      <motion.div {...dialogPanelMotion} data-app-tour-target="training-tensorboard-dialog" className="flex h-[min(780px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] min-h-0 flex-col rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--panel-bg)] p-5 shadow-[var(--app-dialog-shadow)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]">
              <ChartNoAxesColumnIncreasing className="size-4" strokeWidth={1.8} />
            </span>
            <h4 className="min-w-0 truncate text-base font-semibold leading-5 text-[var(--primary-text)]">TensorBoard</h4>
          </div>
          <motion.button type="button" onClick={onClose} whileTap={tightPressTap} className="flex size-8 shrink-0 items-center justify-center rounded-[5px] bg-[var(--table-header-bg)] text-[var(--primary-text)]" aria-label="닫기">
            <X className="size-4" />
          </motion.button>
        </div>
        <div className="min-h-0 flex-1">
          <VoiceTensorBoardBody settings={settings} autoStart={autoStart} />
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function VoiceTensorBoardBody({ settings, autoStart = false }: { settings: VoiceTrainingSettings; autoStart?: boolean }) {
  const [state, setState] = useState<TensorBoardPanelState>({ status: "idle" });
  const requestKey = useMemo(() => [
    settings.selectedModel,
    settings.toolRoot,
    settings.modelName,
    settings.gptVersion,
  ].join("\u001f"), [settings.gptVersion, settings.modelName, settings.selectedModel, settings.toolRoot]);
  const lastStartedKeyRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    const startedKey = requestKey;
    lastStartedKeyRef.current = startedKey;
    setState({ status: "loading" });

    try {
      const session = await studioBackend.startTensorBoard({ settings });
      if (lastStartedKeyRef.current !== startedKey) {
        return;
      }
      if (session.ok && session.url) {
        setState({ status: "ready", session });
        return;
      }
      setState({ status: "error", error: session.error ?? "TensorBoard could not be started.", logDir: session.logDir });
    } catch (error) {
      if (lastStartedKeyRef.current === startedKey) {
        setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [requestKey, settings]);

  useEffect(() => {
    setState({ status: "idle" });
    lastStartedKeyRef.current = null;
  }, [requestKey]);

  useEffect(() => {
    if (autoStart) {
      void start();
    }
  }, [autoStart, start]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--field-bg)]">
        {state.status === "ready" && state.session.url ? (
          <iframe
            key={state.session.url}
            title="TensorBoard"
            src={state.session.url}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <TensorBoardEmptyState state={state} onStart={start} />
        )}
      </div>
    </div>
  );
}

function TensorBoardEmptyState({ state, onStart }: { state: TensorBoardPanelState; onStart: () => void }) {
  const isError = state.status === "error";
  return (
    <div className="flex h-full min-h-[180px] min-w-0 flex-col items-center justify-center gap-3 px-4 text-center">
      <div className={cn("text-[13px] leading-5", isError ? "text-[#ff8c96]" : "text-[var(--secondary-text)]")}>
        {state.status === "loading"
          ? "TensorBoard를 시작하는 중입니다."
          : isError
            ? state.error
            : "선택한 모델의 TensorBoard 그래프를 불러옵니다."}
      </div>
      {isError && state.logDir ? (
        <div className="max-w-full truncate text-[13px] font-normal leading-[18px] text-[var(--secondary-text)]" title={state.logDir}>{state.logDir}</div>
      ) : null}
      {state.status !== "loading" ? (
        <motion.button
          type="button"
          whileTap={softPressTap}
          onClick={onStart}
          className="flex min-h-[32px] items-center gap-2 rounded-[5px] border border-[var(--panel-stroke)] bg-[var(--table-header-bg)] px-3 text-sm font-normal text-[var(--primary-text)] hover:bg-[var(--soft-selection-hover)]"
        >
          <RefreshCw className="size-4" strokeWidth={1.8} />
          <span>다시 열기</span>
        </motion.button>
      ) : null}
    </div>
  );
}
