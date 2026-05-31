import { useState, useEffect } from "react";
import { publishWorkspaceActiveTab } from "../shared/workspace-audio-sync";
import { type WorkspaceLayoutProps, type WorkspacePanelRenderer } from "./workspace-layout-types";
import { PanelStack, ResizableColumns, ResizableRows } from "./workspace-splitters";
import type { WorkspaceDefinition, WorkspacePanel } from "../../model/workspace-config";
import { MotionUnderlineTab } from "@/shared/components/motion-tabs";
import { WpfCard } from "@/shared/components/wpf-card";
import { renderPanelHeaderControls, PanelCardSelectedFileInfo } from "../panels/WorkspacePanelCard";
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
    case "speaker":
      return <SpeakerCenterPanels {...props} />;
    case "training":
      return <TrainingCenterPanels {...props} />;
    case "inference":
      return <InferenceCenterPanels {...props} />;
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
const comparisonPlaybackStackSizing = { mode: "fill", preferredSize: 278, minSize: 56, flex: 0 } as const;
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
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: props.workspace.center[0], layoutId: "workspace-card-center-a", stackSizing: { mode: "fill", preferredSize: 430, minSize: 56, flex: 0 } },
        { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", defaultRatio: 1 },
      ]}
    />
  );
}

function SpeakerCenterPanels(props: WorkspaceLayoutProps) {
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: props.workspace.center[0], layoutId: "workspace-card-center-a", defaultRatio: 1 },
        { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", stackSizing: comparisonPlaybackStackSizing },
      ]}
    />
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

function InferenceCenterPanels(props: WorkspaceLayoutProps) {
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: props.workspace.center[0], layoutId: "workspace-card-center-a", defaultRatio: 1 },
        { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", stackSizing: comparisonPlaybackStackSizing },
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

  useEffect(() => {
    publishWorkspaceActiveTab(workspaceId, activeId);
  }, [workspaceId, activeId]);

  return (
    <WpfCard className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Unified card header: tabs left, active-panel controls + ellipsis right */}
      <div className="shrink-0 flex items-end justify-between gap-2 px-4 pt-4 pb-0">
        {/* Tab group — fit-content width, underline sits on the border-b below */}
        <div className="flex items-end gap-0">
          <MotionUnderlineTab
            label={firstPanel.title}
            active={activeId === firstPanel.id}
            onClick={() => setActiveId(firstPanel.id)}
            className="px-3 pb-3 pt-[6px]"
            underlineId={underlineId}
          />
          <MotionUnderlineTab
            label={secondPanel.title}
            active={activeId === secondPanel.id}
            onClick={() => setActiveId(secondPanel.id)}
            className="px-3 pb-3 pt-[6px]"
            underlineId={underlineId}
          />
        </div>
        {/* Active-panel controls — swap when tab changes */}
        <div className="flex shrink-0 items-center gap-2 pb-3">
          {renderPanelHeaderControls(workspaceId, activePanel, runtime, true, workspaceState)}
        </div>
      </div>
      {/* Divider line that the tab underlines sit on */}
      <div className="shrink-0 border-b border-[var(--panel-stroke)] mx-0" />

      {/* Selected file info — only shown for center panels (showSelectedFile=true) when a file is selected. */}
      {showSelectedFile && workspaceState.selectedAudioPath ? (
        <div className="shrink-0 px-4 pt-3 pb-0">
          <PanelCardSelectedFileInfo
            selectedAudioPath={workspaceState.selectedAudioPath}
            inputPath={workspaceState.inputPath}
          />
        </div>
      ) : null}

      {/* Panel bodies — both mounted, inactive hidden via CSS */}
      <div className="relative min-h-0 flex-1">
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
