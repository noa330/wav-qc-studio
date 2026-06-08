import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import type { WorkspaceId } from "@shared/ipc";
import { useAppPersistence } from "@/app/app-persistence";
import { menuMotion, pressTap, workspaceContentMotion } from "@/shared/motion";
import { WorkspaceCenterPanels, WorkspaceRightPanels, findWorkspaceTableDeckPanel, getWorkspaceTopDefinition, useSliceEditorViewContext, workspaceTableDeckTopRatio } from "../layout/workspace-page-layouts";
import { defaultOuterLayoutSizes, fitOuterLayoutSizes, outerPanelMin, type WorkspaceOuterLayoutSizes } from "../layout/workspace-outer-layout";
import { PanelResizeHandle, WorkspaceLayoutResizeProvider, constrainPairPixels, useWorkspaceLayoutResizeState } from "../layout/workspace-splitters";
import { cardCollapsedSize, clampResizablePanelSize, workspaceSplitterSize } from "../layout/workspace-panel-sizing";
import { type WorkspacePanelRenderer, type WorkspaceResizeAxis } from "../layout/workspace-layout-types";
import { workspaces as workspaceDefinitions, type WorkspaceDefinition } from "../../model/workspace-config";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { useAppUpdate } from "../../state/use-app-update";
import { WorkspaceTerminalDialog } from "../shared/WorkspaceTerminalDialog";
import { WorkspaceTerminalDock } from "../shared/WorkspaceTerminalDock";
import { shouldShowRuntimeEnvironmentInstallDock, shouldShowVoiceModelInstallDock, WorkspaceRuntimeInstallDock, WorkspaceVoiceModelInstallDock } from "../shared/WorkspaceRuntimeInstallDocks";
import { shouldShowAppUpdateDock, WorkspaceAppUpdateDock } from "../shared/WorkspaceAppUpdateDock";
import { PanelCard } from "../panels/WorkspacePanelCard";
import { createWorkspaceHeaderStatusItems, useCompactWorkspaceHeader, WorkspaceStatusWidget } from "./WorkspaceStatusWidget";
import { voiceModelRuntimeKeyForWorkspace, voiceModelRuntimeStatusMatchesKey } from "./workspace-voice-runtime-key";
import { InferenceActionControls } from "../pages/inference/InferencePanels";

type WorkspaceFrameProps = {
  workspace: WorkspaceDefinition;
  runtime: WorkspaceRuntime;
  terminalDockOpen: boolean;
  terminalBubblePinned: boolean;
  floatingAudioPlayerVisible: boolean;
  onTerminalDockOpenChange: (open: boolean) => void;
  onTerminalBubblePinnedChange: (pinned: boolean) => void;
};

export function WorkspaceFrame({ workspace, runtime, terminalDockOpen, terminalBubblePinned, floatingAudioPlayerVisible, onTerminalDockOpenChange, onTerminalBubblePinnedChange }: WorkspaceFrameProps) {
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspace.id));
  const layoutRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceGridRef = useRef<HTMLDivElement | null>(null);
  const tableDeckRef = useRef<HTMLDivElement | null>(null);
  const state = runtime.getState(workspace.id);
  const appUpdate = useAppUpdate();
  const statusItems = createWorkspaceHeaderStatusItems(state);
  const isBusy = state.isRunning || state.isExporting || state.isBatchSpeakerRunning;
  const progressPercent = Math.max(0, Math.min(100, Math.round(state.progressPercent)));
  const compactHeader = useCompactWorkspaceHeader();
  const projectSwitchingDisabled = useMemo(() => {
    if (runtime.guideMode) return true;
    return workspaceDefinitions.some((definition) => {
      const workspaceState = runtime.getState(definition.id);
      return workspaceState.isRunning || workspaceState.isExporting || workspaceState.isBatchSpeakerRunning || runtime.isVoiceModelRuntimeInstalling(definition.id);
    });
  }, [runtime]);
  const [outerLayoutSizes, setOuterLayoutSizes] = useState<WorkspaceOuterLayoutSizes>(() => initialWorkspaceUiRef.current.outerLayoutSizes ?? defaultOuterLayoutSizes);
  const [tableDeckRatio, setTableDeckRatio] = useState(workspaceTableDeckTopRatio);
  const [layoutResizeState, setLayoutResizeState] = useState<{ resizing: boolean; axis?: WorkspaceResizeAxis }>({ resizing: false });
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [guidePanelResizeProgress, setGuidePanelResizeProgress] = useState(0);
  const [dismissedInstallDocks, setDismissedInstallDocks] = useState<Set<string>>(() => new Set());
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
  const tableDeckPanel = useMemo(() => findWorkspaceTableDeckPanel(workspace), [workspace]);
  const topWorkspace = useMemo(() => getWorkspaceTopDefinition(workspace, tableDeckPanel), [tableDeckPanel, workspace]);
  const sliceEditorContext = useSliceEditorViewContext(workspace.id, workspace.id === "slice");
  const sliceActionsPanel = workspace.id === "slice" ? topWorkspace.center.find((panel) => panel.id === "slice-actions") : undefined;
  const topWorkspaceWithoutSliceActions = useMemo(
    () => sliceActionsPanel ? { ...topWorkspace, center: topWorkspace.center.filter((panel) => panel.id !== sliceActionsPanel.id) } : topWorkspace,
    [sliceActionsPanel, topWorkspace],
  );
  const rightPanelsVisible = topWorkspace.right.length > 0;
  const guidePanelResizeActive = runtime.guideMode?.activeStepId === "workspace-splitters";
  const displayedOuterLayoutSizes = guidePanelResizeActive
    ? {
        ...outerLayoutSizes,
        left: clampResizablePanelSize(Math.round(outerLayoutSizes.left + guidePanelResizeProgress * 46), outerPanelMin.left, outerLayoutSizes.left + 56),
      }
    : outerLayoutSizes;
  const workspaceGridColumns = [
    "var(--workspace-left-width)",
    `${workspaceSplitterSize}px`,
    "minmax(0,1fr)",
    rightPanelsVisible ? `${workspaceSplitterSize}px` : "0px",
    rightPanelsVisible ? "var(--workspace-right-width)" : "0px",
  ].join(" ");
  const workspaceGridStyle = {
    gridTemplateColumns: workspaceGridColumns,
    "--workspace-left-width": `${displayedOuterLayoutSizes.left}px`,
    "--workspace-right-width": `${displayedOuterLayoutSizes.right}px`,
  } as CSSProperties;
  const guideTerminalOpen = Boolean(runtime.guideMode?.terminalOpen);
  const terminalDockVisible = terminalDockOpen || guideTerminalOpen;
  const runtimeEnvironmentStatus = runtime.getRuntimeEnvironmentStatus(workspace.id);
  const runtimeEnvironmentInstalling = runtime.isRuntimeEnvironmentInstalling(workspace.id);
  const runtimeEnvironmentDockKey = runtimeEnvironmentStatus
    ? `runtime:${workspace.id}:${runtimeEnvironmentStatus.requirements.map((item) => `${item.label}:${item.installed ? 1 : 0}`).join("|")}`
    : "";
  const runtimeEnvironmentVisible = Boolean(
    shouldShowRuntimeEnvironmentInstallDock(runtimeEnvironmentStatus)
      && (runtimeEnvironmentInstalling || !dismissedInstallDocks.has(runtimeEnvironmentDockKey)),
  );
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
      && shouldShowVoiceModelInstallDock(voiceModelRuntimeStatus)
      && (voiceModelRuntimeInstalling || !dismissedInstallDocks.has(`voice:${voiceModelRuntimeKey.settingsKey}`)),
  );
  const appUpdateVisible = shouldShowAppUpdateDock(appUpdate.state);
  const installDockVisible = runtimeEnvironmentVisible || voiceModelRuntimeVisible;
  const floatingAudioPlayerBottomInset = floatingAudioPlayerVisible ? 72 : 0;
  const updateDockBottom = 24 + floatingAudioPlayerBottomInset;
  const installDockBottom = (appUpdateVisible ? 78 : 24) + floatingAudioPlayerBottomInset;
  const terminalDockBottom = 24 + floatingAudioPlayerBottomInset + (appUpdateVisible ? 54 : 0) + (installDockVisible ? 54 : 0);
  const dismissInstallDock = useCallback((key: string) => {
    setDismissedInstallDocks((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

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
    if (!guidePanelResizeActive) {
      setGuidePanelResizeProgress((current) => (current === 0 ? current : 0));
      return undefined;
    }

    let frame: number | undefined;
    const startedAt = performance.now();
    const durationMs = 1600;
    const tick = () => {
      const progress = ((performance.now() - startedAt) % durationMs) / durationMs;
      setGuidePanelResizeProgress(Math.sin(progress * Math.PI));
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [guidePanelResizeActive]);

  useEffect(() => {
    persistence.recordWorkspaceUiSnapshot(workspace.id, {
      outerLayoutSizes,
    });
  }, [outerLayoutSizes, persistence, workspace.id]);

  useEffect(() => {
    const handledRequestId = handledTerminalOpenRequestRef.current[workspace.id] ?? 0;
    if (state.terminalOpenRequestId > handledRequestId) {
      handledTerminalOpenRequestRef.current[workspace.id] = state.terminalOpenRequestId;
      onTerminalDockOpenChange(true);
      onTerminalBubblePinnedChange(true);
    }
  }, [state.terminalOpenRequestId, workspace.id, onTerminalDockOpenChange, onTerminalBubblePinnedChange]);

  useEffect(() => {
    const root = layoutRootRef.current;
    if (!root) return;

    const update = () => {
      const rectWidth = root.getBoundingClientRect().width;
      if (rectWidth <= 0) return;
      const availableWidth = Math.max(cardCollapsedSize, rectWidth);
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
    if (!grid) return;

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
      setOuterLayoutSizes({ ...nextSizes, totalWidth: rootWidth });
      setLayoutResizing(false);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setLayoutResizing(true, "width");
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const buildTableDeckGridRows = (ratio: number) => {
    return `minmax(0, ${ratio}fr) ${workspaceSplitterSize}px 42px ${workspaceSplitterSize}px minmax(0, ${1 - ratio}fr)`;
  };

  const resizeTableDeck = (startClientY: number) => {
    const deck = tableDeckRef.current;
    if (!deck) return;

    const rect = deck.getBoundingClientRect();
    const availableHeight = Math.max(cardCollapsedSize * 2, rect.height - workspaceSplitterSize * 2 - 42);
    const startTop = availableHeight * tableDeckRatio;
    const startBottom = availableHeight - startTop;
    let nextRatio = tableDeckRatio;

    const applyRatio = (ratio: number) => {
      nextRatio = Math.min(0.95, Math.max(0.05, ratio));
      deck.style.gridTemplateRows = buildTableDeckGridRows(nextRatio);
    };

    const handleMove = (event: MouseEvent) => {
      const [nextTop, nextBottom] = constrainPairPixels(startTop, startBottom, event.clientY - startClientY, cardCollapsedSize);
      applyRatio(nextTop / Math.max(1, nextTop + nextBottom));
    };

    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setTableDeckRatio((current) => (Math.abs(current - nextRatio) > 0.0005 ? nextRatio : current));
      setLayoutResizing(false);
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    setLayoutResizing(true, "height");
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const topPanelGrid = (
    <div ref={workspaceGridRef} className="grid h-full min-h-0" style={workspaceGridStyle}>
      <PanelCard key={topWorkspace.left.id} layoutId="workspace-card-left" workspaceId={topWorkspace.id} panel={topWorkspace.left} runtime={runtime} collapseMode="none" />
      <PanelResizeHandle orientation="vertical" forceActive={guidePanelResizeActive} guideResizeProgress={guidePanelResizeProgress} onMouseDown={(event) => resizeOuterPanel("left", event.clientX)} />
      <WorkspaceCenterPanels workspace={topWorkspaceWithoutSliceActions} runtime={runtime} renderPanel={renderPanelCard} sliceEditorContext={sliceActionsPanel ? sliceEditorContext : undefined} />
      {rightPanelsVisible ? <PanelResizeHandle orientation="vertical" forceActive={guidePanelResizeActive} guideResizeProgress={guidePanelResizeProgress} onMouseDown={(event) => resizeOuterPanel("right", event.clientX)} /> : <div aria-hidden="true" />}
      {rightPanelsVisible ? <WorkspaceRightPanels workspace={topWorkspace} runtime={runtime} renderPanel={renderPanelCard} /> : <div />}
    </div>
  );

  const topPanelGridLeftCenterOnly = (
    <div className="grid h-full min-h-0 min-w-0 overflow-visible" style={{
      gridTemplateColumns: `var(--workspace-left-width) ${workspaceSplitterSize}px minmax(0, 1fr)`
    }}>
      <PanelCard key={topWorkspace.left.id} layoutId="workspace-card-left" workspaceId={topWorkspace.id} panel={topWorkspace.left} runtime={runtime} collapseMode="none" />
      <PanelResizeHandle orientation="vertical" forceActive={guidePanelResizeActive} guideResizeProgress={guidePanelResizeProgress} onMouseDown={(event) => resizeOuterPanel("left", event.clientX)} />
      <WorkspaceCenterPanels workspace={topWorkspaceWithoutSliceActions} runtime={runtime} renderPanel={renderPanelCard} sliceEditorContext={sliceActionsPanel ? sliceEditorContext : undefined} />
    </div>
  );

  const tableRows = state.table.rows;
  const selectedRowIndex = state.selectedRowId ? tableRows.findIndex((row) => row.id === state.selectedRowId) : -1;
  const rowNavEnabled = tableRows.length > 0;
  const canSelectPreviousRow = rowNavEnabled && selectedRowIndex > 0;
  const canSelectNextRow = rowNavEnabled && selectedRowIndex >= 0 && selectedRowIndex < tableRows.length - 1;
  const isExporting = false;
  const deckInferenceActions = workspace.id === "inference" ? <InferenceActionControls runtime={runtime} /> : null;
  const deckActions = tableDeckPanel ? (
    <div className="flex h-full min-h-0 min-w-0 items-center justify-start gap-2 overflow-visible" data-app-tour-target={workspace.id === "slice" ? "slice-editor-actions-row" : undefined}>
      <motion.button
        type="button"
        disabled={!canSelectPreviousRow}
        onClick={() => runtime.selectAdjacentRow(workspace.id, -1)}
        whileTap={canSelectPreviousRow ? pressTap : undefined}
        className="wpf-button wpf-button-on-card flex h-[38px] flex-none items-center gap-1.5 whitespace-nowrap px-3 text-sm [font-size:0] disabled:cursor-default disabled:text-[var(--secondary-text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.7} />
        <span className="text-sm">이전 항목</span>
        이전
      </motion.button>
      <motion.button
        type="button"
        disabled={!canSelectNextRow}
        onClick={() => runtime.selectAdjacentRow(workspace.id, 1)}
        whileTap={canSelectNextRow ? pressTap : undefined}
        className="wpf-button wpf-button-on-card flex h-[38px] flex-none items-center gap-1.5 whitespace-nowrap px-3 text-sm [font-size:0] disabled:cursor-default disabled:text-[var(--secondary-text)]"
      >
        <span className="text-sm">다음 항목</span>
        다음
        <ChevronRight className="size-4" strokeWidth={1.7} />
      </motion.button>
      {deckInferenceActions}
      {sliceActionsPanel ? (
        <div className="flex min-w-max flex-none items-center">
          <PanelCard
            layoutId="workspace-card-slice-actions"
            workspaceId={workspace.id}
            panel={sliceActionsPanel}
            runtime={runtime}
            className="h-[38px] min-h-0 min-w-max flex-none"
            collapseMode="none"
            sliceEditorContext={sliceEditorContext}
          />
        </div>
      ) : null}
      <motion.button
        type="button"
        onClick={() => window.location.reload()}
        whileTap={pressTap}
        className="wpf-button wpf-button-on-card ml-auto flex h-[38px] flex-none items-center gap-1.5 whitespace-nowrap px-3 text-sm [font-size:0] disabled:cursor-default disabled:text-[var(--secondary-text)]"
      >
        <RefreshCw className="size-4" strokeWidth={1.7} />
        <span className="text-sm">새로고침</span>
        {isExporting ? "중지" : "내보내기"}
      </motion.button>
    </div>
  ) : null;

  const leftCenterAreaWithTable = tableDeckPanel ? (
    <div
      ref={tableDeckRef}
      className="grid h-full min-h-0 min-w-0 overflow-visible"
      style={{ gridTemplateRows: buildTableDeckGridRows(tableDeckRatio) }}
    >
      {topPanelGridLeftCenterOnly}
      <PanelResizeHandle orientation="horizontal" onMouseDown={(event) => resizeTableDeck(event.clientY)} />
      {deckActions}
      <PanelResizeHandle orientation="horizontal" onMouseDown={(event) => resizeTableDeck(event.clientY)} />
      <PanelCard
        layoutId="workspace-card-table-deck"
        workspaceId={workspace.id}
        panel={tableDeckPanel}
        runtime={runtime}
        className="min-h-0 min-w-0"
        collapseMode="none"
      />
    </div>
  ) : null;

  const layoutWithTableDeck = (
    <div ref={workspaceGridRef} className="grid h-full min-h-0" style={{
      gridTemplateColumns: `minmax(0,1fr) ${rightPanelsVisible ? `${workspaceSplitterSize}px` : "0px"} ${rightPanelsVisible ? "var(--workspace-right-width)" : "0px"}`,
      "--workspace-left-width": `${displayedOuterLayoutSizes.left}px`,
      "--workspace-right-width": `${displayedOuterLayoutSizes.right}px`,
    } as CSSProperties}>
      <div className="h-full min-h-0 min-w-0">
        {leftCenterAreaWithTable}
      </div>
      {rightPanelsVisible ? <PanelResizeHandle orientation="vertical" forceActive={guidePanelResizeActive} guideResizeProgress={guidePanelResizeProgress} onMouseDown={(event) => resizeOuterPanel("right", event.clientX)} /> : <div aria-hidden="true" />}
      {rightPanelsVisible ? <WorkspaceRightPanels workspace={topWorkspace} runtime={runtime} renderPanel={renderPanelCard} /> : <div />}
    </div>
  );

  return (
    <WorkspaceLayoutResizeProvider value={layoutResizeContext}>
    <div className="relative flex h-full min-h-0 flex-col bg-transparent">
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
              onTerminalBubblePinnedChange={(pinned) => {
                onTerminalDockOpenChange(true);
                onTerminalBubblePinnedChange(pinned);
              }}
              onOpenFullTerminal={() => setTerminalDialogOpen(true)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
      {state.error ? (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={menuMotion.transition} className="pointer-events-none absolute left-0 right-0 top-0 z-40 flex justify-center px-4 pt-3">
          <motion.div layout className="pointer-events-auto relative max-h-[224px] w-[min(1040px,100%)] overflow-auto rounded-[5px] border border-[#7b3540] bg-[#2b1519]/90 px-4 py-3 pr-11 text-sm leading-5 text-[#ffb8bf] shadow-[var(--app-popover-shadow)] backdrop-blur">
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

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] py-[14px] pr-[14px]">
        <div ref={layoutRootRef} className="relative min-h-0 flex-1" data-app-tour-target="workspace-layout">
        {tableDeckPanel ? layoutWithTableDeck : topPanelGrid}
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
            className="fixed right-6 z-[2100] transition-[bottom] duration-200 ease-out"
            style={{ bottom: terminalDockBottom }}
          >
            <WorkspaceTerminalDock
              terminal={state.terminal}
              title={`${workspace.title} 콘솔`}
              bubblePinned={terminalBubblePinned || guideTerminalOpen}
              onBubblePinnedChange={onTerminalBubblePinnedChange}
              onOpenFull={() => {
                restoreTerminalDockAfterDialogRef.current = true;
                onTerminalDockOpenChange(false);
                setTerminalDialogOpen(true);
              }}
              placement="top"
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {runtimeEnvironmentVisible && runtimeEnvironmentStatus ? (
          <motion.div
            key={`${workspace.id}-runtime-install-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed right-6 z-[2100] transition-[bottom] duration-200 ease-out"
            style={{ bottom: installDockBottom }}
          >
            <WorkspaceRuntimeInstallDock
              status={runtimeEnvironmentStatus}
              installing={runtimeEnvironmentInstalling}
              onInstall={() => void runtime.installRuntimeEnvironment(workspace.id)}
              onDismiss={() => dismissInstallDock(runtimeEnvironmentDockKey)}
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {voiceModelRuntimeVisible && voiceModelRuntimeStatus ? (
          <motion.div
            key={`${workspace.id}-voice-model-install-dock`}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed right-6 z-[2100] transition-[bottom] duration-200 ease-out"
            style={{ bottom: installDockBottom }}
          >
            <WorkspaceVoiceModelInstallDock
              status={voiceModelRuntimeStatus}
              installing={voiceModelRuntimeInstalling}
              onInstall={() => void runtime.installVoiceModelRuntime(workspace.id)}
              onDismiss={() => {
                if (voiceModelRuntimeKey) {
                  dismissInstallDock(`voice:${voiceModelRuntimeKey.settingsKey}`);
                }
              }}
              className="w-[420px]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {appUpdateVisible ? (
          <motion.div
            key="app-update-dock"
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={menuMotion.transition}
            className="fixed right-6 z-[2100] transition-[bottom] duration-200 ease-out"
            style={{ bottom: updateDockBottom }}
          >
            <WorkspaceAppUpdateDock
              state={appUpdate.state}
              onInstall={appUpdate.install}
              onDismiss={appUpdate.dismiss}
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
                onTerminalDockOpenChange(true);
              }
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
    </WorkspaceLayoutResizeProvider>
  );
}
