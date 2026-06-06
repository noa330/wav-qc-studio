import type { ReactNode } from "react";
import type { WorkspaceId } from "@shared/ipc";
import type { WorkspaceDefinition, WorkspacePanel } from "../../model/workspace-config";
import type { WorkspaceRuntime } from "../../state/use-workspace-runtime";
import type { SliceEditorViewContext } from "../pages/slice/SliceEditorPanel";

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
  sliceEditorContext?: SliceEditorViewContext;
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
  sliceEditorContext?: SliceEditorViewContext;
  /** "tabbed": panel is embedded inside a TabbedPanelStack — no card chrome or header row. */
  cardMode?: "standalone" | "tabbed";
};

export type WorkspacePanelRenderer = (props: WorkspacePanelRenderProps) => ReactNode;

export type WorkspaceLayoutProps = {
  workspace: WorkspaceDefinition;
  runtime: WorkspaceRuntime;
  renderPanel: WorkspacePanelRenderer;
  sliceEditorContext?: SliceEditorViewContext;
};
