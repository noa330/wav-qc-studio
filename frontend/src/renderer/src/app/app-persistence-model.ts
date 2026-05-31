import type { DataTableRow, WorkspaceId, WorkspaceSettings } from "@shared/ipc";
import { defaultWorkspaceId } from "@/features/workspaces/model/workspace-config";
import { defaultWorkspaceSettings } from "@/features/workspaces/model/default-settings";
import { createDefaultOverviewFilterState, type OverviewFilterState } from "@/features/workspaces/model/overview-filter";
import { createDefaultTagScoreRules, type TagScoreRule } from "@/features/workspaces/model/pretrained-sed-tagging";
import { createEmptyAudioEditSessionSnapshot, type AudioEditSessionSnapshot } from "@/features/workspaces/state/audio-edit-session";
import { createInitialRuntimeStore, workspaceIds, type WorkspaceRuntimeStore } from "@/features/workspaces/state/workspace-runtime-store";


export type PersistedRowsClipboard = {
  workspaceId: WorkspaceId;
  rows: DataTableRow[];
};

export type PersistedProjectMeta = {
  id: string;
  name: string;
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
};

export type PersistedRuntimeSnapshot = {
  settings: WorkspaceSettings;
  tagScoreRules: TagScoreRule[];
  overviewFilter: OverviewFilterState;
  rowsClipboard?: PersistedRowsClipboard;
  states: WorkspaceRuntimeStore;
};

export type PersistedShellState = {
  selectedWorkspaceId: WorkspaceId;
  sidebarCollapsedByUser: boolean;
  guideAutoShown: boolean;
  theme?: "light" | "dark";
};

export type PersistedDataGridState = {
  pageSize?: number;
  pageIndex?: number;
  columnWidths?: Record<string, number>;
  autoFitColumns?: Record<string, boolean>;
  rowHeights?: Record<string, number>;
  autoFitRowsActive?: boolean;
};

export type PersistedSliceEditorState = {
  viewStart: number;
  viewEnd: number;
  loopPreview: boolean;
};

export type PersistedBatchReplaceState = {
  mode: "bulk" | "single";
  scopes: {
    visible: boolean;
    checked: boolean;
    displayed: boolean;
  };
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  timelineScoreFilterEnabled: boolean;
  timelineScoreThreshold: number;
  selectedIds: Record<string, boolean>;
  pageSize?: number;
};

export type PersistedWorkspaceUiState = {
  outerLayoutSizes: {
    left: number;
    right: number;
  };
  sliceEditor: PersistedSliceEditorState;
  grid: PersistedDataGridState;
  dialogs: {
    overviewEditorOpen: boolean;
    batchReplaceOpen: boolean;
    taggingScoreCutOpen: boolean;
    trainingTensorBoardOpen: boolean;
  };
  batchReplace: PersistedBatchReplaceState;
};

export type PersistedAppState = {
  runtime: PersistedRuntimeSnapshot;
  shell: PersistedShellState;
  workspaceUi: Record<WorkspaceId, PersistedWorkspaceUiState>;
  audioEditSession: AudioEditSessionSnapshot;
};


export function createDefaultPersistedAppState(): PersistedAppState {
  return {
    runtime: createDefaultRuntimeSnapshot(),
    shell: createDefaultShellState(),
    workspaceUi: createDefaultWorkspaceUiStore(),
    audioEditSession: createEmptyAudioEditSessionSnapshot(),
  };
}

export function createDefaultRuntimeSnapshot(): PersistedRuntimeSnapshot {
  return {
    settings: defaultWorkspaceSettings,
    tagScoreRules: createDefaultTagScoreRules(),
    overviewFilter: createDefaultOverviewFilterState(),
    states: createInitialRuntimeStore(),
  };
}

export function createDefaultShellState(): PersistedShellState {
  return {
    selectedWorkspaceId: defaultWorkspaceId,
    sidebarCollapsedByUser: false,
    guideAutoShown: false,
    theme: "dark",
  };
}

export function createDefaultWorkspaceUiStore(): Record<WorkspaceId, PersistedWorkspaceUiState> {
  return Object.fromEntries(workspaceIds.map((workspaceId) => [workspaceId, createDefaultWorkspaceUiState()])) as Record<WorkspaceId, PersistedWorkspaceUiState>;
}

export function createDefaultWorkspaceUiState(): PersistedWorkspaceUiState {
  return {
    outerLayoutSizes: {
      left: 350,
      right: 350,
    },
    sliceEditor: {
      viewStart: 0,
      viewEnd: 1,
      loopPreview: false,
    },
    grid: {},
    dialogs: {
      overviewEditorOpen: false,
      batchReplaceOpen: false,
      taggingScoreCutOpen: false,
      trainingTensorBoardOpen: false,
    },
    batchReplace: {
      mode: "bulk",
      scopes: {
        visible: false,
        checked: false,
        displayed: true,
      },
      query: "",
      replacement: "",
      caseSensitive: false,
      wholeWord: false,
      timelineScoreFilterEnabled: false,
      timelineScoreThreshold: -1,
      selectedIds: {},
      pageSize: 50,
    },
  };
}
