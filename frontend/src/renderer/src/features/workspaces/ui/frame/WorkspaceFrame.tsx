import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Terminal, X } from "lucide-react";
import type { WorkspaceId } from "@shared/ipc";
import { useAppPersistence } from "@/app/app-persistence";
import { menuMotion, softPressTap, workspaceContentMotion } from "@/shared/motion";
import { WorkspaceCenterPanels, WorkspaceRightPanels } from "../layout/workspace-page-layouts";
import { defaultOuterLayoutSizes, fitOuterLayoutSizes, outerPanelMin, type WorkspaceOuterLayoutSizes } from "../layout/workspace-outer-layout";
import { PanelResizeHandle, WorkspaceLayoutResizeProvider, constrainPairPixels, useWorkspaceLayoutResizeState } from "../layout/workspace-splitters";
import { cardCollapsedSize, clampResizablePanelSize, workspaceSplitterSize } from "../layout/workspace-panel-sizing";
import { type WorkspacePanelRenderer, type WorkspaceResizeAxis } from "../layout/workspace-layout-types";
import { workspaces as workspaceDefinitions, type WorkspaceDefinition } from "../../model/workspace-config";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { WorkspaceTerminalDialog } from "../shared/WorkspaceTerminalDialog";
import { WorkspaceTerminalDock } from "../shared/WorkspaceTerminalDock";
import { WorkspaceRuntimeInstallDock, WorkspaceVoiceModelInstallDock } from "../shared/WorkspaceRuntimeInstallDocks";
import { ProjectSelector } from "../shared/WorkspaceProjectSelector";
import { PanelCard } from "../panels/WorkspacePanelCard";
import { createWorkspaceHeaderStatusItems, useCompactWorkspaceHeader, WorkspaceStatusWidget } from "./WorkspaceStatusWidget";
import { voiceModelRuntimeKeyForWorkspace, voiceModelRuntimeStatusMatchesKey } from "./workspace-voice-runtime-key";

type WorkspaceFrameProps = {
  workspace: WorkspaceDefinition;
  runtime: WorkspaceRuntime;
};

export function WorkspaceFrame({ workspace, runtime }: WorkspaceFrameProps) {
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspace.id));
  const layoutRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceGridRef = useRef<HTMLDivElement | null>(null);
  const state = runtime.getState(workspace.id);
  const statusItems = createWorkspaceHeaderStatusItems(state);
  const isBusy = state.isRunning || state.isExporting || state.isBatchSpeakerRunning;
  const progressPercent = Math.max(0, Math.min(100, Math.round(state.progressPercent)));
  const compactHeader = useCompactWorkspaceHeader();
  const projectSwitchingDisabled = useMemo(() => {
    if (runtime.guideMode) {
      return true;
    }

    return workspaceDefinitions.some((definition) => {
      const workspaceState = runtime.getState(definition.id);
      return workspaceState.isRunning || workspaceState.isExporting || workspaceState.isBatchSpeakerRunning || runtime.isVoiceModelRuntimeInstalling(definition.id);
    });
  }, [runtime]);
  const [outerLayoutSizes, setOuterLayoutSizes] = useState<WorkspaceOuterLayoutSizes>(() => initialWorkspaceUiRef.current.outerLayoutSizes ?? defaultOuterLayoutSizes);
  const [layoutResizeState, setLayoutResizeState] = useState<{ resizing: boolean; axis?: WorkspaceResizeAxis }>({ resizing: false });
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [terminalDockOpen, setTerminalDockOpen] = useState(false);
  const [terminalBubblePinned, setTerminalBubblePinned] = useState(true);
  const restoreTerminalDockAfterDialogRef = useRef(false);
  const handledTerminalOpenRequestRef = useRef<Record<string, number>>({});
  if (handledTerminalOpenRequestRef.current[workspace.id] === undefined) {
    handledTerminalOpenRequestRef.current[workspace.id] = state.terminalOpenRequestId;
  }
  const setLayoutResizing = useCallback((resizing: boolean, axis?: WorkspaceResizeAxis) => {
    const nextAxis = resizing ? axis : undefined;
    setLayoutResizeState((current) => (current.resizing === resizing && current.axis === nextAxis ? current : { resizing, axis: nextAxis }));
  }, []);
  const layoutResizeContext = useMemo(
    () => ({ resizing: layoutResizeState.resizing, axis: layoutResizeState.axis, setResizing: setLayoutResizing }),
    [layoutResizeState.axis, layoutResizeState.resizing, setLayoutResizing],
  );
  const renderPanelCard: WorkspacePanelRenderer = (props) => <PanelCard {...props} />;
  const rightPanelsVisible = workspace.right.length > 0;
  const workspaceGridColumns = [
    "var(--workspace-left-width)",
    `${workspaceSplitterSize}px`,
    "minmax(0,1fr)",
    rightPanelsVisible ? `${workspaceSplitterSize}px` : "0px",
    rightPanelsVisible ? "var(--workspace-right-width)" : "0px",
  ].join(" ");
  const workspaceGridStyle = {
    gridTemplateColumns: workspaceGridColumns,
    "--workspace-left-width": `${outerLayoutSizes.left}px`,
    "--workspace-right-width": `${outerLayoutSizes.right}px`,
  } as CSSProperties;
  const guideTerminalOpen = Boolean(runtime.guideMode?.terminalOpen);
  const terminalDockVisible = terminalDockOpen || guideTerminalOpen;
  const runtimeEnvironmentStatus = runtime.getRuntimeEnvironmentStatus(workspace.id);
  const runtimeEnvironmentInstalling = runtime.isRuntimeEnvironmentInstalling(workspace.id);
  const runtimeEnvironmentVisible = Boolean(runtimeEnvironmentStatus && !runtimeEnvironmentStatus.ok);
  const voiceModelRuntimeStatus = runtime.getVoiceModelRuntimeStatus(workspace.id);
  const voiceModelRuntimeInstalling = runtime.isVoiceModelRuntimeInstalling(workspace.id);
  const voiceModelRuntimeKey = useMemo(
    () => voiceModelRuntimeKeyForWorkspace(workspace.id, runtime.settings),
    [
      runtime.settings.inference.gptVersion,
      runtime.settings.inference.selectedModel,
      runtime.settings.inference.toolRoot,
      runtime.settings.training.gptVersion,
      runtime.settings.training.selectedModel,
      runtime.settings.training.toolRoot,
      workspace.id,
    ],
  );
  const voiceModelRuntimeVisible = Boolean(
    voiceModelRuntimeKey
      && runtimeEnvironmentStatus?.ok === true
      && voiceModelRuntimeStatus
      && voiceModelRuntimeStatusMatchesKey(voiceModelRuntimeStatus, voiceModelRuntimeKey)
      && !voiceModelRuntimeStatus.ok,
  );

  useEffect(() => {
    if (!runtime.guideMode) {
      void runtime.checkRuntimeEnvironment(workspace.id);
    }
  }, [runtime.checkRuntimeEnvironment, runtime.guideMode, workspace.id]);

  useEffect(() => {
    if (!runtime.guideMode && runtimeEnvironmentStatus?.ok === true && voiceModelRuntimeKey) {
      void runtime.checkVoiceModelRuntime(workspace.id);
    }
  }, [runtime.checkVoiceModelRuntime, runtime.guideMode, runtimeEnvironmentStatus?.ok, voiceModelRuntimeKey, workspace.id]);

  useEffect(() => {
    persistence.recordWorkspaceUiSnapshot(workspace.id, {
      outerLayoutSizes,
    });
  }, [outerLayoutSizes, persistence, workspace.id]);

  useEffect(() => {
    const handledRequestId = handledTerminalOpenRequestRef.current[workspace.id] ?? 0;
    if (state.terminalOpenRequestId > handledRequestId) {
      handledTerminalOpenRequestRef.current[workspace.id] = state.terminalOpenRequestId;
      setTerminalDockOpen(true);
      setTerminalBubblePinned(true);
    }
  }, [state.terminalOpenRequestId, workspace.id]);

  useEffect(() => {
    const root = layoutRootRef.current;
    if (!root) {
      return;
    }

    const update = () => {
      const availableWidth = Math.max(cardCollapsedSize, root.getBoundingClientRect().width);
      setOuterLayoutSizes((current) => fitOuterLayoutSizes(current, availableWidth, { left: true, right: rightPanelsVisible }));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rightPanelsVisible]);

  const resizeOuterPanel = (side: "left" | "right", startClientX: number) => {
    const grid = workspaceGridRef.current;
    if (!grid) {
      return;
    }

    const rootWidth = Math.max(cardCollapsedSize, layoutRootRef.current?.getBoundingClientRect().width ?? window.innerWidth);
    const startSizes = outerLayoutSizes;
    const visibleHandleWidth = workspaceSplitterSize + (rightPanelsVisible ? workspaceSplitterSize : 0);
    const activeLeftWidth = startSizes.left;
    const activeRightWidth = rightPanelsVisible ? startSizes.right : 0;
    const activeCenterWidth = Math.max(outerPanelMin.center, rootWidth - activeLeftWidth - activeRightWidth - visibleHandleWidth);
    const maxLeft = Math.max(outerPanelMin.left, rootWidth - activeRightWidth - outerPanelMin.center - visibleHandleWidth);
    const maxRight = Math.max(outerPanelMin.right, rootWidth - activeLeftWidth - outerPanelMin.center - visibleHandleWidth);
    let nextSizes = startSizes;

    const applySizes = (delta: number) => {
      if (side === "left") {
        const [nextLeft] = constrainPairPixels(startSizes.left, activeCenterWidth, delta, outerPanelMin.left);
        const left = clampResizablePanelSize(nextLeft, outerPanelMin.left, maxLeft);
        nextSizes = { ...startSizes, left };
        grid.style.setProperty("--workspace-left-width", `${left}px`);
        return;
      }

      const [nextRight] = constrainPairPixels(startSizes.right, activeCenterWidth, -delta, outerPanelMin.right);
      const right = clampResizablePanelSize(nextRight, outerPanelMin.right, maxRight);
      nextSizes = { ...startSizes, right };
      grid.style.setProperty("--workspace-right-width", `${right}px`);
    };

    const handleMove = (event: MouseEvent) => {
      applySizes(event.clientX - startClientX);
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setOuterLayoutSizes(nextSizes);
      setLayoutResizing(false);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setLayoutResizing(true, "width");
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  return (
    <WorkspaceLayoutResizeProvider value={layoutResizeContext}>
    <div className="relative flex h-[calc(100vh-24px)] min-h-0 flex-col bg-transparent">
      <AnimatePresence initial={false}>
        {compactHeader ? (
          <motion.div key={`compact-status-${workspace.id}`} {...workspaceContentMotion}>
            <WorkspaceStatusWidget
              key="compact-status-widget"
              statusItems={statusItems}
              progressPercent={progressPercent}
              projectSelectorDisabled={projectSwitchingDisabled}
              terminal={state.terminal}
              terminalTitle={`${workspace.title} 콘솔`}
              terminalBubblePinned={terminalDockVisible && (terminalBubblePinned || guideTerminalOpen)}
              runtimeEnvironmentStatus={runtimeEnvironmentStatus}
              runtimeEnvironmentInstalling={runtimeEnvironmentInstalling}
              voiceModelRuntimeStatus={voiceModelRuntimeVisible ? voiceModelRuntimeStatus : undefined}
              voiceModelRuntimeInstalling={voiceModelRuntimeInstalling}
              onTerminalBubblePinnedChange={(pinned) => {
                setTerminalDockOpen(true);
                setTerminalBubblePinned(pinned);
              }}
              onInstallRuntime={() => void runtime.installRuntimeEnvironment(workspace.id)}
              onInstallVoiceModelRuntime={() => void runtime.installVoiceModelRuntime(workspace.id)}
              onOpenFullTerminal={() => setTerminalDialogOpen(true)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {!compactHeader ? (
        <motion.header
          key={`workspace-header-${workspace.id}`}
          {...workspaceContentMotion}
          className="mb-4 mt-1.5 grid grid-cols-[auto_minmax(140px,1fr)_auto_auto] grid-rows-[38px_auto] items-center"
          data-app-tour-target="workspace-header"
        >
          <h2 className="col-start-1 row-start-1 h-[38px] whitespace-nowrap text-xl font-bold leading-[38px] text-[var(--primary-text)]">{workspace.title}</h2>
          <p className="col-span-4 col-start-1 row-start-2 mt-0.5 text-[13px] font-normal leading-5 text-[var(--secondary-text)]">{workspace.subtitle}</p>
          {isBusy ? (
            <>
              <div className="col-start-2 row-start-1 mx-[18px] h-2 min-w-[140px] overflow-hidden rounded bg-[var(--slider-rail)]">
                <div className="h-full rounded bg-[var(--accent-blue)] transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="col-start-3 row-start-1 min-w-[42px] text-right text-sm font-normal text-[var(--primary-text)]">{progressPercent}%</div>
            </>
          ) : null}
          <div className="col-start-4 row-start-1 ml-7 flex items-center justify-end">
            <ProjectSelector disabled={projectSwitchingDisabled} />
            <span className="mx-[18px] h-4 w-px shrink-0 bg-[var(--panel-stroke)] opacity-85" />
            {statusItems.map((item, index) => (
              <div key={item.label} className="flex items-center">
                {index > 0 ? <span className="mx-[18px] h-4 w-px bg-[var(--panel-stroke)] opacity-85" /> : null}
                <span className="mr-2 text-sm font-normal text-[var(--secondary-text)]">{item.label}</span>
                <span className="max-w-36 truncate text-sm font-normal text-[var(--primary-text)]">{item.value}</span>
              </div>
            ))}
            <motion.button
              type="button"
              onClick={() => {
                setTerminalDockOpen((current) => {
                  const nextOpen = !current;
                  if (nextOpen) {
                    setTerminalBubblePinned(true);
                  }
                  return nextOpen;
                });
              }}
              whileTap={softPressTap}
              className="wpf-button ml-[18px] flex h-8 items-center gap-2 px-3 text-[13px]"
            >
              <Terminal className="size-3.5" strokeWidth={1.8} />
              {terminalDockVisible ? "콘솔 닫기" : "콘솔 열기"}
            </motion.button>
          </div>
        </motion.header>
      ) : null}

      <AnimatePresence>
      {state.error ? (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={menuMotion.transition} className="pointer-events-none absolute left-0 right-0 top-[74px] z-40 flex justify-center px-4">
          <motion.div layout className="pointer-events-auto relative max-h-[224px] w-[min(1040px,100%)] overflow-auto rounded-[5px] border border-[#7b3540] bg-[#2b1519]/90 px-4 py-3 pr-11 text-sm leading-5 text-[#ffb8bf] shadow-2xl backdrop-blur">
            <button
              type="button"
              onClick={() => runtime.clearError(workspace.id)}
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-[4px] text-[#ffd4d8] hover:bg-[#5a2a33]"
              aria-label="오류 알림 닫기"
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
            <div className="whitespace-pre-wrap font-sans">{state.error}</div>
          </motion.div>
        </motion.div>
      ) : null}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div ref={layoutRootRef} className="relative min-h-0 flex-1" data-app-tour-target="workspace-layout">
        <div ref={workspaceGridRef} className="grid h-full min-h-0" style={workspaceGridStyle}>
          <PanelCard key={workspace.left.id} layoutId="workspace-card-left" workspaceId={workspace.id} panel={workspace.left} runtime={runtime} collapseMode="none" />
          <PanelResizeHandle orientation="vertical" onMouseDown={(event) => resizeOuterPanel("left", event.clientX)} />
          <WorkspaceCenterPanels workspace={workspace} runtime={runtime} renderPanel={renderPanelCard} />
          {rightPanelsVisible ? <PanelResizeHandle orientation="vertical" onMouseDown={(event) => resizeOuterPanel("right", event.clientX)} /> : <div aria-hidden="true" />}
          {rightPanelsVisible ? <WorkspaceRightPanels workspace={workspace} runtime={runtime} renderPanel={renderPanelCard} /> : <div />}
        </div>
        </div>
      </div>
      <AnimatePresence>
        {!compactHeader && terminalDockVisible ? (
          <motion.div
            key={`${workspace.id}-terminal-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed right-6 z-[2100]"
            style={{ bottom: runtimeEnvironmentVisible || voiceModelRuntimeVisible ? 78 : 24 }}
          >
            <WorkspaceTerminalDock
              terminal={state.terminal}
              title={`${workspace.title} 콘솔`}
              bubblePinned={terminalBubblePinned || guideTerminalOpen}
              onBubblePinnedChange={setTerminalBubblePinned}
              onOpenFull={() => {
                restoreTerminalDockAfterDialogRef.current = true;
                setTerminalDockOpen(false);
                setTerminalDialogOpen(true);
              }}
              placement="top"
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {!compactHeader && runtimeEnvironmentStatus && !runtimeEnvironmentStatus.ok ? (
          <motion.div
            key={`${workspace.id}-runtime-install-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed bottom-6 right-6 z-[2100]"
          >
            <WorkspaceRuntimeInstallDock
              status={runtimeEnvironmentStatus}
              installing={runtimeEnvironmentInstalling}
              onInstall={() => void runtime.installRuntimeEnvironment(workspace.id)}
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {!compactHeader && voiceModelRuntimeVisible && voiceModelRuntimeStatus ? (
          <motion.div
            key={`${workspace.id}-voice-model-install-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed bottom-6 right-6 z-[2100]"
          >
            <WorkspaceVoiceModelInstallDock
              status={voiceModelRuntimeStatus}
              installing={voiceModelRuntimeInstalling}
              onInstall={() => void runtime.installVoiceModelRuntime(workspace.id)}
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {terminalDialogOpen ? (
          <WorkspaceTerminalDialog
            key={`${workspace.id}-terminal`}
            title={`${workspace.title} 터미널`}
            terminal={state.terminal}
            onClear={() => runtime.clearTerminal(workspace.id)}
            onClose={() => {
              setTerminalDialogOpen(false);
              if (restoreTerminalDockAfterDialogRef.current) {
                restoreTerminalDockAfterDialogRef.current = false;
                setTerminalDockOpen(true);
              }
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
    </WorkspaceLayoutResizeProvider>
  );
}
