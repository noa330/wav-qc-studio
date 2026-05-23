import { useRef } from "react";
import { isCollapsedMode, type PanelCollapseMode, type WorkspaceLayoutProps, type WorkspacePanelItem, type WorkspacePanelRenderer } from "./workspace-layout-types";
import { PanelStack, ResizableColumns, ResizableRows, useWorkspaceLayoutResizeState } from "./workspace-splitters";
import { useElementBoxSize } from "./workspace-card-overflow";
import { getInlinePanelStackSwitchSize } from "./workspace-panel-sizing";
import type { WorkspaceDefinition } from "../../model/workspace-config";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";

export function getWorkspacePanelItems(workspace: WorkspaceDefinition): WorkspacePanelItem[] {
  const rightItems = workspace.right.map((panel, index) => ({
    panel,
    layoutId: getRightPanelLayoutId(index),
    detail: workspace.id === "speaker" ? index === 1 : workspace.id === "overview" || workspace.id === "batch" || workspace.id === "training" ? index === 1 : true,
  }));

  return [
    { panel: workspace.left, layoutId: "workspace-card-left" },
    ...workspace.center.map((panel, index) => ({ panel, layoutId: getCenterPanelLayoutId(workspace, index) })),
    ...rightItems,
  ];
}

function getCenterPanelLayoutId(workspace: WorkspaceDefinition, index: number): string | undefined {
  const letters = ["a", "b", "c"] as const;

  if (workspace.id === "batch") {
    if (index === 1) {
      return "workspace-card-center-a";
    }
    if (index === 2) {
      return "workspace-card-center-b";
    }
    if (index === 0) {
      return "workspace-card-center-c";
    }
    return undefined;
  }

  if (workspace.id === "overview") {
    if (index === 0) {
      return "workspace-card-center-a";
    }
    if (index === 1) {
      return "workspace-card-center-b";
    }
    return undefined;
  }

  if (workspace.id === "tagging") {
    if (index === 1) {
      return "workspace-card-center-a";
    }
    if (index === 0) {
      return "workspace-card-center-b";
    }
    if (index === 2) {
      return "workspace-card-center-c";
    }
    return undefined;
  }

  const letter = letters[index];
  return letter ? `workspace-card-center-${letter}` : undefined;
}

function getRightPanelLayoutId(index: number): string | undefined {
  const letters = ["a", "b"] as const;
  const letter = letters[index];
  return letter ? `workspace-card-right-${letter}` : undefined;
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
  switch (props.workspace.id) {
    case "speaker":
      return <SpeakerRightPanels {...props} />;
    case "overview":
    case "batch":
    case "training":
    case "inference":
      return <TwoCardRightPanels {...props} />;
    default:
      return renderWorkspacePanel(props.renderPanel, {
        workspaceId: props.workspace.id,
        runtime: props.runtime,
        panel: props.workspace.right[0],
        layoutId: "workspace-card-right-a",
        className: "h-full",
        detail: true,
        collapseMode: props.panelCollapseModes[props.workspace.right[0].id] ?? "none",
        onCollapseModeChange: (mode) => props.onPanelCollapseModeChange(props.workspace.right[0].id, mode),
      });
  }
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { resizing } = useWorkspaceLayoutResizeState();
  const rootSize = useElementBoxSize(rootRef, resizing);
  const timelineCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[1].id]);
  const audioCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[2].id]);
  const stackInsteadOfInline = rootSize.width > 0 && rootSize.width <= batchTimelineAudioInlineSwitchWidth;

  return (
    <div ref={rootRef} className="h-full min-h-0 min-w-0">
      {timelineCollapsed || audioCollapsed || stackInsteadOfInline ? (
        <PanelStack
          {...stackBaseProps(props)}
          items={[
            { panel: props.workspace.center[1], layoutId: "workspace-card-center-a" },
            { panel: props.workspace.center[2], layoutId: "workspace-card-center-b", stackSizing: playbackStackSizing },
            { panel: props.workspace.center[0], layoutId: "workspace-card-center-c", defaultRatio: 1 },
          ]}
        />
      ) : (
        <ResizableRows
          storageKey={`${props.workspace.id}:center-main`}
          initialRatio={0.34}
          top={(
            <ResizableColumns
              storageKey={`${props.workspace.id}:timeline-audio`}
              initialRatio={batchTimelineAudioInitialRatio}
              left={renderCenterPanel(props, props.workspace.center[1], "workspace-card-center-a")}
              right={renderCenterPanel(props, props.workspace.center[2], "workspace-card-center-b")}
            />
          )}
          bottom={renderCenterPanel(props, props.workspace.center[0], "workspace-card-center-c")}
        />
      )}
    </div>
  );
}

const taggingSchemaAudioInitialRatio = 0.58;
const taggingInlineCenterStackSwitchWidth = getInlinePanelStackSwitchSize(2, undefined, Math.min(taggingSchemaAudioInitialRatio, 1 - taggingSchemaAudioInitialRatio));
const batchTimelineAudioInitialRatio = taggingSchemaAudioInitialRatio;
const batchTimelineAudioInlineSwitchWidth = taggingInlineCenterStackSwitchWidth;

function TaggingCenterPanels(props: WorkspaceLayoutProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { resizing } = useWorkspaceLayoutResizeState();
  const rootSize = useElementBoxSize(rootRef, resizing);
  const audioCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[0].id]);
  const schemaCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[1].id]);
  const stackInsteadOfInline = rootSize.width > 0 && rootSize.width <= taggingInlineCenterStackSwitchWidth;

  return (
    <div ref={rootRef} className="h-full min-h-0 min-w-0">
      {audioCollapsed || schemaCollapsed || stackInsteadOfInline ? (
        <PanelStack
          {...stackBaseProps(props)}
          items={[
            { panel: props.workspace.center[1], layoutId: "workspace-card-center-a" },
            { panel: props.workspace.center[0], layoutId: "workspace-card-center-b", stackSizing: playbackStackSizing },
            { panel: props.workspace.center[2], layoutId: "workspace-card-center-c" },
          ]}
        />
      ) : (
        <ResizableRows
          storageKey={`${props.workspace.id}:center-main`}
          initialRatio={0.34}
          top={(
            <ResizableColumns
              storageKey={`${props.workspace.id}:schema-audio`}
              initialRatio={taggingSchemaAudioInitialRatio}
              left={renderCenterPanel(props, props.workspace.center[1], "workspace-card-center-a")}
              right={renderCenterPanel(props, props.workspace.center[0], "workspace-card-center-b")}
            />
          )}
          bottom={renderCenterPanel(props, props.workspace.center[2], "workspace-card-center-c")}
        />
      )}
    </div>
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
  const planCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[0].id]);
  const resultsCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[1].id]);
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        {
          panel: props.workspace.center[0],
          layoutId: "workspace-card-center-a",
          stackSizing: planCollapsed || resultsCollapsed ? { ...trainingPlanStackSizing, maxSize: 280 } : trainingPlanStackSizing,
        },
        { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", defaultRatio: 1 },
      ]}
    />
  );
}

function InferenceCenterPanels(props: WorkspaceLayoutProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { resizing } = useWorkspaceLayoutResizeState();
  const rootSize = useElementBoxSize(rootRef, resizing);
  const referenceCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[0].id]);
  const outputCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[1].id]);
  const stackInsteadOfInline = rootSize.width > 0 && rootSize.width <= taggingInlineCenterStackSwitchWidth;

  return (
    <div ref={rootRef} className="h-full min-h-0 min-w-0">
      {referenceCollapsed || outputCollapsed || stackInsteadOfInline ? (
        <PanelStack
          {...stackBaseProps(props)}
          items={[
            { panel: props.workspace.center[0], layoutId: "workspace-card-center-a", stackSizing: playbackStackSizing },
            { panel: props.workspace.center[1], layoutId: "workspace-card-center-b", stackSizing: playbackStackSizing },
            { panel: props.workspace.center[2], layoutId: "workspace-card-center-c", defaultRatio: 1 },
          ]}
        />
      ) : (
        <ResizableRows
          storageKey={`${props.workspace.id}:center-main`}
          initialRatio={0.48}
          top={(
            <ResizableColumns
              storageKey={`${props.workspace.id}:reference-output`}
              initialRatio={0.5}
              left={renderCenterPanel(props, props.workspace.center[0], "workspace-card-center-a")}
              right={renderCenterPanel(props, props.workspace.center[1], "workspace-card-center-b")}
            />
          )}
          bottom={renderCenterPanel(props, props.workspace.center[2], "workspace-card-center-c")}
        />
      )}
    </div>
  );
}

function DefaultCenterPanels(props: WorkspaceLayoutProps) {
  const topCardCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[0].id]);
  const queueCollapsed = isCollapsedMode(props.panelCollapseModes[props.workspace.center[1].id]);
  if (topCardCollapsed || queueCollapsed) {
    return (
      <PanelStack
        {...stackBaseProps(props)}
        items={[
          { panel: props.workspace.center[0], layoutId: "workspace-card-center-a" },
          { panel: props.workspace.center[1], layoutId: "workspace-card-center-b" },
          { panel: props.workspace.center[2], layoutId: "workspace-card-center-c" },
        ]}
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

const rightSelectorPlaybackLikeSizing = { mode: "content", preferredSize: 236, minSize: 56, maxSize: null } as const;
const rightTailFillSizing = { mode: "fill", minSize: 56, flex: 1 } as const;

function SpeakerRightPanels(props: WorkspaceLayoutProps) {
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: props.workspace.right[0], layoutId: "workspace-card-right-a", stackSizing: rightSelectorPlaybackLikeSizing },
        { panel: props.workspace.right[1], layoutId: "workspace-card-right-b", detail: true, stackSizing: rightTailFillSizing },
      ]}
    />
  );
}

function TwoCardRightPanels(props: WorkspaceLayoutProps) {
  return (
    <PanelStack
      {...stackBaseProps(props)}
      items={[
        { panel: props.workspace.right[0], layoutId: "workspace-card-right-a", stackSizing: rightSelectorPlaybackLikeSizing },
        { panel: props.workspace.right[1], layoutId: "workspace-card-right-b", detail: true, stackSizing: rightTailFillSizing },
      ]}
    />
  );
}

export function HorizontalPanelRail({
  workspaceId,
  runtime,
  items,
  onPanelCollapseModeChange,
  paddingRight,
  renderPanel,
}: {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
  items: WorkspacePanelItem[];
  onPanelCollapseModeChange: (panelId: string, mode: PanelCollapseMode) => void;
  paddingRight: number;
  renderPanel: WorkspacePanelRenderer;
}) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-3 overflow-hidden" style={{ paddingRight }}>
      {items.map((item) => (
        <div key={item.panel.id} className="min-w-0">
          {renderPanel({
            workspaceId,
            panel: item.panel,
            runtime,
            className: item.className,
            detail: item.detail,
            layoutId: item.layoutId,
            collapseMode: "horizontal",
            onCollapseModeChange: (mode) => onPanelCollapseModeChange(item.panel.id, mode),
          })}
        </div>
      ))}
    </div>
  );
}

export function RightCollapseRail({
  workspaceId,
  runtime,
  verticalItems,
  compactItems,
  onPanelCollapseModeChange,
  renderPanel,
}: {
  workspaceId: WorkspaceId;
  runtime: WorkspaceRuntime;
  verticalItems: WorkspacePanelItem[];
  compactItems: WorkspacePanelItem[];
  onPanelCollapseModeChange: (panelId: string, mode: PanelCollapseMode) => void;
  renderPanel: WorkspacePanelRenderer;
}) {
  return (
    <div className="flex h-full min-h-0 shrink-0 items-stretch justify-end gap-3 overflow-hidden">
      {verticalItems.length > 0 ? (
        <div className="flex h-full min-h-0 shrink-0 items-stretch gap-3 overflow-hidden">
          {verticalItems.map((item) => (
            <div key={item.panel.id} className="h-full min-h-0 w-[56px] shrink-0">
              {renderPanel({
                workspaceId,
                panel: item.panel,
                runtime,
                className: item.className,
                detail: item.detail,
                layoutId: item.layoutId,
                collapseMode: "vertical",
                onCollapseModeChange: (mode) => onPanelCollapseModeChange(item.panel.id, mode),
              })}
            </div>
          ))}
        </div>
      ) : null}
      {compactItems.length > 0 ? (
        <div className="flex h-full w-[56px] shrink-0 flex-col gap-3 overflow-hidden">
          {compactItems.map((item) => (
            <div key={item.panel.id} className="h-[56px] w-[56px] shrink-0">
              {renderPanel({
                workspaceId,
                panel: item.panel,
                runtime,
                className: item.className,
                detail: item.detail,
                layoutId: item.layoutId,
                collapseMode: "compact",
                onCollapseModeChange: (mode) => onPanelCollapseModeChange(item.panel.id, mode),
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function stackBaseProps(props: WorkspaceLayoutProps) {
  return {
    workspaceId: props.workspace.id,
    runtime: props.runtime,
    panelCollapseModes: props.panelCollapseModes,
    onPanelCollapseModeChange: props.onPanelCollapseModeChange,
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
    collapseMode: props.panelCollapseModes[panel.id] ?? "none",
    onCollapseModeChange: (mode) => props.onPanelCollapseModeChange(panel.id, mode),
  });
}

function renderWorkspacePanel(renderPanel: WorkspacePanelRenderer, props: Parameters<WorkspacePanelRenderer>[0]) {
  return renderPanel(props);
}
