import type { WorkspaceId } from "@shared/ipc";
import type { SpotlightTourStep } from "@/shared/components/spotlight-tour";

export type AppGuideTourStep = SpotlightTourStep & {
  workspaceId: WorkspaceId;
  focusPanelId?: string;
  terminalOpen?: boolean;
};
