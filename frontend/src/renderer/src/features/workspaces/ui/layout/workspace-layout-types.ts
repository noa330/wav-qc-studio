import type { ReactNode } from "react";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceDefinition, WorkspacePanel } from "../../model/workspace-config";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";

export type PanelCollapseMode = "none" | "horizontal" | "vertical" | "compact";
export type WorkspaceResizeAxis = "width" | "height";
export type PanelAutoCollapseSuppression = Partial<Record<WorkspaceResizeAxis, boolean>>;

export type WorkspacePanelStackSizing = {
  mode?: "content" | "fill";
  preferredSize?: number;
  minSize?: number;
  maxSize?: number | null;
  flex?: number;
};

export type WorkspacePanelItem = {
  panel: WorkspacePanel;
  className?: string;
  detail?: boolean;
  layoutId?: string;
  defaultRatio?: number;
  stackSizing?: WorkspacePanelStackSizing;
};

export type WorkspacePanelRenderProps = {
  layoutId?: string;
  workspaceId: WorkspaceId;
  panel: WorkspacePanel;
  runtime: WorkspaceRuntime;
  className?: string;
  detail?: boolean;
  collapseMode: PanelCollapseMode;
  contentSizing?: boolean;
  autoCollapseSuppression?: PanelAutoCollapseSuppression;
  onCollapseModeChange: (mode: PanelCollapseMode) => void;
};

export type WorkspacePanelRenderer = (props: WorkspacePanelRenderProps) => ReactNode;

export type WorkspaceLayoutProps = {
  workspace: WorkspaceDefinition;
  runtime: WorkspaceRuntime;
  panelCollapseModes: Record<string, PanelCollapseMode>;
  onPanelCollapseModeChange: (panelId: string, mode: PanelCollapseMode) => void;
  renderPanel: WorkspacePanelRenderer;
};

export function isCollapsedMode(mode: PanelCollapseMode | undefined): boolean {
  return mode === "vertical" || mode === "horizontal" || mode === "compact";
}
