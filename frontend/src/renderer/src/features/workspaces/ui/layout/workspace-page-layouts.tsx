import { useRef } from "react";
import { type WorkspaceLayoutProps, type WorkspacePanelRenderer } from "./workspace-layout-types";
import { PanelStack, ResizableColumns, ResizableRows, useWorkspaceLayoutResizeState } from "./workspace-splitters";
import { useElementBoxSize } from "./workspace-card-overflow";
import { getInlinePanelStackSwitchSize } from "./workspace-panel-sizing";
import type { WorkspaceDefinition } from "../../model/workspace-config";

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
        collapseMode: "none",
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
  const stackInsteadOfInline = rootSize.width > 0 && rootSize.width <= batchTimelineAudioInlineSwitchWidth;

  return (
    <div ref={rootRef} className="h-full min-h-0 min-w-0">
      {stackInsteadOfInline ? (
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
  const stackInsteadOfInline = rootSize.width > 0 && rootSize.width <= taggingInlineCenterStackSwitchWidth;

  return (
    <div ref={rootRef} className="h-full min-h-0 min-w-0">
      {stackInsteadOfInline ? (
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { resizing } = useWorkspaceLayoutResizeState();
  const rootSize = useElementBoxSize(rootRef, resizing);
  const stackInsteadOfInline = rootSize.width > 0 && rootSize.width <= taggingInlineCenterStackSwitchWidth;

  return (
    <div ref={rootRef} className="h-full min-h-0 min-w-0">
      {stackInsteadOfInline ? (
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
