import type { Dispatch, SetStateAction } from "react";
import type { DataTable, DataTableRow, FileTreeNode, WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import { createDefaultOverviewFilterState, type OverviewFilterState } from "@/features/workspaces/model/overview-filter";
import type { TagScoreRule } from "@/features/workspaces/model/pretrained-sed-tagging";
import type { WorkspaceRuntime } from "@/features/workspaces/state/use-workspace-runtime";
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

  const getGuideState = (workspaceId: WorkspaceId) => createGuideWorkspaceState(workspaceId, activeStepId);

  return {
    ...base,
    guideMode: {
      activeStepId,
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
    mergeEnabledBatchSpeakers: noop,
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
