import type { Dispatch, SetStateAction } from "react";
import type { DataTable, DataTableRow, FileTreeNode, WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import { createDefaultOverviewFilterState, type OverviewFilterState } from "@/features/workspaces/model/overview-filter";
import type { TagScoreRule } from "@/features/workspaces/model/pretrained-sed-tagging";
import type { WorkspaceRuntime } from "@/features/workspaces/state/use-workspace-runtime";
import type { SpotlightTourTarget } from "@/shared/components/spotlight-tour";
import type { AppGuideStepId, AppGuideTourStep } from "./app-tour-steps";
import {
  createGuideMetrics,
  createGuideSettings,
  createGuideTagScoreRules,
  createGuideWorkspaceState,
} from "./app-guide-data";

const noop = () => undefined;
const noopAsync = async () => undefined;

const ignoreSettingsUpdate: Dispatch<SetStateAction<WorkspaceSettings>> = noop;
const ignoreTagRulesUpdate: Dispatch<SetStateAction<TagScoreRule[]>> = noop;
const ignoreOverviewFilterUpdate: Dispatch<SetStateAction<OverviewFilterState>> = noop;

export function createGuideRuntime(base: WorkspaceRuntime, step: AppGuideTourStep): WorkspaceRuntime {
  const settings = createGuideSettings(base.settings);
  const overviewFilter = createDefaultOverviewFilterState();
  const activeStepId = step.id as AppGuideStepId;
  const guideStateCache = new Map<WorkspaceId, ReturnType<typeof createGuideWorkspaceState>>();

  const getGuideState = (workspaceId: WorkspaceId) => {
    const cached = guideStateCache.get(workspaceId);
    if (cached) {
      return cached;
    }

    const nextState = createGuideWorkspaceState(workspaceId, activeStepId);
    guideStateCache.set(workspaceId, nextState);
    return nextState;
  };

  return {
    ...base,
    guideMode: {
      activeStepId,
      focusPanelId: step.focusPanelId ?? inferGuideFocusPanelId(step.target),
      terminalOpen: Boolean(step.terminalOpen),
    },
    settings,
    setSettings: ignoreSettingsUpdate,
    tagScoreRules: createGuideTagScoreRules(),
    setTagScoreRules: ignoreTagRulesUpdate,
    overviewFilter,
    setOverviewFilter: ignoreOverviewFilterUpdate,
    getState: getGuideState,
    getTable: (workspaceId: WorkspaceId): DataTable => getGuideState(workspaceId).table,
    getMetrics: (workspaceId: WorkspaceId): string[] => createGuideMetrics(workspaceId, getGuideState(workspaceId)),
    getClipboardRows: (): DataTableRow[] => [],
    selectSheet: noop,
    createSheet: noop,
    copyRows: noop,
    pasteRows: noop,
    canRun: () => false,
    canRetry: () => false,
    canExport: () => false,
    cancelWorkspace: noopAsync,
    cancelBatchSpeakerDiarization: noopAsync,
    clearError: noop,
    clearTerminal: noop,
    selectInputFolder: noopAsync,
    selectOutputFolder: noopAsync,
    loadFileBrowserWindow: noopAsync,
    selectFileNode: (_workspaceId: WorkspaceId, _node: FileTreeNode) => undefined,
    selectRow: noop,
    selectRows: noop,
    selectAdjacentRow: noop,
    toggleRowExportCheck: noop,
    setAllRowExportChecks: noop,
    setRowsExportChecks: noop,
    setBatchFilter: noop,
    setTableSearch: noop,
    editBatchCell: noop,
    toggleBatchSpeaker: noop,
    runBatchSpeakerDiarization: noopAsync,
    mergeEnabledBatchSpeakers: (_speakerNames?: string[]) => undefined,
    renameBatchSpeaker: noop,
    runSelectedSpeakersDiarization: noopAsync,
    splitOrUnmergeSliceSegment: noop,
    mergeSliceSegments: noop,
    addSliceSegment: noop,
    deleteSliceSegment: noop,
    updateSliceSegmentBounds: noop,
    run: noopAsync,
    retry: noopAsync,
    exportWorkspace: noopAsync,
    syncTrainingModelCheckpoints: noop,
  };
}

function inferGuideFocusPanelId(target: SpotlightTourTarget): string | undefined {
  const selectors = getGuideTargetSelectors(target);

  for (const selector of selectors) {
    const match = selector.match(/\[data-app-tour-panel-id=(?:"([^"]+)"|'([^']+)')\]/);
    const panelId = match?.[1] ?? match?.[2];
    if (panelId) {
      return panelId;
    }
  }

  return undefined;
}

function getGuideTargetSelectors(target: SpotlightTourTarget): readonly string[] {
  if (typeof target === "string") {
    return [target];
  }

  if ("selectors" in target) {
    return typeof target.selectors === "string" ? [target.selectors] : target.selectors;
  }

  return target;
}
