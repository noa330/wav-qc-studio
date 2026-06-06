import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { useAppPersistence } from "@/app/app-persistence";
import { publishWorkspaceActiveTab } from "../shared/workspace-audio-sync";
import { type WorkspaceLayoutProps, type WorkspacePanelRenderer, type PanelCollapseMode } from "./workspace-layout-types";
import { PanelStack, ResizableColumns, ResizableRows, useWorkspaceLayoutResizeState } from "./workspace-splitters";
import { useElementBoxSize, useElementResizeCollapseMode, resolveMeasuredPanelCollapseMode } from "./workspace-card-overflow";
import type { WorkspaceDefinition, WorkspacePanel } from "../../model/workspace-config";
import { cn } from "@/lib/utils";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { WpfCard } from "@/shared/components/wpf-card";
import { renderPanelHeaderControls, resolveAutoCollapseSuppression } from "../panels/WorkspacePanelCard";
import { WorkspaceSelectedAudioInfo } from "../shared/WorkspaceSelectedAudioInfo";
import { focusSliceViewOnRow, setSliceViewRange, type SliceEditorViewActions, type SliceEditorViewContext, type SliceEditorViewState, zoomSliceView } from "../pages/slice/SliceEditorPanel";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";

export const workspaceTableDeckTopRatio = 0.55;

export function isWorkspaceTableDeckPanel(panel: WorkspacePanel): boolean {
  return panel.kind === "table" || panel.kind === "progress";
}

export function findWorkspaceTableDeckPanel(workspace: WorkspaceDefinition): WorkspacePanel | undefined {
  return workspace.center.find(isWorkspaceTableDeckPanel);
}

export function getWorkspaceTopDefinition(workspace: WorkspaceDefinition, tablePanel?: WorkspacePanel): WorkspaceDefinition {
  if (!tablePanel) {
    return workspace;
  }

  return {
    ...workspace,
    center: workspace.center.filter((panel) => panel.id !== tablePanel.id),
  };
}

export function WorkspaceCenterPanels(props: WorkspaceLayoutProps) {
  if (props.workspace.center.length === 1) {
    return renderCenterPanel(props, props.workspace.center[0], "workspace-card-center-a");
  }

  switch (props.workspace.id) {
    case "overview":
      return <OverviewCenterPanels {...props} />;
    case "batch":
      return <BatchCenterPanels {...props} />;
    case "tagging":
      return <TaggingCenterPanels {...props} />;
    case "slice":
      return <SliceCenterPanels {...props} />;
    case "training":
      return <TrainingCenterPanels {...props} />;
    default:
      return <DefaultCenterPanels {...props} />;
  }
}

export function WorkspaceRightPanels(props: WorkspaceLayoutProps) {
  if (props.workspace.right.length < 2) {
    return renderWorkspacePanel(props.renderPanel, {
      workspaceId: props.workspace.id,
      runtime: props.runtime,
      panel: props.workspace.right[0],
      layoutId: "workspace-card-right-a",
      className: "h-full",
      detail: true,
      collapseMode: "none",
    });
  }

  // All pages with 2 right panels use the shared TabbedPanelStack
  return (
    <TabbedPanelStack
      workspaceId={props.workspace.id}
      runtime={props.runtime}
      renderPanel={props.renderPanel}
      firstPanel={props.workspace.right[0]}
      secondPanel={props.workspace.right[1]}
      firstLayoutId="workspace-card-right-a"
      secondLayoutId="workspace-card-right-b"
      showSelectedFile={false}
      panelDetail={true}
    />
  );
}

const playbackStackSizing = { mode: "fill", preferredSize: 242, minSize: 56, flex: 0 } as const;
const trainingPlanStackSizing = { mode: "content", preferredSize: 240, minSize: 56, maxSize: 360 } as const;

function OverviewCenterPanels(props: WorkspaceLayoutProps) {
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: props.workspace.center[0], layoutId: "workspace-card-center-a", defaultRatio: 1 },
        { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", stackSizing: playbackStackSizing },
      ]}
    />
  );
}

function BatchCenterPanels(props: WorkspaceLayoutProps) {
  const leftPanel = props.workspace.center.find((panel) => panel.id === "batch-timeline") ?? props.workspace.center[0];
  const rightPanel = props.workspace.center.find((panel) => panel.id === "batch-audio") ?? props.workspace.center[1];

  if (!leftPanel || !rightPanel) {
    return <DefaultCenterPanels {...props} />;
  }

  return (
    <TabbedPanelStack
      workspaceId={props.workspace.id}
      runtime={props.runtime}
      renderPanel={props.renderPanel}
      firstPanel={rightPanel}
      secondPanel={leftPanel}
      firstLayoutId="workspace-card-center-a"
      secondLayoutId="workspace-card-center-b"
      showSelectedFile={true}
    />
  );
}

function TaggingCenterPanels(props: WorkspaceLayoutProps) {
  const leftPanel = props.workspace.center.find((panel) => panel.id === "tagging-queue") ?? props.workspace.center[1];
  const rightPanel = props.workspace.center.find((panel) => panel.id === "tagging-audio") ?? props.workspace.center[0];

  if (!leftPanel || !rightPanel) {
    return <DefaultCenterPanels {...props} />;
  }

  return (
    <TabbedPanelStack
      workspaceId={props.workspace.id}
      runtime={props.runtime}
      renderPanel={props.renderPanel}
      firstPanel={rightPanel}
      secondPanel={leftPanel}
      firstLayoutId="workspace-card-center-a"
      secondLayoutId="workspace-card-center-b"
      showSelectedFile={true}
    />
  );
}

function SliceCenterPanels(props: WorkspaceLayoutProps) {
  const editorPanel = props.workspace.center.find((panel) => panel.id === "slice-editor") ?? props.workspace.center[0];
  const actionsPanel = props.workspace.center.find((panel) => panel.id === "slice-actions");
  const localSliceEditorContext = useSliceEditorViewContext(props.workspace.id, !props.sliceEditorContext);
  const sliceEditorContext = props.sliceEditorContext ?? localSliceEditorContext;

  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: editorPanel, layoutId: "workspace-card-center-a", stackSizing: { mode: "fill", preferredSize: 430, minSize: 56, flex: 1 }, sliceEditorContext },
        ...(actionsPanel
          ? [{ panel: actionsPanel, layoutId: "workspace-card-center-actions", stackSizing: { mode: "content" as const, preferredSize: 56, minSize: 56, maxSize: 56 }, sliceEditorContext }]
          : []),
      ]}
    />
  );
}

export function useSliceEditorViewContext(workspaceId: WorkspaceId, enabled = true): SliceEditorViewContext {
  const persistence = useAppPersistence();
  const initialWorkspaceUiRef = useRef(persistence.getWorkspaceUiSnapshot(workspaceId));
  const [sliceEditorState, setSliceEditorState] = useState<SliceEditorViewState>(() => initialWorkspaceUiRef.current.sliceEditor);
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const [animateMarkerTransitions, setAnimateMarkerTransitions] = useState(false);
  const markerTransitionTimeoutRef = useRef<number | undefined>(undefined);

  const actions = useMemo<SliceEditorViewActions>(
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

  const triggerMarkerTransitions = useCallback(() => {
    setAnimateMarkerTransitions(true);
    if (markerTransitionTimeoutRef.current !== undefined) {
      window.clearTimeout(markerTransitionTimeoutRef.current);
    }
    markerTransitionTimeoutRef.current = window.setTimeout(() => {
      setAnimateMarkerTransitions(false);
      markerTransitionTimeoutRef.current = undefined;
    }, 220);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    persistence.recordWorkspaceUiSnapshot(workspaceId, { sliceEditor: sliceEditorState });
  }, [enabled, persistence, sliceEditorState, workspaceId]);

  useEffect(() => () => {
    if (markerTransitionTimeoutRef.current !== undefined) {
      window.clearTimeout(markerTransitionTimeoutRef.current);
    }
  }, []);

  return useMemo(
    () => ({
      state: sliceEditorState,
      actions,
      selectedComponentIds,
      setSelectedComponentIds,
      animateMarkerTransitions,
      triggerMarkerTransitions,
    }),
    [actions, animateMarkerTransitions, selectedComponentIds, sliceEditorState, triggerMarkerTransitions],
  );
}

function TrainingCenterPanels(props: WorkspaceLayoutProps) {
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        {
          panel: props.workspace.center[0],
          layoutId: "workspace-card-center-a",
          stackSizing: trainingPlanStackSizing,
        },
        { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", defaultRatio: 1 },
      ]}
    />
  );
}

function DefaultCenterPanels(props: WorkspaceLayoutProps) {
  if (props.workspace.center.length === 2) {
    return (
      <ResizableColumns
        storageKey={`${props.workspace.id}:center-top`}
        initialRatio={0.5}
        left={renderCenterPanel(props, props.workspace.center[0], "workspace-card-center-a")}
        right={renderCenterPanel(props, props.workspace.center[1], "workspace-card-center-b")}
      />
    );
  }

  return (
    <ResizableRows
      storageKey={`${props.workspace.id}:center-main`}
      initialRatio={0.46}
      top={(
        <ResizableColumns
          storageKey={`${props.workspace.id}:center-top`}
          initialRatio={0.66}
          left={renderCenterPanel(props, props.workspace.center[0], "workspace-card-center-a")}
          right={renderCenterPanel(props, props.workspace.center[1], "workspace-card-center-b")}
        />
      )}
      bottom={renderCenterPanel(props, props.workspace.center[2], "workspace-card-center-c")}
    />
  );
}

function stackBaseProps(props: WorkspaceLayoutProps) {
  return {
    workspaceId: props.workspace.id,
    runtime: props.runtime,
    renderPanel: props.renderPanel,
  };
}

function renderCenterPanel(props: WorkspaceLayoutProps, panel: WorkspaceDefinition["center"][number], layoutId: string) {
  return renderWorkspacePanel(props.renderPanel, {
    workspaceId: props.workspace.id,
    runtime: props.runtime,
    panel,
    layoutId,
    className: "min-h-0 min-w-0",
    collapseMode: "none",
    sliceEditorContext: props.sliceEditorContext,
  });
}

function renderWorkspacePanel(renderPanel: WorkspacePanelRenderer, props: Parameters<WorkspacePanelRenderer>[0]) {
  return renderPanel(props);
}
// ─── Tabbed Panel Stack ────────────────────────────────────────────────────
// Shared single-card container for two panels with a unified underline tab bar.
// The tab bar IS the card header: tabs on the left, active-panel controls on the right.
// Both panels are kept mounted (display:none for inactive) to preserve stateful
// component state (audio, scroll, etc.) across tab switches.
//
// Used for:
//   - Center panels: Tagging (스키마 / 오디오재생), Script (타임라인 / 오디오재생)
//   - Right panels:  De-noise, Score, Script, Training, Inference (모델선택 / 설정)

type TabbedPanelStackProps = {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
  renderPanel: WorkspacePanelRenderer;
  firstPanel: WorkspacePanel;
  secondPanel: WorkspacePanel;
  firstLayoutId: string;
  secondLayoutId: string;
  /** Show the selected audio file info row between header and bodies. Default true for center, false for right. */
  showSelectedFile?: boolean;
  /** Pass detail=true to panel bodies (right panels use p-5 padding). Default false. */
  panelDetail?: boolean;
};

function TabbedPanelStack({
  workspaceId,
  runtime,
  renderPanel,
  firstPanel,
  secondPanel,
  firstLayoutId,
  secondLayoutId,
  showSelectedFile = false,
  panelDetail = false,
}: TabbedPanelStackProps) {
  const [activeId, setActiveId] = useState<string>(firstPanel.id);
  const underlineId = `${workspaceId}-${firstLayoutId}-tabs`;
  const activePanel = activeId === firstPanel.id ? firstPanel : secondPanel;
  const workspaceState = runtime.getState(workspaceId);
  const publishesAudioActiveTab = firstPanel.kind === "playback" || secondPanel.kind === "playback";
  const guideFocusPanelId = runtime.guideMode?.focusPanelId;

  const stackRef = useRef<HTMLElement | null>(null);
  const { resizing: layoutResizing, axis: layoutResizeAxis } = useWorkspaceLayoutResizeState();
  const previousMeasuredCollapseModeRef = useRef<PanelCollapseMode>("none");
  const activeAutoCollapseSuppression = resolveAutoCollapseSuppression(undefined, layoutResizing ? layoutResizeAxis : undefined, previousMeasuredCollapseModeRef.current);
  const stackSize = useElementBoxSize(stackRef, layoutResizing);
  const resizeCollapseMode = useElementResizeCollapseMode(stackRef, layoutResizing, "none", activeAutoCollapseSuppression);
  const measuredCollapseMode = resizeCollapseMode ?? resolveMeasuredPanelCollapseMode("none", stackSize, activeAutoCollapseSuppression);

  useEffect(() => {
    previousMeasuredCollapseModeRef.current = measuredCollapseMode;
  }, [measuredCollapseMode]);

  const isCollapsed = measuredCollapseMode !== "none";
  const verticalCollapsed = measuredCollapseMode === "vertical";
  const horizontalCollapsed = measuredCollapseMode === "horizontal";
  const compactCollapsed = measuredCollapseMode === "compact";

  useEffect(() => {
    if (guideFocusPanelId === firstPanel.id || guideFocusPanelId === secondPanel.id) {
      setActiveId(guideFocusPanelId);
    }
  }, [firstPanel.id, guideFocusPanelId, secondPanel.id]);

  useEffect(() => {
    if (!publishesAudioActiveTab) {
      return;
    }

    publishWorkspaceActiveTab(workspaceId, activeId, activePanel.kind === "playback");
  }, [workspaceId, activeId, activePanel.kind, publishesAudioActiveTab]);

  return (
    <WpfCard ref={stackRef} className="flex h-full min-h-0 min-w-0 flex-col">
      {isCollapsed ? (
        <div className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          verticalCollapsed && "h-full items-center px-2 py-4",
          compactCollapsed && "items-center p-1",
          horizontalCollapsed && "justify-center p-4"
        )}>
          <div className={cn("flex min-h-[24px] min-w-0 items-center justify-between gap-2 overflow-hidden", verticalCollapsed && "h-full min-h-0 flex-col justify-start gap-3 overflow-hidden", compactCollapsed && "flex-col justify-start gap-0.5 overflow-hidden")}>
            <div className={cn("flex min-w-0 shrink items-center gap-2 text-left", verticalCollapsed && "min-h-0 flex-1 flex-col justify-start", compactCollapsed && "justify-center")}>
              {verticalCollapsed ? (
                <h3 key="vertical-title" className="[writing-mode:vertical-rl] min-h-0 flex-1 truncate text-base font-semibold leading-5 text-[var(--primary-text)]">{activePanel.title}</h3>
              ) : compactCollapsed ? null : (
                <h3 key="normal-title" className="min-w-0 truncate whitespace-nowrap text-base font-semibold leading-5 text-[var(--primary-text)]">{activePanel.title}</h3>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Unified card header: tabs left, active-panel controls + ellipsis right */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--panel-stroke)] px-4 pt-[10px]">
            {/* Tab group — fit-content width, underline sits on the border-b below */}
            <div className="flex items-center gap-0">
              <MotionUnderlineTab
                label={firstPanel.title}
                active={activeId === firstPanel.id}
                onClick={() => setActiveId(firstPanel.id)}
                underlineId={underlineId}
              />
              <MotionUnderlineTab
                label={secondPanel.title}
                active={activeId === secondPanel.id}
                onClick={() => setActiveId(secondPanel.id)}
                underlineId={underlineId}
              />
            </div>
            {/* Active-panel controls — swap when tab changes */}
            <div className="flex h-8 shrink-0 items-center gap-2">
              {renderPanelHeaderControls(workspaceId, activePanel, runtime, true, workspaceState)}
            </div>
          </div>

          {/* Selected file info — only shown for center panels (showSelectedFile=true) when a file is selected. */}
          {showSelectedFile && workspaceState.selectedAudioPath ? (
            <div className="shrink-0 px-4 pt-3 pb-[12px]">
              <WorkspaceSelectedAudioInfo
                audioPath={workspaceState.selectedAudioPath}
              />
            </div>
          ) : null}
        </>
      )}

      {/* Panel bodies — both mounted, inactive hidden via CSS */}
      <div className="relative min-h-0 flex-1" style={{ display: isCollapsed ? "none" : undefined }}>
        <div
          className="h-full min-h-0"
          style={{ display: activeId === firstPanel.id ? undefined : "none" }}
          aria-hidden={activeId !== firstPanel.id}
        >
          {renderPanel({
            workspaceId,
            runtime,
            panel: firstPanel,
            layoutId: firstLayoutId,
            className: "h-full min-h-0 min-w-0",
            collapseMode: "none",
            cardMode: "tabbed",
            detail: panelDetail,
          })}
        </div>
        <div
          className="h-full min-h-0"
          style={{ display: activeId === secondPanel.id ? undefined : "none" }}
          aria-hidden={activeId !== secondPanel.id}
        >
          {renderPanel({
            workspaceId,
            runtime,
            panel: secondPanel,
            layoutId: secondLayoutId,
            className: "h-full min-h-0 min-w-0",
            collapseMode: "none",
            cardMode: "tabbed",
            detail: panelDetail,
          })}
        </div>
      </div>
    </WpfCard>
  );
}
