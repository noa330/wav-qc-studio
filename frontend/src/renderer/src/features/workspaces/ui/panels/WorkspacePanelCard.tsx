import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { FolderCog } from "lucide-react";
import type { WorkspaceId } from "@shared/ipc";
import { useAppPersistence } from "@/app/app-persistence";
import { cn } from "@/lib/utils";
import { SelectField } from "@/shared/components/controls";
import { DropdownMenuHeader, DropdownMenuOption, DropdownMenuSurface } from "@/shared/components/dropdown-menu";
import { FileBrowser, type FileBrowserNodeChecks } from "@/shared/components/file-browser";
import { WpfCard } from "@/shared/components/wpf-card";
import { workspaceCardSpring } from "@/shared/motion";
import { getPanelBodyLayoutMode, getPanelBodyMinSize, resolveMeasuredPanelCollapseMode, useElementBoxSize, useElementResizeCollapseMode } from "../layout/workspace-card-overflow";
import { type PanelAutoCollapseSuppression, type PanelCollapseMode, type WorkspaceResizeAxis } from "../layout/workspace-layout-types";
import { useWorkspaceLayoutResizeState } from "../layout/workspace-splitters";
import type { WorkspacePanel } from "../../model/workspace-config";
import { setInferenceReferencePathsChecked, toggleInferenceReferencePath } from "../../model/inference-reference-selection";
import { resolveBrowserTree } from "../../model/workspace-browser-tree";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import { BatchAudioHeaderControls, BatchAudioPlaybackPanel, BatchModelSettingsBody, BatchSpeakerSelectionBody, BatchTimelineBody } from "../pages/batch/BatchPanels";
import { OverviewModelSettingsBody, OverviewModulesBody } from "../pages/overview/OverviewPanels";
import { SliceEditorActionsBody, SliceEditorBody, SliceEditorHeaderControls, focusSliceViewOnRow, setSliceViewRange, type SliceEditorViewActions, type SliceEditorViewContext, type SliceEditorViewState, zoomSliceView } from "../pages/slice/SliceEditorPanel";
import { SliceSettingsBody } from "../pages/slice/SliceSettingsPanel";
import { SpeakerAudioComparisonPanel } from "../pages/speaker/SpeakerAudioComparisonPanel";
import { SpeakerModelBody, SpeakerSettingsBody } from "../pages/speaker/SpeakerPanels";
import { TaggingSchemaBody } from "../pages/tagging/TaggingPanels";
import { TaggingSettingsBody } from "../pages/tagging/TaggingSettingsPanel";
import { TrainingModelBody, TrainingPlanBody, TrainingSettingsBody } from "../pages/training/TrainingPanels";
import { InferenceModelBody, InferenceSettingsBody } from "../pages/inference/InferencePanels";
import { InferenceAudioComparisonPanel } from "../pages/inference/InferenceAudioComparisonPanel";
import { WorkspaceAudioPlaybackPanel } from "../shared/WorkspaceAudioPlaybackPanel";
import { WorkspaceSelectedAudioInfo } from "../shared/WorkspaceSelectedAudioInfo";
import { BackendStatusBody, DetailFieldList } from "../shared/workspace-panel-primitives";
import { findSelectedRow } from "../shared/workspace-ui-utils";
import { WorkspaceDataGrid, TableHeaderSearch } from "../table/WorkspaceDataGrid";


const overviewDetailHelp: Record<string, string> = {
  ID: "현재 결과 테이블에 표시되는 행 번호입니다.",
  파일명: "분석 대상 오디오 파일명입니다.",
  "원본 경로": "분석 대상 원본 오디오의 전체 경로입니다.",
  "길이(초)": "오디오 전체 길이를 초 단위로 계산한 값입니다.",
  샘플레이트: "오디오 파일의 sample rate입니다.",
  채널: "오디오 채널 수입니다.",
  전사: "자동 전사 결과 텍스트입니다.",
  언어: "자동 전사 또는 발음 분석에서 감지한 언어 코드입니다.",
  "발음 점수": "발음 분석 결과를 1~5 점수로 요약한 값입니다.",
  "발음 불량": "발음 점수가 기준보다 낮아 검수가 필요한 상태입니다.",
  BAK: "DNSMOS 계열 노이즈 분석의 background 점수입니다.",
  SIG: "DNSMOS 계열 노이즈 분석의 speech signal 점수입니다.",
  OVRL: "DNSMOS 계열 노이즈 분석의 overall 점수입니다.",
  "P808 MOS": "P.808 MOS 예측 점수입니다.",
  오류: "처리 중 백엔드가 기록한 오류 메시지입니다.",
};

export function collapseModeUsesAxis(mode: PanelCollapseMode, axis: WorkspaceResizeAxis): boolean {
  return axis === "width" ? mode === "vertical" || mode === "compact" : mode === "horizontal" || mode === "compact";
}

function resolvePanelTourRegion(layoutId?: string): "left" | "center" | "right" | undefined {
  if (!layoutId) {
    return undefined;
  }

  if (layoutId.includes("-left")) {
    return "left";
  }

  if (layoutId.includes("-center")) {
    return "center";
  }

  if (layoutId.includes("-right")) {
    return "right";
  }

  return undefined;
}

export function resolveAutoCollapseSuppression(
  base: PanelAutoCollapseSuppression | undefined,
  activeResizeAxis: WorkspaceResizeAxis | undefined,
  previousMode: PanelCollapseMode,
): PanelAutoCollapseSuppression | undefined {
  if (!activeResizeAxis) {
    return base;
  }

  const suppressedAxis: WorkspaceResizeAxis = activeResizeAxis === "width" ? "height" : "width";
  if (collapseModeUsesAxis(previousMode, suppressedAxis)) {
    return base;
  }

  const resizedAxisSuppression: PanelAutoCollapseSuppression = { [suppressedAxis]: true };
  return {
    ...base,
    ...resizedAxisSuppression,
  };
}

// ─── Panel Header Controls ───────────────────────────────────────────────────
// Exported so TabbedPanelStack can render the active panel's controls
// on the right side of its own unified tab-bar header.

export function renderPanelHeaderControls(
  workspaceId: WorkspaceId,
  panel: WorkspacePanel,
  runtime: WorkspaceRuntime,
  expanded: boolean,
  workspaceState: ReturnType<WorkspaceRuntime["getState"]>,
): ReactNode {
  const isBatchAudioPanel = workspaceId === "batch" && panel.id === "batch-audio";
  const isTablePanel = panel.kind === "table" || panel.kind === "progress";

  return (
    <>
      {expanded && isTablePanel ? (
        <>
          <SheetSelectorDropdown workspaceId={workspaceId} runtime={runtime} />
          {/* PageSizeDropdown and TableHeaderSearch are managed inside PanelCard which has access to pageSize state */}
        </>
      ) : null}
      {expanded && isBatchAudioPanel ? <BatchAudioHeaderControls runtime={runtime} disabled={!workspaceState.selectedAudioPath} /> : null}
      {expanded && panel.kind === "browser" ? (
        <BrowserHeaderDropdown workspaceId={workspaceId} runtime={runtime} />
      ) : null}
    </>
  );
}

export function PanelCard({
  layoutId,
  workspaceId,
  panel,
  runtime,
  className,
  detail = false,
  collapseMode,
  contentSizing = false,
  autoCollapseSuppression,
  sliceEditorContext: providedSliceEditorContext,
  cardMode = "standalone",
}: {
  layoutId?: string;
  workspaceId: WorkspaceId;
  panel: WorkspacePanel;
  runtime: WorkspaceRuntime;
  className?: string;
  detail?: boolean;
  collapseMode: PanelCollapseMode;
  contentSizing?: boolean;
  autoCollapseSuppression?: PanelAutoCollapseSuppression;
  sliceEditorContext?: SliceEditorViewContext;
  /** "standalone": normal card with border, radius, header (default).
   *  "tabbed": no card chrome, no header row — intended for embedding inside TabbedPanelStack. */
  cardMode?: "standalone" | "tabbed";
}) {
  const Icon = panel.icon;
  const cardRef = useRef<HTMLElement | null>(null);
  const { resizing: layoutResizing, axis: layoutResizeAxis } = useWorkspaceLayoutResizeState();
  const previousMeasuredCollapseModeRef = useRef<PanelCollapseMode>("none");
  const activeAutoCollapseSuppression = resolveAutoCollapseSuppression(autoCollapseSuppression, layoutResizing ? layoutResizeAxis : undefined, previousMeasuredCollapseModeRef.current);
  const cardSize = useElementBoxSize(cardRef, layoutResizing);
  const resizeCollapseMode = useElementResizeCollapseMode(cardRef, layoutResizing, collapseMode, activeAutoCollapseSuppression);
  const isSliceEditor = workspaceId === "slice" && panel.kind === "waveform";
  const isSliceActionPanel = workspaceId === "slice" && panel.kind === "slice-actions";
  const isBatchAudioPanel = workspaceId === "batch" && panel.id === "batch-audio";
  const isAudioComparisonPanel = panel.kind === "audio-comparison";
  const isTrainingPlanPanel = workspaceId === "training" && panel.id === "training-plan";
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspaceId));
  const [sliceEditorState, setSliceEditorState] = useState<SliceEditorViewState>(() => initialWorkspaceUiRef.current.sliceEditor);
  const [sliceSelectedComponentIds, setSliceSelectedComponentIds] = useState<string[]>([]);
  const [sliceAnimateMarkerTransitions, setSliceAnimateMarkerTransitions] = useState(false);
  const sliceMarkerTransitionTimeoutRef = useRef<number | undefined>(undefined);
  const [pageSize, setPageSize] = useState<number>(() => {
    const snapshot = initialWorkspaceUiRef.current;
    return snapshot.grid?.pageSize ?? 100;
  });

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    const currentGrid = persistence.getWorkspaceUiSnapshot(workspaceId).grid ?? {};
    persistence.recordWorkspaceUiSnapshot(workspaceId, {
      grid: {
        ...currentGrid,
        pageSize: size,
      }
    });
  };
  const sliceEditorActions = useMemo<SliceEditorViewActions>(
    () => ({
      setLoopPreview: (enabled) => setSliceEditorState((current) => ({ ...current, loopPreview: enabled })),
      zoomIn: () => setSliceEditorState((current) => zoomSliceView(current, 0.68, 0.5)),
      zoomOut: () => setSliceEditorState((current) => zoomSliceView(current, 1.45, 0.5)),
      zoomAt: (anchor, deltaY) => setSliceEditorState((current) => zoomSliceView(current, deltaY > 0 ? 1.18 : 0.84, anchor)),
      setViewRange: (start, end) => setSliceEditorState((current) => setSliceViewRange(current, start, end)),
      focusSelection: (rows, selectedRow, totalSeconds) => setSliceEditorState((current) => focusSliceViewOnRow(current, rows, selectedRow, totalSeconds)),
    }),
    [],
  );
  const workspaceState = runtime.getState(workspaceId);
  const triggerSliceMarkerTransitions = useCallback(() => {
    setSliceAnimateMarkerTransitions(true);
    if (sliceMarkerTransitionTimeoutRef.current !== undefined) {
      window.clearTimeout(sliceMarkerTransitionTimeoutRef.current);
    }
    sliceMarkerTransitionTimeoutRef.current = window.setTimeout(() => {
      setSliceAnimateMarkerTransitions(false);
      sliceMarkerTransitionTimeoutRef.current = undefined;
    }, 220);
  }, []);
  const localSliceEditorContext = useMemo<SliceEditorViewContext>(
    () => ({
      state: sliceEditorState,
      actions: sliceEditorActions,
      selectedComponentIds: sliceSelectedComponentIds,
      setSelectedComponentIds: setSliceSelectedComponentIds,
      animateMarkerTransitions: sliceAnimateMarkerTransitions,
      triggerMarkerTransitions: triggerSliceMarkerTransitions,
    }),
    [sliceAnimateMarkerTransitions, sliceEditorActions, sliceEditorState, sliceSelectedComponentIds, triggerSliceMarkerTransitions],
  );
  const sliceEditorContext = providedSliceEditorContext ?? localSliceEditorContext;
  const sliceEditorEnabled = Boolean(workspaceState.selectedAudioPath);

  useEffect(() => {
    if (isSliceEditor && !providedSliceEditorContext) {
      persistence.recordWorkspaceUiSnapshot(workspaceId, { sliceEditor: sliceEditorState });
    }
  }, [isSliceEditor, persistence, providedSliceEditorContext, sliceEditorState, workspaceId]);

  useEffect(() => () => {
    if (sliceMarkerTransitionTimeoutRef.current !== undefined) {
      window.clearTimeout(sliceMarkerTransitionTimeoutRef.current);
    }
  }, []);
  const isTablePanel = panel.kind === "table" || panel.kind === "progress";
  const isTableLikePanel = isTablePanel || panel.id === "batch-timeline";
  // In tabbed mode the host TabbedCenterStack controls visibility; collapse logic is not needed.
  const effectiveCollapseMode: PanelCollapseMode = cardMode === "tabbed" ? "none" : collapseMode;
  const measuredCollapseMode = cardMode === "tabbed" ? "none" : (resizeCollapseMode ?? resolveMeasuredPanelCollapseMode(effectiveCollapseMode, cardSize, activeAutoCollapseSuppression));
  const physicallyCollapsed = effectiveCollapseMode !== "none" && measuredCollapseMode !== "none";
  const expanded = measuredCollapseMode === "none";
  const layoutAnimationEnabled = cardMode !== "tabbed" && !layoutResizing && expanded;
  const verticalCollapsed = measuredCollapseMode === "vertical";
  const horizontalCollapsed = measuredCollapseMode === "horizontal";
  const compactCollapsed = measuredCollapseMode === "compact";
  const selectedAudioInfoVisible = !isAudioComparisonPanel && (panel.kind === "playback" || isSliceEditor) && Boolean(workspaceState.selectedAudioPath) && !verticalCollapsed && !compactCollapsed;
  const bodyOwnsHeader = isTrainingPlanPanel && expanded;
  const panelTitleVisible = !isAudioComparisonPanel && !bodyOwnsHeader && !selectedAudioInfoVisible && !compactCollapsed;
  const standaloneHeaderControlsVisible = !isAudioComparisonPanel && !bodyOwnsHeader && expanded && (
    isTablePanel
    || isSliceEditor
    || isBatchAudioPanel
    || panel.kind === "browser"
  );
  const standaloneHeaderVisible = selectedAudioInfoVisible || panelTitleVisible || standaloneHeaderControlsVisible || verticalCollapsed || compactCollapsed;
  const panelTourRegion = resolvePanelTourRegion(layoutId);
  const bodyMinSize = getPanelBodyMinSize(panel, detail);
  const bodyLayoutMode = getPanelBodyLayoutMode(panel);
  const bodyFillsAvailableSpace = bodyLayoutMode === "fill";
  const effectiveBodyLayoutMode = bodyFillsAvailableSpace ? "fill" : "content";
  const bodyScrollFillsAvailableSpace = bodyFillsAvailableSpace || contentSizing;
  const bodyOwnsScrollbarInset =
    panel.kind === "browser"
    || panel.kind === "detail"
    || (panel.kind === "filter" && panel.id !== "batch-speakers" && panel.id !== "overview-modules")
    || panel.kind === "model"
    || panel.kind === "queue"
    || panel.kind === "settings";
  const batchSpeakerPanel = workspaceId === "batch" && panel.id === "batch-speakers";
  const normalPanelPadding = bodyOwnsScrollbarInset || batchSpeakerPanel ? "pl-4 pt-4 pb-4 pr-[2px]" : "p-4";
  const standaloneBodyTopMargin = selectedAudioInfoVisible ? "mt-[22px]" : standaloneHeaderVisible ? "mt-4" : "mt-0";
  const bodyGridRowsClass = expanded
    ? contentSizing
      ? cardMode === "tabbed" ? "flex-auto grid-rows-[minmax(0,1fr)]" : `${standaloneBodyTopMargin} flex-auto grid-rows-[minmax(0,1fr)]`
      : cardMode === "tabbed" ? "flex-1 grid-rows-[minmax(0,1fr)]" : `${standaloneBodyTopMargin} flex-1 grid-rows-[minmax(0,1fr)]`
    : "mt-0 grid-rows-[0fr]";
  const motionLayoutId = layoutAnimationEnabled && layoutId ? `${workspaceId}:${layoutId}` : undefined;
  const collapsedClass =
    measuredCollapseMode === "horizontal"
      ? "h-[56px] min-h-0 max-h-[56px] w-full self-start overflow-hidden"
      : measuredCollapseMode === "vertical"
        ? "h-full min-h-0 w-[56px] min-w-[56px] max-w-[56px] self-stretch overflow-hidden"
        : "h-[56px] min-h-0 max-h-[56px] w-[56px] min-w-[56px] max-w-[56px] self-start overflow-hidden";

  useEffect(() => {
    previousMeasuredCollapseModeRef.current = measuredCollapseMode;
  }, [measuredCollapseMode]);

  if (isSliceActionPanel) {
    return (
      <WpfCard
        ref={cardRef}
        layout={layoutAnimationEnabled ? "position" : false}
        layoutId={motionLayoutId}
        transition={layoutAnimationEnabled ? workspaceCardSpring : { duration: 0 }}
        className={cn("workspace-panel-card wpf-transparent-card flex h-full min-h-0 min-w-max flex-none flex-col overflow-visible border-0", className)}
        data-workspace-card-layout-id={layoutId}
        data-collapse-mode={measuredCollapseMode}
        data-app-tour-panel-id={panel.id}
        data-app-tour-panel-kind={panel.kind}
        data-app-tour-panel-region={panelTourRegion}
      >
        <div className="flex h-full min-h-0 min-w-max items-center">
          {renderPanelBody(workspaceId, panel, runtime, sliceEditorContext, layoutResizing, pageSize, handlePageSizeChange)}
        </div>
      </WpfCard>
    );
  }

  // In tabbed mode: render a plain div (no WpfCard chrome) and omit the header row.
  // The host TabbedCenterStack is responsible for the card border, radius, and unified tab header.
  if (cardMode === "tabbed") {
    const tabbedPadding = isTrainingPlanPanel
        ? "p-0"
      : panel.kind === "waveform"
        ? "p-[15px]"
        : isTableLikePanel
          ? "px-0 pt-4 pb-0"
          : normalPanelPadding;
    return (
      <div
        ref={cardRef as React.RefObject<HTMLDivElement>}
        className={cn(
          "workspace-panel-card flex min-w-0 flex-col h-full",
          panel.kind === "settings" && "workspace-panel-card-tabbed-settings",
          className
        )}
        data-workspace-card-layout-id={layoutId}
        data-collapse-mode="none"
        data-app-tour-panel-id={panel.id}
        data-app-tour-panel-kind={panel.kind}
        data-app-tour-panel-region={panelTourRegion}
      >
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", tabbedPadding)}>
          <div className={cn("grid min-h-0 min-w-0 flex-1", bodyGridRowsClass)}>
            <div className="min-h-0 min-w-0 overflow-hidden">
              <div className={cn(
                "workspace-panel-body-scroll min-h-0 min-w-0",
                bodyScrollFillsAvailableSpace ? "h-full overflow-hidden" : "app-scrollbar max-h-full overflow-auto"
              )}>
                <div
                  data-body-layout={effectiveBodyLayoutMode}
                  className={cn("workspace-panel-body-content min-h-0 min-w-0", bodyFillsAvailableSpace ? "h-full" : "h-auto")}
                  style={{
                    minWidth: bodyMinSize.width > 0 ? bodyMinSize.width : undefined,
                    minHeight: bodyMinSize.height > 0 ? bodyMinSize.height : undefined,
                  }}
                >
                  {renderPanelBody(workspaceId, panel, runtime, isSliceEditor ? sliceEditorContext : undefined, layoutResizing, pageSize, handlePageSizeChange)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <WpfCard
      ref={cardRef}
      layout={layoutAnimationEnabled ? "position" : false}
      layoutId={motionLayoutId}
      transition={layoutAnimationEnabled ? workspaceCardSpring : { duration: 0 }}
      className={cn("workspace-panel-card flex min-w-0 flex-col", layoutAnimationEnabled && "will-change-transform", physicallyCollapsed ? collapsedClass : cn(contentSizing ? "min-h-[56px]" : "min-h-0", "min-w-0", className))}
      data-workspace-card-layout-id={layoutId}
      data-collapse-mode={measuredCollapseMode}
      data-app-tour-panel-id={panel.id}
      data-app-tour-panel-kind={panel.kind}
      data-app-tour-panel-region={panelTourRegion}
    >
      <div className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        detail
          ? normalPanelPadding
          : isAudioComparisonPanel || isTrainingPlanPanel
            ? "p-0"
          : panel.kind === "waveform"
            ? "p-[15px]"
          : isTableLikePanel
            ? "px-0 pt-4 pb-0"
            : normalPanelPadding,
        verticalCollapsed && "h-full items-center px-2 py-4",
        compactCollapsed && "items-center p-1",
        horizontalCollapsed && "justify-center p-4"
      )}>
        {standaloneHeaderVisible ? (
          <div className={cn(
            "flex min-h-8 min-w-0 items-center justify-between gap-2 overflow-hidden",
            verticalCollapsed && "h-full min-h-0 flex-col justify-start gap-3 overflow-hidden",
            compactCollapsed && "flex-col justify-start gap-0.5 overflow-hidden",
            isTableLikePanel ? "px-4" : bodyOwnsScrollbarInset && "pr-[14px]"
          )}>
            <div className={cn("flex min-w-0 shrink items-center gap-2 text-left", verticalCollapsed && "min-h-0 flex-1 flex-col justify-start", compactCollapsed && "justify-center")}>
              {selectedAudioInfoVisible && workspaceState.selectedAudioPath ? (
                <WorkspaceSelectedAudioInfo
                  audioPath={workspaceState.selectedAudioPath}
                />
              ) : (
                <>
                  {verticalCollapsed ? (
                    <h3 key="vertical-title" className="[writing-mode:vertical-rl] min-h-0 flex-1 truncate text-base font-semibold leading-5 text-[var(--primary-text)]">{panel.title}</h3>
                  ) : compactCollapsed || !panelTitleVisible ? null : (
                    <h3 key="normal-title" className="min-w-0 truncate whitespace-nowrap text-base font-semibold leading-5 text-[var(--primary-text)]">{panel.title}</h3>
                  )}
                </>
              )}
            </div>
            <div className={cn("flex items-center gap-3", isTablePanel ? "min-w-0 shrink justify-end" : "min-w-max shrink-0", (verticalCollapsed || compactCollapsed) && "flex-col gap-1")}>
              {expanded && isTablePanel ? (
                <>
                  <SheetSelectorDropdown workspaceId={workspaceId} runtime={runtime} />
                  <PageSizeDropdown pageSize={pageSize} onChange={handlePageSizeChange} />
                  <TableHeaderSearch workspaceId={workspaceId} runtime={runtime} />
                  <div id={`workspace-header-widget-slot-${workspaceId}`} className="flex shrink-0 items-center gap-3 empty:hidden" />
                </>
              ) : null}
              {expanded && isSliceEditor ? <SliceEditorHeaderControls view={sliceEditorContext.state} actions={sliceEditorContext.actions} disabled={!sliceEditorEnabled} /> : null}
              {expanded && isBatchAudioPanel ? <BatchAudioHeaderControls runtime={runtime} disabled={!workspaceState.selectedAudioPath} /> : null}
              {expanded && panel.kind === "browser" ? (
                <BrowserHeaderDropdown workspaceId={workspaceId} runtime={runtime} />
              ) : null}
            </div>
          </div>
        ) : null}
        <div aria-hidden={!expanded} className={cn("grid min-h-0 min-w-0", !expanded && "pointer-events-none", bodyGridRowsClass)}>
          <div className="min-h-0 min-w-0 overflow-hidden">
            <div className={cn(
              "workspace-panel-body-scroll min-h-0 min-w-0",
              bodyScrollFillsAvailableSpace ? "h-full overflow-hidden" : "app-scrollbar max-h-full overflow-auto",
              expanded ? "opacity-100" : "opacity-0"
            )}>
              <div
                data-body-layout={effectiveBodyLayoutMode}
                className={cn("workspace-panel-body-content min-h-0 min-w-0", bodyFillsAvailableSpace ? "h-full" : "h-auto")}
                style={{
                  minWidth: bodyMinSize.width > 0 ? bodyMinSize.width : undefined,
                  minHeight: bodyMinSize.height > 0 ? bodyMinSize.height : undefined,
                }}
              >
                {renderPanelBody(workspaceId, panel, runtime, isSliceEditor ? sliceEditorContext : undefined, layoutResizing, pageSize, handlePageSizeChange)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WpfCard>
  );
}

function renderPanelBody(workspaceId: WorkspaceId, panel: WorkspacePanel, runtime: WorkspaceRuntime, sliceEditorContext?: SliceEditorViewContext, layoutResizing = false, pageSize?: number, onPageSizeChange?: (size: number) => void) {
  const state = runtime.getState(workspaceId);
  const table = runtime.getTable(workspaceId);

  if (panel.kind === "browser") {
    const inputTree = resolveBrowserTree(workspaceId, "input", state.inputTree, table, state.inputPath);
    const outputTree = resolveBrowserTree(workspaceId, "output", state.outputTree, table, state.outputPath);
    const inferenceInputNodeChecks: FileBrowserNodeChecks | undefined = workspaceId === "inference"
      ? {
          checkedPaths: runtime.settings.inference.batchReferenceAudioPaths,
          revealMode: "hover-when-empty",
          onToggleNode: (node) => {
            if (!state.inferenceMultiReferenceOpen) {
              runtime.selectFileNode("inference", node);
            }
            runtime.setSettings((current) => ({
              ...current,
              inference: {
                ...current.inference,
                batchReferenceAudioPaths: toggleInferenceReferencePath(current.inference.batchReferenceAudioPaths, node.path),
              },
            }));
          },
          onToggleNodes: (nodes, checked) => {
            const paths = nodes.map((node) => node.path);
            runtime.setSettings((current) => ({
              ...current,
              inference: {
                ...current.inference,
                batchReferenceAudioPaths: setInferenceReferencePathsChecked(current.inference.batchReferenceAudioPaths, paths, checked),
              },
            }));
          },
        }
      : undefined;

    const audioDurations = useMemo(() => {
      const map: Record<string, string> = {};
      for (const row of table.rows) {
        const dur = row.cells.durationSec || row.raw?.durationSec || row.raw?.duration;
        if (dur) {
          const secs = parseFloat(String(dur));
          if (!isNaN(secs)) {
            map[row.id] = secs.toFixed(2) + "s";
            const inputPath = row.raw?.originalPath || row.raw?.sourcePath || row.raw?.inputPath;
            if (inputPath) {
              map[inputPath.replace(/\\/g, "/").toLowerCase()] = secs.toFixed(2) + "s";
            }
          }
        }
      }
      return map;
    }, [table.rows]);

    return (
      <FileBrowser
        workspaceId={workspaceId}
        inputPath={state.inputPath}
        outputPath={state.outputPath}
        inputTree={inputTree}
        outputTree={outputTree}
        selectedPath={state.selectedFilePath}
        rowChecks={state.rowExportChecks}
        inputNodeChecks={inferenceInputNodeChecks}
        preferredSection={state.browserPreferredSection}
        sectionRequestId={state.browserSectionRequestId}
        revealRequestId={state.browserRevealRequestId}
        onSelectInputFolder={() => runtime.selectInputFolder(workspaceId)}
        onSelectOutputFolder={() => runtime.selectOutputFolder(workspaceId)}
        inputActionLabel={workspaceId === "training" ? "데이터셋 파일" : workspaceId === "inference" ? "입력 폴더" : undefined}
        inputSecondaryActionLabel={workspaceId === "inference" ? "데이터셋 파일" : undefined}
        onSelectInputSecondary={workspaceId === "inference" ? runtime.selectInferenceDatasetFile : undefined}
        outputActionLabel={workspaceId === "training" ? "체크포인트 폴더" : undefined}
        onRequestWindow={(purpose, direction, metrics, targetPath) => runtime.loadFileBrowserWindow(workspaceId, purpose, direction, metrics, targetPath)}
        onSelectNode={(node) => runtime.selectFileNode(workspaceId, node)}
        audioDurations={audioDurations}
        reviewedFilePaths={state.reviewedFilePaths}
      />
    );
  }

  if (workspaceId === "tagging" && panel.id === "tagging-queue") {
    return <TaggingSchemaBody runtime={runtime} />;
  }

  if (workspaceId === "batch" && panel.id === "batch-timeline") {
    return <BatchTimelineBody row={findSelectedRow(state.table.rows, state.selectedRowId)} />;
  }

  if (panel.kind === "table" || panel.kind === "progress") {
    return (
      <WorkspaceDataGrid
        workspaceId={workspaceId}
        runtime={runtime}
        table={table}
        suspendWidthTracking={layoutResizing}
        controlledPageSize={pageSize}
        onPageSizeChange={onPageSizeChange}
      />
    );
  }

  if (workspaceId === "slice" && panel.kind === "slice-actions") {
    return (
      <SliceEditorActionsBody
        row={findSelectedRow(state.table.rows, state.selectedRowId)}
        audioPath={state.selectedAudioPath}
        onSplitOrUnmergeSegment={(sourceRow, componentIds) => runtime.splitOrUnmergeSliceSegment(workspaceId, sourceRow, componentIds)}
        onMergeSegments={() => runtime.mergeSliceSegments(workspaceId)}
        selectedRowIds={state.selectedRowIds}
        selectedComponentIds={sliceEditorContext?.selectedComponentIds ?? []}
        setSelectedComponentIds={sliceEditorContext?.setSelectedComponentIds}
        onMarkerTransitionRequest={sliceEditorContext?.triggerMarkerTransitions ?? (() => undefined)}
      />
    );
  }

  if (panel.kind === "waveform") {
    return (
      <SliceEditorBody
        row={findSelectedRow(state.table.rows, state.selectedRowId)}
        rows={state.table.rows}
        audioPath={state.selectedAudioPath}
        view={sliceEditorContext?.state ?? { viewStart: 0, viewEnd: 1, loopPreview: false }}
        actions={sliceEditorContext?.actions}
        onPrevious={() => runtime.selectAdjacentRow(workspaceId, -1)}
        onNext={() => runtime.selectAdjacentRow(workspaceId, 1)}
        onSplitOrUnmergeSegment={(sourceRow, componentIds) => runtime.splitOrUnmergeSliceSegment(workspaceId, sourceRow, componentIds)}
        onMergeSegments={() => runtime.mergeSliceSegments(workspaceId)}
        onUpdateSegmentBounds={(sourceRow, startSec, endSec) => runtime.updateSliceSegmentBounds(workspaceId, sourceRow, startSec, endSec)}
        onSelectRow={(nextRow, options) => runtime.selectRow(workspaceId, nextRow, options)}
        onAddSegment={(startSec, endSec) => runtime.addSliceSegment(workspaceId, findSelectedRow(state.table.rows, state.selectedRowId), startSec, endSec)}
        onCopySegment={(sourceRow) => runtime.copyRows(workspaceId, [sourceRow.id])}
        onDeleteSegment={(sourceRow) => runtime.deleteSliceSegment(workspaceId, sourceRow)}
        selectedRowIds={state.selectedRowIds}
        selectedComponentIds={sliceEditorContext?.selectedComponentIds}
        onSelectedComponentIdsChange={sliceEditorContext?.setSelectedComponentIds}
        animateMarkerTransitions={sliceEditorContext?.animateMarkerTransitions}
        onMarkerTransitionRequest={sliceEditorContext?.triggerMarkerTransitions}
      />
    );
  }

  if (workspaceId === "speaker" && panel.kind === "audio-comparison") {
    return (
      <SpeakerAudioComparisonPanel
        row={findSelectedRow(state.table.rows, state.selectedRowId)}
        originalPath={state.selectedAudioPath}
        resultPath={state.selectedResultAudioPath}
        audioEditScopeId={state.activeSheetId}
      />
    );
  }

  if (workspaceId === "batch" && panel.kind === "playback") {
    return <BatchAudioPlaybackPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} audioPath={state.selectedAudioPath} playTranscriptOutside={runtime.settings.batch.playTranscriptOutside} audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "overview" && panel.kind === "playback") {
    return <WorkspaceAudioPlaybackPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} audioPath={state.selectedAudioPath} cropEnabled audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "tagging" && panel.kind === "playback") {
    return <WorkspaceAudioPlaybackPanel row={findSelectedRow(state.table.rows, state.selectedRowId)} audioPath={state.selectedAudioPath} cropEnabled emptyText="오디오 행을 선택하세요." syncKey="tagging" audioEditScopeId={state.activeSheetId} />;
  }

  if (workspaceId === "inference" && panel.kind === "audio-comparison") {
    return <InferenceAudioComparisonPanel runtime={runtime} />;
  }

  if (workspaceId === "speaker" && panel.kind === "model") {
    return <SpeakerModelBody runtime={runtime} />;
  }

  if (workspaceId === "training" && panel.kind === "model") {
    return <TrainingModelBody runtime={runtime} />;
  }

  if (workspaceId === "training" && panel.id === "training-plan") {
    return <TrainingPlanBody runtime={runtime} />;
  }

  if (workspaceId === "inference" && panel.kind === "model") {
    return <InferenceModelBody runtime={runtime} />;
  }

  if (workspaceId === "slice" && panel.kind === "settings") {
    return <SliceSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "tagging" && panel.kind === "settings") {
    return <TaggingSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "speaker" && panel.kind === "settings") {
    return <SpeakerSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "overview" && panel.id === "overview-modules") {
    return <OverviewModulesBody runtime={runtime} />;
  }

  if (workspaceId === "overview" && panel.id === "overview-detail") {
    return <OverviewModelSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "batch" && panel.id === "batch-speakers") {
    return <BatchSpeakerSelectionBody runtime={runtime} rows={state.table.rows} />;
  }

  if (workspaceId === "batch" && panel.id === "batch-detail") {
    return <BatchModelSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "training" && panel.id === "training-settings") {
    return <TrainingSettingsBody runtime={runtime} />;
  }

  if (workspaceId === "inference" && panel.id === "inference-settings") {
    return <InferenceSettingsBody runtime={runtime} />;
  }

  if (panel.kind === "detail") {
    return workspaceId === "overview" ? (
      <DetailFieldList fields={state.details} helpByLabel={overviewDetailHelp} />
    ) : (
      <DetailFieldList fields={state.details} />
    );
  }

  if (panel.kind === "queue") {
    return <BackendStatusBody status={state.statusText} />;
  }

  return <BackendStatusBody status={state.statusText} />;
}

// ─── Header Dropdown Selectors ──────────────────────────────────────────────

const tableToolbarDropdownClass = "wpf-header-field-width";

function SheetSelectorDropdown({
  workspaceId,
  runtime,
}: {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
}) {
  const state = runtime.getState(workspaceId);
  const sheets = state.sheets ?? [];
  const activeSheetId = state.activeSheetId;

  if (sheets.length === 0) return null;

  const options = sheets.map((s) => ({
    value: s.id,
    label: s.label,
  }));

  return (
    <div className={tableToolbarDropdownClass} data-app-tour-target="data-grid-sheets">
      <SelectField
        value={activeSheetId ?? ""}
        options={options}
        onChange={(sheetId) => runtime.selectSheet(workspaceId, sheetId)}
        density="header"
        ariaLabel="시트 선택"
      />
    </div>
  );
}

function PageSizeDropdown({
  pageSize,
  onChange,
}: {
  pageSize: number;
  onChange: (size: number) => void;
}) {
  const options = [
    { value: "10", label: "10개씩" },
    { value: "20", label: "20개씩" },
    { value: "50", label: "50개씩" },
    { value: "100", label: "100개씩" },
    { value: "200", label: "200개씩" },
    { value: "500", label: "500개씩" },
  ];

  return (
    <div className={tableToolbarDropdownClass}>
      <SelectField
        value={String(pageSize)}
        options={options}
        onChange={(val) => onChange(Number(val))}
        density="header"
        ariaLabel="표시 행 수"
      />
    </div>
  );
}

function BrowserHeaderDropdown({
  workspaceId,
  runtime,
}: {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updateGeometry = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setGeometry({
        left: rect.right - 180,
        top: rect.bottom + 4,
        width: 180,
      });
    };
    updateGeometry();
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);
    return () => {
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const inputActionLabel = workspaceId === "training" ? "데이터셋 파일" : "입력 폴더";
  const inputSecondaryActionLabel = workspaceId === "inference" ? "데이터셋 파일" : undefined;
  const outputActionLabel = workspaceId === "training" ? "체크포인트 폴더" : "출력 폴더";

  const options: { label: string; onClick: () => void }[] = [];
  options.push({
    label: inputActionLabel,
    onClick: () => runtime.selectInputFolder(workspaceId),
  });

  if (inputSecondaryActionLabel) {
    options.push({
      label: inputSecondaryActionLabel,
      onClick: () => runtime.selectInferenceDatasetFile(),
    });
  }

  options.push({
    label: outputActionLabel,
    onClick: () => runtime.selectOutputFolder(workspaceId),
  });

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="wpf-button wpf-header-control flex size-8 items-center justify-center text-[var(--control-arrow)]"
        title="폴더 및 파일 설정"
      >
        <FolderCog className="size-4" />
      </button>
      {open && geometry
        ? createPortal(
            <DropdownMenuSurface
              ref={menuRef}
              style={{
                left: geometry.left,
                top: geometry.top,
                width: geometry.width,
                maxHeight: 260,
              }}
              className="z-[1000]"
            >
              <DropdownMenuHeader>브라우저 경로 설정</DropdownMenuHeader>
              {options.map((option, idx) => (
                <DropdownMenuOption
                  key={idx}
                  label={option.label}
                  checkable={false}
                  onClick={() => {
                    option.onClick();
                    setOpen(false);
                  }}
                />
              ))}
            </DropdownMenuSurface>,
            document.body
          )
        : null}
    </div>
  );
}
