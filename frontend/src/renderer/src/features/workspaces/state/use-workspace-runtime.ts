import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  DataTable,
  DataTableRow,
  FileTreeNode,
  FileTreeResult,
  TrainingCheckpointSummary,
  TrainingModelSummary,
  VoiceModelRuntimeInstallResult,
  VoiceModelRuntimeStatus,
  WorkspaceExportProgressEvent,
  WorkspaceExportResult,
  WorkspaceId,
  WorkspaceRunProgressEvent,
  WorkspaceRunResult,
  WorkspaceSettings,
  WorkspaceTerminalUpdate,
  WorkspaceRuntimeEnvironmentInstallResult,
  WorkspaceRuntimeEnvironmentStatus,
} from "@shared/ipc";
import type { ScrollWindowMetrics } from "@shared/scroll-window";
import { useAppPersistence, type PersistedRuntimeSnapshot } from "@/app/app-persistence";
import { createEmptyWorkspaceTable, workspaceTableColumns } from "@shared/table-schemas";
import { studioBackend } from "@/services/studio-backend";
import { getAudioEditExportMap } from "./audio-edit-session";
import {
  applyTagScoreRulesToTable,
  createDefaultTagScoreRules,
  mergeTagScoreRulesFromTable,
  type TagScoreRule,
} from "../model/pretrained-sed-tagging";
import { collectBatchSpeakers, filterBatchTable, type BatchFilterState } from "../model/batch-filter";
import { defaultWorkspaceSettings } from "../model/default-settings";
import { settingsWithGptSovitsAutoCheckpoints } from "../model/voice-training-checkpoints";
import {
  createDefaultOverviewFilterState,
  filterOverviewTable,
  type OverviewFilterState,
} from "../model/overview-filter";
import {
  buildBatchJobs,
  findFirstAudioPath,
  findRowForPath,
  firstNonVirtualPath,
  isAudioPath,
  resolveAudioSelection,
  resolveSliceSourceIdentity,
  resolveSliceSourcePath,
  wavCacheFileNameKey,
} from "../model/workspace-runtime-selection";
import {
  numberFromSliceRow,
  partitionSliceComponents,
  readSliceComponents,
  readSliceRowBounds,
  retimeSliceComponents,
  serializeSliceComponents,
  splitSingleSliceComponent,
  type SliceComponent,
} from "../model/slice-segments";
import {
  activeSheet,
  createInitialRuntimeStore,
  createWorkspaceResultSheet,
  nextSheetLabel,
  resultSheetHasRows,
  stateWithActiveSheet,
  terminalStateFromUpdate,
  updateActiveSheet,
  workspaceRuntimeReducer,
  type WorkspaceRuntimeState,
  type WorkspaceTerminalStatus,
  type WorkspaceResultSheet,
  type WorkspaceTrainingIdentity,
} from "./workspace-runtime-store";

export type { WorkspaceRuntimeState } from "./workspace-runtime-store";

export type WorkspaceRuntime = {
  guideMode?: {
    activeStepId: string;
    terminalOpen: boolean;
  };
  settings: WorkspaceSettings;
  setSettings: Dispatch<SetStateAction<WorkspaceSettings>>;
  tagScoreRules: TagScoreRule[];
  setTagScoreRules: Dispatch<SetStateAction<TagScoreRule[]>>;
  overviewFilter: OverviewFilterState;
  setOverviewFilter: Dispatch<SetStateAction<OverviewFilterState>>;
  getState: (workspaceId: WorkspaceId) => WorkspaceRuntimeState;
  getTable: (workspaceId: WorkspaceId) => DataTable;
  getMetrics: (workspaceId: WorkspaceId) => string[];
  getClipboardRows: (workspaceId: WorkspaceId) => DataTableRow[];
  selectSheet: (workspaceId: WorkspaceId, sheetId: string) => void;
  createSheet: (workspaceId: WorkspaceId) => void;
  deleteSheet: (workspaceId: WorkspaceId) => void;
  copyRows: (workspaceId: WorkspaceId, rowIds: string[]) => void;
  pasteRows: (workspaceId: WorkspaceId, duplicateMode: "overwrite" | "skip") => void;
  canRun: (workspaceId: WorkspaceId) => boolean;
  canRetry: (workspaceId: WorkspaceId) => boolean;
  canExport: (workspaceId: WorkspaceId) => boolean;
  cancelWorkspace: (workspaceId: WorkspaceId) => Promise<void>;
  cancelBatchSpeakerDiarization: () => Promise<void>;
  clearError: (workspaceId: WorkspaceId) => void;
  clearTerminal: (workspaceId: WorkspaceId) => void;
  selectInputFolder: (workspaceId: WorkspaceId) => Promise<void>;
  selectOutputFolder: (workspaceId: WorkspaceId) => Promise<void>;
  loadFileBrowserWindow: (workspaceId: WorkspaceId, purpose: "input" | "output", direction: "reveal" | "sync" | "up" | "down", metrics?: ScrollWindowMetrics, targetPath?: string) => Promise<void>;
  selectFileNode: (workspaceId: WorkspaceId, node: FileTreeNode) => void;
  selectRow: (workspaceId: WorkspaceId, row: DataTableRow, options?: { additive?: boolean }) => void;
  selectRows: (workspaceId: WorkspaceId, rowIds: string[]) => void;
  selectAdjacentRow: (workspaceId: WorkspaceId, direction: -1 | 1) => void;
  toggleRowExportCheck: (workspaceId: WorkspaceId, row: DataTableRow) => void;
  setAllRowExportChecks: (workspaceId: WorkspaceId, checked: boolean, rows: DataTableRow[]) => void;
  setRowsExportChecks: (workspaceId: WorkspaceId, checked: boolean, rowIds: string[]) => void;
  setBatchFilter: (patch: Partial<BatchFilterState>) => void;
  setTableSearch: (workspaceId: WorkspaceId, patch: { query?: string; columns?: string[] }) => void;
  editBatchCell: (rowId: string, key: "editedTranscript" | "speaker" | "qcStatus", value: string) => void;
  toggleBatchSpeaker: (speaker: string) => void;
  runBatchSpeakerDiarization: () => Promise<void>;
  mergeEnabledBatchSpeakers: () => void;
  splitOrUnmergeSliceSegment: (workspaceId: WorkspaceId, sourceRow: DataTableRow, componentIds: string[]) => void;
  mergeSliceSegments: (workspaceId: WorkspaceId) => void;
  addSliceSegment: (workspaceId: WorkspaceId, sourceRow: DataTableRow | undefined, startSec?: number, endSec?: number) => void;
  deleteSliceSegment: (workspaceId: WorkspaceId, sourceRow: DataTableRow) => void;
  updateSliceSegmentBounds: (workspaceId: WorkspaceId, sourceRow: DataTableRow, startSec: number, endSec: number) => void;
  run: (workspaceId: WorkspaceId) => Promise<void>;
  retry: (workspaceId: WorkspaceId) => Promise<void>;
  exportWorkspace: (workspaceId: WorkspaceId) => Promise<void>;
  getRuntimeEnvironmentStatus: (workspaceId: WorkspaceId) => WorkspaceRuntimeEnvironmentStatus | undefined;
  isRuntimeEnvironmentInstalling: (workspaceId: WorkspaceId) => boolean;
  checkRuntimeEnvironment: (workspaceId: WorkspaceId) => Promise<WorkspaceRuntimeEnvironmentStatus | undefined>;
  installRuntimeEnvironment: (workspaceId: WorkspaceId) => Promise<void>;
  getVoiceModelRuntimeStatus: (workspaceId: WorkspaceId) => VoiceModelRuntimeStatus | undefined;
  isVoiceModelRuntimeInstalling: (workspaceId: WorkspaceId) => boolean;
  checkVoiceModelRuntime: (workspaceId: WorkspaceId) => Promise<VoiceModelRuntimeStatus | undefined>;
  installVoiceModelRuntime: (workspaceId: WorkspaceId) => Promise<void>;
  syncTrainingModelCheckpoints: (model: TrainingModelSummary | undefined, settingsOverride?: WorkspaceSettings["training"], options?: { activate?: boolean }) => void;
};

type WorkspaceRunSession = {
  sheetId: string;
  baseTable?: DataTable;
  sourcePathByFileName?: Map<string, string>;
};

type WorkspaceRowsClipboard = {
  workspaceId: WorkspaceId;
  rows: DataTableRow[];
};

const GPT_SOVITS_CHECKPOINT_POLL_MS = 2500;
const TERMINAL_TEXT_LIMIT = 60000;
const VOICE_MODEL_RUNTIME_INSTALLING_STATUS = "모델 설치 중";

const WorkspaceRuntimeContext = createContext<WorkspaceRuntime | null>(null);

export function WorkspaceRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useWorkspaceRuntimeValue();
  return createElement(WorkspaceRuntimeContext.Provider, { value: runtime }, children);
}

export function useWorkspaceRuntime(): WorkspaceRuntime {
  const runtime = useContext(WorkspaceRuntimeContext);
  if (!runtime) {
    throw new Error("useWorkspaceRuntime must be used inside WorkspaceRuntimeProvider.");
  }

  return runtime;
}

function useWorkspaceRuntimeValue(): WorkspaceRuntime {
  const persistence = useAppPersistence();
  const initialRuntimeSnapshotRef = useRef<PersistedRuntimeSnapshot>(persistence.initialState.runtime);
  const [settings, setSettings] = useState<WorkspaceSettings>(() => initialRuntimeSnapshotRef.current.settings);
  const [tagScoreRules, setTagScoreRules] = useState<TagScoreRule[]>(() => initialRuntimeSnapshotRef.current.tagScoreRules);
  const [overviewFilter, setOverviewFilter] = useState<OverviewFilterState>(() => initialRuntimeSnapshotRef.current.overviewFilter);
  const [rowsClipboard, setRowsClipboard] = useState<WorkspaceRowsClipboard | undefined>(() => initialRuntimeSnapshotRef.current.rowsClipboard);
  const [states, dispatch] = useReducer(workspaceRuntimeReducer, undefined, () => initialRuntimeSnapshotRef.current.states);
  const [runtimeEnvironmentStatuses, setRuntimeEnvironmentStatuses] = useState<Partial<Record<WorkspaceId, WorkspaceRuntimeEnvironmentStatus>>>({});
  const [runtimeEnvironmentInstalling, setRuntimeEnvironmentInstalling] = useState<Partial<Record<WorkspaceId, boolean>>>({});
  const [voiceModelRuntimeStatuses, setVoiceModelRuntimeStatuses] = useState<Record<string, VoiceModelRuntimeStatus>>({});
  const [voiceModelRuntimeInstalling, setVoiceModelRuntimeInstalling] = useState<Partial<Record<WorkspaceId, boolean>>>({});
  const statesRef = useRef(states);
  const runtimeEnvironmentStatusesRef = useRef(runtimeEnvironmentStatuses);
  const runtimeEnvironmentInstallingRef = useRef(runtimeEnvironmentInstalling);
  const voiceModelRuntimeStatusesRef = useRef(voiceModelRuntimeStatuses);
  const voiceModelRuntimeInstallingRef = useRef(voiceModelRuntimeInstalling);
  const settingsRef = useRef(settings);
  const cancelVersionRef = useRef<Partial<Record<WorkspaceId, number>>>({});
  const activeRunSessionRef = useRef<Partial<Record<WorkspaceId, WorkspaceRunSession>>>({});
  const inputLoadTokenRef = useRef<Partial<Record<WorkspaceId, number>>>({});
  const inputTreeRevealTokenRef = useRef<Partial<Record<WorkspaceId, number>>>({});
  const inputTreeRevealTimerRef = useRef<Partial<Record<WorkspaceId, ReturnType<typeof setTimeout>>>>({});
  const fileBrowserWindowTokenRef = useRef<Record<string, number>>({});
  const activeProjectRoot = persistence.activeProject.rootPath;

  settingsRef.current = settings;

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  useEffect(() => {
    runtimeEnvironmentStatusesRef.current = runtimeEnvironmentStatuses;
  }, [runtimeEnvironmentStatuses]);

  useEffect(() => {
    runtimeEnvironmentInstallingRef.current = runtimeEnvironmentInstalling;
  }, [runtimeEnvironmentInstalling]);

  useEffect(() => {
    voiceModelRuntimeStatusesRef.current = voiceModelRuntimeStatuses;
  }, [voiceModelRuntimeStatuses]);

  useEffect(() => {
    voiceModelRuntimeInstallingRef.current = voiceModelRuntimeInstalling;
  }, [voiceModelRuntimeInstalling]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    persistence.recordRuntimeSnapshot({
      settings,
      tagScoreRules,
      overviewFilter,
      rowsClipboard,
      states,
    });
  }, [overviewFilter, persistence, rowsClipboard, settings, states, tagScoreRules]);

  const taggingDisplayTable = useMemo(
    () => applyTagScoreRulesToTable(states.tagging.table, tagScoreRules, settings.slicer),
    [settings.slicer, states.tagging.table, tagScoreRules],
  );

  const createWorkspacePaths = useCallback((inputPath: string, outputPath?: string) => ({
    inputPath,
    outputPath: outputPath?.trim() || undefined,
    projectRoot: activeProjectRoot,
  }), [activeProjectRoot]);

  const updateState = useCallback((workspaceId: WorkspaceId, patch: Partial<WorkspaceRuntimeState>) => {
    statesRef.current = {
      ...statesRef.current,
      [workspaceId]: {
        ...statesRef.current[workspaceId],
        ...patch,
      },
    };
    dispatch({ type: "workspace.patch", workspaceId, patch });
  }, []);

  const replaceState = useCallback((workspaceId: WorkspaceId, state: WorkspaceRuntimeState) => {
    statesRef.current = {
      ...statesRef.current,
      [workspaceId]: state,
    };
    dispatch({ type: "workspace.replace", workspaceId, state });
  }, []);

  const updateSheetState = useCallback((workspaceId: WorkspaceId, patch: Parameters<typeof updateActiveSheet>[1]) => {
    const currentState = statesRef.current[workspaceId];
    if (!activeSheet(currentState)) {
      updateState(workspaceId, patch);
      return;
    }

    const nextState = updateActiveSheet(currentState, patch);
    replaceState(workspaceId, nextState);
  }, [replaceState, updateState]);

  const updateSheetByIdState = useCallback(
    (workspaceId: WorkspaceId, sheetId: string, patch: Parameters<typeof updateActiveSheet>[1], activate = false) => {
      const currentState = statesRef.current[workspaceId];
      const sheet = currentState.sheets.find((item) => item.id === sheetId);
      if (!sheet) {
        updateState(workspaceId, patch);
        return;
      }

      const nextSheet = { ...sheet, ...patch };
      const sheets = currentState.sheets.map((item) => (item.id === sheetId ? nextSheet : item));
      const nextActiveSheetId = activate ? sheetId : currentState.activeSheetId;
      const nextState = { ...currentState, sheets, activeSheetId: nextActiveSheetId };
      replaceState(workspaceId, stateWithActiveSheet(nextState, activeSheet(nextState)));
    },
    [replaceState, updateState],
  );

  const cancelInputTreeReveal = useCallback((workspaceId: WorkspaceId) => {
    inputTreeRevealTokenRef.current[workspaceId] = (inputTreeRevealTokenRef.current[workspaceId] ?? 0) + 1;
    const timer = inputTreeRevealTimerRef.current[workspaceId];
    if (timer) {
      clearTimeout(timer);
      delete inputTreeRevealTimerRef.current[workspaceId];
    }
  }, []);

  useEffect(() => () => {
    for (const timer of Object.values(inputTreeRevealTimerRef.current)) {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }, []);

  const selectSheet = useCallback(
    (workspaceId: WorkspaceId, sheetId: string) => {
      const state = statesRef.current[workspaceId];
      const sheet = state.sheets.find((item) => item.id === sheetId);
      if (!sheet) {
        return;
      }

      replaceState(workspaceId, stateWithActiveSheet({ ...state, activeSheetId: sheet.id }, sheet));
      if (workspaceId === "training") {
        const identity = resolveTrainingIdentityFromSheet(sheet);
        if (identity) {
          setSettings((current) => ({
            ...current,
            training: applyTrainingIdentityToSettings(current.training, identity),
          }));
        }
      }
    },
    [replaceState, setSettings],
  );

  const createSheet = useCallback(
    (workspaceId: WorkspaceId) => {
      const state = statesRef.current[workspaceId];
      const table = workspaceId === "training"
        ? createTrainingTableForModel(settingsRef.current.training.selectedModel)
        : createEmptyWorkspaceTable(workspaceId);
      const sheet = createWorkspaceResultSheet(workspaceId, nextSheetLabel(state.sheets), {
        inputPath: state.inputPath,
        outputPath: state.outputPath,
        inputTree: state.inputTree,
        table,
        details: table.columns.map((column) => ({ label: column.label, value: "-" })),
        selectedFilePath: findFirstAudioPath(state.inputTree),
        selectedAudioPath: findFirstAudioPath(state.inputTree),
      });
      replaceState(workspaceId, stateWithActiveSheet({ ...state, sheets: [...state.sheets, sheet], activeSheetId: sheet.id }, sheet));
    },
    [replaceState],
  );

  const deleteSheet = useCallback(
    (workspaceId: WorkspaceId) => {
      const state = statesRef.current[workspaceId];
      const sheet = activeSheet(state);
      if (!sheet || state.sheets.length <= 1 || state.isRunning || state.isExporting || state.isBatchSpeakerRunning) {
        return;
      }

      const sheetIndex = state.sheets.findIndex((item) => item.id === sheet.id);
      const sheets = state.sheets.filter((item) => item.id !== sheet.id);
      const nextSheet = sheets[Math.max(0, Math.min(sheetIndex, sheets.length - 1))];
      if (!nextSheet) {
        return;
      }

      replaceState(workspaceId, stateWithActiveSheet({ ...state, sheets, activeSheetId: nextSheet.id }, nextSheet));
      if (workspaceId === "training") {
        const identity = resolveTrainingIdentityFromSheet(nextSheet);
        if (identity) {
          setSettings((current) => ({
            ...current,
            training: applyTrainingIdentityToSettings(current.training, identity),
          }));
        }
      }
    },
    [replaceState, setSettings],
  );

  const copyRows = useCallback((workspaceId: WorkspaceId, rowIds: string[]) => {
    const state = statesRef.current[workspaceId];
    const rowIdSet = new Set(rowIds);
    const rows = state.table.rows.filter((row) => rowIdSet.has(row.id)).map(cloneRow);
    if (rows.length > 0) {
      setRowsClipboard({ workspaceId, rows });
    }
  }, []);

  const pasteRows = useCallback(
    (workspaceId: WorkspaceId, duplicateMode: "overwrite" | "skip") => {
      const state = statesRef.current[workspaceId];
      const sheet = activeSheet(state);
      if (!sheet || !rowsClipboard?.rows.length || rowsClipboard.workspaceId !== workspaceId) {
        return;
      }

      const nextTable = pasteRowsIntoTable(workspaceId, sheet.table, rowsClipboard.rows, duplicateMode);
      const selection = buildTableSelectionPatch(workspaceId, nextTable, stateWithActiveSheet(state, sheet), state.selectedAudioPath || findFirstAudioPath(state.inputTree));
      updateSheetByIdState(workspaceId, sheet.id, {
        table: nextTable,
        details: selection.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
        rowExportChecks: {
          ...sheet.rowExportChecks,
          ...Object.fromEntries(nextTable.rows.map((row) => [row.id, sheet.rowExportChecks[row.id] !== false])),
        },
      });
      updateState(workspaceId, { statusText: "Rows pasted" });
    },
    [rowsClipboard, updateSheetByIdState, updateState],
  );

  const applyRunProgress = useCallback(
    (progress: WorkspaceRunProgressEvent) => {
      const state = statesRef.current[progress.workspaceId];
      const runSession = activeRunSessionRef.current[progress.workspaceId];
      const acceptsProgress = state.isRunning || (progress.workspaceId === "batch" && state.isBatchSpeakerRunning);
      const acceptsLoadTerminal = state.statusText === "Loading" || state.statusText === "Converting audio";
      const acceptsRuntimeInstallTerminal = state.statusText === "런타임 설치 중";
      const acceptsVoiceModelInstallTerminal = state.statusText === VOICE_MODEL_RUNTIME_INSTALLING_STATUS;
      if (!acceptsProgress && (acceptsRuntimeInstallTerminal || acceptsVoiceModelInstallTerminal) && progress.terminal) {
        updateState(progress.workspaceId, {
          progressPercent: progress.progress.percent,
          progress: progress.progress,
          terminal: createTerminalFromUpdate(progress.terminal, "running"),
        });
        return;
      }

      if (!acceptsProgress && acceptsLoadTerminal && (progress.terminal || progress.inputTree)) {
        if (progress.inputTree) {
          updateSheetState(progress.workspaceId, {
            inputTree: progress.inputTree,
            browserPreferredSection: "input",
          });
        }

        updateState(progress.workspaceId, {
          statusText: progress.progress.total > 0 || progress.terminal ? "Converting audio" : state.statusText,
          progressPercent: progress.progress.percent,
          progress: progress.progress,
          ...(progress.terminal ? { terminal: createTerminalFromUpdate(progress.terminal, "running") } : {}),
          ...(progress.terminal ? { terminalOpenRequestId: state.terminal.status === "running" ? state.terminalOpenRequestId : state.terminalOpenRequestId + 1 } : {}),
        });
        return;
      }

      if (!acceptsProgress) {
        return;
      }

      if (progress.table.rows.length === 0 && !runSession?.baseTable?.rows.length) {
        updateState(progress.workspaceId, {
          progressPercent: progress.progress.percent,
          progress: progress.progress,
          statusText: progress.workspaceId === "batch" && state.isBatchSpeakerRunning ? "Speaker diarizing" : "Running",
          browserPreferredSection: "input",
          ...(progress.inputTree ? { inputTree: progress.inputTree } : {}),
          ...(progress.terminal ? { terminal: createTerminalFromUpdate(progress.terminal, "running") } : {}),
        });
        return;
      }

      const table = runSession?.baseTable
        ? progress.workspaceId === "training"
          ? mergeTrainingRows(runSession.baseTable, progress.table.rows)
          : mergeRetryTables(progress.workspaceId, runSession.baseTable, progress.table, runSession.sourcePathByFileName)
        : normalizeRetryTable(progress.workspaceId, progress.table, runSession?.sourcePathByFileName);
      const targetSheetId = runSession?.sheetId;
      const targetSheet = targetSheetId ? state.sheets.find((sheet) => sheet.id === targetSheetId) : activeSheet(state);
      const selectionState = targetSheet ? stateWithActiveSheet(state, targetSheet) : state;
      const selection = buildTableSelectionPatch(progress.workspaceId, table, selectionState, selectionState.selectedAudioPath || findFirstAudioPath(selectionState.inputTree));
      const patch = {
        table,
        details: selection.details.length > 0 ? selection.details : progress.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
      };
      if (targetSheetId) {
        updateSheetByIdState(progress.workspaceId, targetSheetId, patch);
      } else {
        updateSheetState(progress.workspaceId, patch);
      }
      updateState(progress.workspaceId, {
        progressPercent: progress.progress.percent,
        progress: progress.progress,
        statusText: progress.workspaceId === "batch" && state.isBatchSpeakerRunning ? "Speaker diarizing" : "Running",
        browserPreferredSection: "input",
        ...(progress.inputTree ? { inputTree: progress.inputTree } : {}),
        ...(progress.terminal ? { terminal: createTerminalFromUpdate(progress.terminal, "running") } : {}),
      });
    },
    [updateSheetByIdState, updateSheetState, updateState],
  );

  const applyExportProgress = useCallback(
    (progress: WorkspaceExportProgressEvent) => {
      const state = statesRef.current[progress.workspaceId];
      if (!state.isExporting) {
        return;
      }

      updateSheetState(progress.workspaceId, {
        outputPath: progress.outputPath ?? state.outputPath,
        outputTree: progress.outputTree ?? state.outputTree,
        details: progress.details.length > 0 ? progress.details : state.details,
        browserPreferredSection: "output",
      });
      updateState(progress.workspaceId, {
        progressPercent: progress.progress.percent,
        statusText: "Exporting",
        browserPreferredSection: "output",
      });
    },
    [updateSheetState, updateState],
  );

  useEffect(() => studioBackend.onWorkspaceRunProgress(applyRunProgress), [applyRunProgress]);

  useEffect(() => studioBackend.onWorkspaceExportProgress(applyExportProgress), [applyExportProgress]);

  const loadWorkspace = useCallback(
    async (workspaceId: WorkspaceId, inputPath: string, outputPath = "") => {
      cancelInputTreeReveal(workspaceId);
      const loadToken = (inputLoadTokenRef.current[workspaceId] ?? 0) + 1;
      inputLoadTokenRef.current[workspaceId] = loadToken;
      const state = statesRef.current[workspaceId];
      const currentSheet = activeSheet(state);
      let reusableSheetId = currentSheet && !resultSheetHasRows(currentSheet) ? currentSheet.id : undefined;

      if (reusableSheetId) {
        updateState(workspaceId, {
          statusText: "Loading",
          error: undefined,
        });
      } else {
        const loadingTable = workspaceId === "training"
          ? createTrainingTableForModel(settingsRef.current.training.selectedModel)
          : createEmptyWorkspaceTable(workspaceId);
        const loadingSheet = createWorkspaceResultSheet(workspaceId, nextSheetLabel(state.sheets), {
          inputPath,
          outputPath,
          table: loadingTable,
          details: loadingTable.columns.map((column) => ({ label: column.label, value: "-" })),
          browserPreferredSection: "input",
        });
        reusableSheetId = loadingSheet.id;
        replaceState(workspaceId, stateWithActiveSheet({
          ...state,
          statusText: "Loading",
          progressPercent: 0,
          progress: undefined,
          error: undefined,
          sheets: [...state.sheets, loadingSheet],
          activeSheetId: loadingSheet.id,
        }, loadingSheet));
      }

      try {
        const loaded = await studioBackend.loadWorkspace({
          workspaceId,
          paths: createWorkspacePaths(inputPath, outputPath),
          settings: settingsRef.current,
        });

        if (inputLoadTokenRef.current[workspaceId] !== loadToken) {
          return;
        }

        const table = workspaceId === "batch"
          ? loaded.table
          : workspaceId === "training"
            ? createTrainingTableForModel(settingsRef.current.training.selectedModel)
            : createEmptyWorkspaceTable(workspaceId);
        const firstRow = table.rows[0];
        const fallbackAudioPath = findFirstAudioPath(loaded.inputTree);
        const audioSelection = resolveAudioSelection(workspaceId, firstRow, fallbackAudioPath);
        const details = workspaceId === "training"
          ? loaded.details
          : table.rows.length > 0
          ? loaded.details
          : table.columns.map((column) => ({ label: column.label, value: "-" }));
        const latestState = statesRef.current[workspaceId];
        const browserSectionRequestId = latestState.browserSectionRequestId + 1;
        const terminalFromLoad = createTerminalFromLogPath(loaded.logPath);
        const sheetPatch = {
          inputPath: loaded.inputPath ?? inputPath,
          outputPath: loaded.outputPath ?? outputPath,
          inputTree: loaded.inputTree,
          outputTree: undefined,
          table,
          details,
          selectedRowId: firstRow?.id,
          selectedRowIds: firstRow ? [firstRow.id] : [],
          selectedFilePath: audioSelection.selectedFilePath ?? fallbackAudioPath,
          selectedAudioPath: audioSelection.selectedAudioPath ?? fallbackAudioPath,
          selectedResultAudioPath: audioSelection.selectedResultAudioPath,
          browserPreferredSection: "input" as const,
          browserSectionRequestId,
          rowExportChecks: Object.fromEntries(table.rows.map((row) => [row.id, true])),
          batchSpeakerChecks: workspaceId === "batch"
            ? Object.fromEntries(collectBatchSpeakers(table.rows).map((speaker) => [speaker, true]))
            : latestState.batchSpeakerChecks,
          lastRun: undefined,
        };

        const reusableSheet = reusableSheetId ? latestState.sheets.find((sheet) => sheet.id === reusableSheetId) : undefined;
        if (reusableSheet) {
          updateSheetByIdState(workspaceId, reusableSheet.id, sheetPatch, true);
          updateState(workspaceId, {
            statusText: "Loaded",
            progressPercent: 0,
            progress: undefined,
            error: undefined,
            ...(terminalFromLoad ? { terminal: terminalFromLoad } : {}),
            ...(terminalFromLoad && latestState.terminal.status !== "running" ? { terminalOpenRequestId: latestState.terminalOpenRequestId + 1 } : {}),
          });
        } else {
          const nextSheet = createWorkspaceResultSheet(workspaceId, nextSheetLabel(latestState.sheets), sheetPatch);
          replaceState(workspaceId, stateWithActiveSheet({
            ...latestState,
            isRunning: false,
            isExporting: false,
            statusText: "Loaded",
            progressPercent: 0,
            progress: undefined,
            error: undefined,
            ...(terminalFromLoad ? { terminal: terminalFromLoad } : {}),
            ...(terminalFromLoad && latestState.terminal.status !== "running" ? { terminalOpenRequestId: latestState.terminalOpenRequestId + 1 } : {}),
            sheets: [...latestState.sheets, nextSheet],
            activeSheetId: nextSheet.id,
          }, nextSheet));
        }

        if (workspaceId === "batch") {
          setSettings((current) => ({
            ...current,
            batch: {
              ...current.batch,
              jobs: buildBatchJobs(table),
            },
          }));
        }
      } catch (error) {
        if (inputLoadTokenRef.current[workspaceId] !== loadToken) {
          return;
        }
        updateState(workspaceId, {
          statusText: "Load failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [cancelInputTreeReveal, createWorkspacePaths, replaceState, setSettings, updateSheetByIdState, updateState],
  );

  const selectInputFolder = useCallback(
    async (workspaceId: WorkspaceId) => {
      if (workspaceId === "training") {
        const selectedModel = settingsRef.current.training.selectedModel;
        const selected = await studioBackend.selectFile({
          title: selectedModel === "gpt-sovits" ? "GPT-SoVITS 리스트 선택" : "OmniVoice JSON 선택",
          filters: selectedModel === "gpt-sovits"
            ? [{ name: "GPT-SoVITS 리스트", extensions: ["list"] }]
            : [{ name: "OmniVoice JSON", extensions: ["jsonl", "json"] }],
        });
        if (selected.canceled || !selected.path) {
          return;
        }

        await loadWorkspace(workspaceId, selected.path, statesRef.current[workspaceId].outputPath);
        return;
      }

      const selected = await studioBackend.selectFolder();
      if (selected.canceled || !selected.path) {
        return;
      }

      await loadWorkspace(workspaceId, selected.path, statesRef.current[workspaceId].outputPath);
    },
    [loadWorkspace],
  );

  const clearError = useCallback(
    (workspaceId: WorkspaceId) => {
      updateState(workspaceId, { error: undefined });
    },
    [updateState],
  );

  const clearTerminal = useCallback(
    (workspaceId: WorkspaceId) => {
      const current = statesRef.current[workspaceId].terminal;
      updateState(workspaceId, {
        terminal: {
          ...current,
          text: "",
          status: "idle",
          updatedAt: new Date().toISOString(),
        },
      });
    },
    [updateState],
  );

  const checkRuntimeEnvironment = useCallback(
    async (workspaceId: WorkspaceId) => {
      try {
        const status = await studioBackend.checkWorkspaceRuntime({ workspaceId });
        setRuntimeEnvironmentStatuses((current) => ({ ...current, [workspaceId]: status }));
        if (!status.ok && !runtimeEnvironmentInstallingRef.current[workspaceId]) {
          const state = statesRef.current[workspaceId];
          if (!state.isRunning && !state.isExporting && !state.isBatchSpeakerRunning) {
            updateState(workspaceId, { statusText: "런타임 없음" });
          }
        }
        return status;
      } catch {
        return runtimeEnvironmentStatusesRef.current[workspaceId];
      }
    },
    [updateState],
  );

  const installRuntimeEnvironment = useCallback(
    async (workspaceId: WorkspaceId) => {
      if (runtimeEnvironmentInstallingRef.current[workspaceId]) {
        return;
      }

      const status = await checkRuntimeEnvironment(workspaceId);
      if (status?.ok) {
        return;
      }

      setRuntimeEnvironmentInstalling((current) => ({ ...current, [workspaceId]: true }));
      const state = statesRef.current[workspaceId];
      updateState(workspaceId, {
        statusText: "런타임 설치 중",
        progressPercent: 0,
        progress: undefined,
        error: undefined,
        terminal: createTerminalStartState(`${workspaceId} 런타임 설치 시작`),
        terminalOpenRequestId: state.terminalOpenRequestId + 1,
      });

      try {
        const result = await studioBackend.installWorkspaceRuntime({ workspaceId });
        setRuntimeEnvironmentStatuses((current) => ({ ...current, [workspaceId]: result.status }));
        updateState(workspaceId, {
          statusText: result.ok ? "런타임 설치 완료" : "런타임 설치 실패",
          error: result.ok ? undefined : result.error ?? "런타임 설치에 실패했습니다.",
          progressPercent: result.ok ? 100 : statesRef.current[workspaceId].progressPercent,
          terminal: createTerminalFromEnvironmentInstallResult(result),
        });
      } catch (error) {
        updateState(workspaceId, {
          statusText: "런타임 설치 실패",
          error: error instanceof Error ? error.message : String(error),
          terminal: {
            ...statesRef.current[workspaceId].terminal,
            text: error instanceof Error ? error.message : String(error),
            status: "failed",
            updatedAt: new Date().toISOString(),
          },
        });
      } finally {
        setRuntimeEnvironmentInstalling((current) => ({ ...current, [workspaceId]: false }));
        void checkRuntimeEnvironment(workspaceId);
      }
    },
    [checkRuntimeEnvironment, updateState],
  );

  const checkVoiceModelRuntime = useCallback(
    async (workspaceId: WorkspaceId) => {
      if (!isVoiceModelWorkspace(workspaceId)) {
        return undefined;
      }

      const requestSettings = settingsRef.current;
      const requestKey = voiceModelRuntimeSettingsKey(workspaceId, requestSettings);
      try {
        const status = await studioBackend.checkVoiceModelRuntime({ workspaceId, settings: requestSettings });
        const currentKey = voiceModelRuntimeSettingsKey(workspaceId, settingsRef.current);
        if (status.settingsKey !== requestKey || status.settingsKey !== currentKey) {
          return undefined;
        }

        setVoiceModelRuntimeStatuses((current) => ({ ...current, [status.settingsKey]: status }));
        if (!status.ok && !voiceModelRuntimeInstallingRef.current[workspaceId]) {
          const state = statesRef.current[workspaceId];
          if (!state.isRunning && !state.isExporting && !state.isBatchSpeakerRunning) {
            updateState(workspaceId, { statusText: "모델 없음" });
          }
        }
        return status;
      } catch {
        return requestKey ? voiceModelRuntimeStatusesRef.current[requestKey] : undefined;
      }
    },
    [updateState],
  );

  const installVoiceModelRuntime = useCallback(
    async (workspaceId: WorkspaceId) => {
      if (!isVoiceModelWorkspace(workspaceId) || voiceModelRuntimeInstallingRef.current[workspaceId]) {
        return;
      }

      const runtimeStatus = await checkRuntimeEnvironment(workspaceId);
      if (runtimeStatus && !runtimeStatus.ok) {
        return;
      }

      const status = await checkVoiceModelRuntime(workspaceId);
      if (status?.ok) {
        return;
      }

      setVoiceModelRuntimeInstalling((current) => ({ ...current, [workspaceId]: true }));
      const state = statesRef.current[workspaceId];
      updateState(workspaceId, {
        statusText: VOICE_MODEL_RUNTIME_INSTALLING_STATUS,
        progressPercent: 0,
        progress: undefined,
        error: undefined,
        terminal: createTerminalStartState(`${workspaceId} 모델 설치 시작`),
        terminalOpenRequestId: state.terminalOpenRequestId + 1,
      });

      try {
        const installSettings = settingsRef.current;
        const installKey = voiceModelRuntimeSettingsKey(workspaceId, installSettings);
        const result = await studioBackend.installVoiceModelRuntime({ workspaceId, settings: installSettings });
        if (result.status.settingsKey === installKey && result.status.settingsKey === voiceModelRuntimeSettingsKey(workspaceId, settingsRef.current)) {
          setVoiceModelRuntimeStatuses((current) => ({ ...current, [result.status.settingsKey]: result.status }));
        }
        updateState(workspaceId, {
          statusText: result.ok ? "모델 준비 완료" : "모델 설치 실패",
          error: result.ok ? undefined : result.error ?? "모델 설치에 실패했습니다.",
          progressPercent: result.ok ? 100 : statesRef.current[workspaceId].progressPercent,
          terminal: createTerminalFromVoiceModelInstallResult(result),
        });
      } catch (error) {
        updateState(workspaceId, {
          statusText: "모델 설치 실패",
          error: error instanceof Error ? error.message : String(error),
          terminal: {
            ...statesRef.current[workspaceId].terminal,
            text: error instanceof Error ? error.message : String(error),
            status: "failed",
            updatedAt: new Date().toISOString(),
          },
        });
      } finally {
        setVoiceModelRuntimeInstalling((current) => ({ ...current, [workspaceId]: false }));
        void checkVoiceModelRuntime(workspaceId);
      }
    },
    [checkRuntimeEnvironment, checkVoiceModelRuntime, updateState],
  );

  const cancelWorkspace = useCallback(
    async (workspaceId: WorkspaceId) => {
      const state = statesRef.current[workspaceId];
      if (!state.isRunning && !state.isExporting && !state.isBatchSpeakerRunning) {
        return;
      }

      cancelVersionRef.current[workspaceId] = (cancelVersionRef.current[workspaceId] ?? 0) + 1;
      updateState(workspaceId, {
        statusText: "Stopping",
      });
      try {
        await studioBackend.cancelWorkspace({ workspaceId });
      } catch (error) {
        updateState(workspaceId, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [updateState],
  );

  const cancelBatchSpeakerDiarization = useCallback(async () => {
    const workspaceId: WorkspaceId = "batch";
    const state = statesRef.current.batch;
    if (!state.isBatchSpeakerRunning) {
      return;
    }

    updateState(workspaceId, {
      statusText: "Speaker stopping",
    });
    try {
      await studioBackend.cancelWorkspace({ workspaceId, operation: "batchSpeaker" });
    } catch (error) {
      updateState(workspaceId, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [updateState]);

  const selectOutputFolder = useCallback(
    async (workspaceId: WorkspaceId) => {
      const selected = await studioBackend.selectFolder();
      if (selected.canceled || !selected.path) {
        return;
      }

      updateSheetState(workspaceId, {
        outputPath: selected.path,
        outputTree: undefined,
        selectedResultAudioPath: undefined,
        browserPreferredSection: "output",
        browserSectionRequestId: statesRef.current[workspaceId].browserSectionRequestId + 1,
      });
      updateState(workspaceId, {
        outputPath: selected.path,
        browserPreferredSection: "output",
        browserSectionRequestId: statesRef.current[workspaceId].browserSectionRequestId + 1,
        error: undefined,
      });
    },
    [updateSheetState, updateState],
  );

  const loadFileBrowserWindow = useCallback(
    async (workspaceId: WorkspaceId, purpose: "input" | "output", direction: "reveal" | "sync" | "up" | "down", metrics?: ScrollWindowMetrics, targetPath?: string) => {
      const state = statesRef.current[workspaceId];
      const tree = purpose === "input" ? state.inputTree : state.outputTree;
      const windowState = tree?.window;
      if (!tree || !windowState || tree.rootPath.startsWith("wqcs://")) {
        return;
      }
      if (purpose === "input" && isAudioConversionStatusTree(tree) && (state.statusText === "Loading" || state.statusText === "Converting audio")) {
        return;
      }

      const nextWindow = resolveFileBrowserWindow(windowState, direction, metrics);
      if (!nextWindow) {
        return;
      }

      const tokenKey = `${workspaceId}:${purpose}`;
      const token = (fileBrowserWindowTokenRef.current[tokenKey] ?? 0) + 1;
      fileBrowserWindowTokenRef.current[tokenKey] = token;
      const nextTree = await studioBackend.scanPath(tree.rootPath, {
        workspaceId,
        purpose,
        offset: nextWindow.offset,
        limit: nextWindow.limit,
        targetPath: direction === "reveal" ? targetPath : undefined,
      });
      if (fileBrowserWindowTokenRef.current[tokenKey] !== token) {
        return;
      }

      const latestTree = purpose === "input" ? statesRef.current[workspaceId].inputTree : statesRef.current[workspaceId].outputTree;
      if (latestTree?.rootPath !== tree.rootPath) {
        return;
      }

      const patch = purpose === "input"
        ? { inputTree: nextTree, browserPreferredSection: purpose }
        : { outputTree: nextTree, browserPreferredSection: purpose };
      updateSheetState(workspaceId, patch);
    },
    [updateSheetState],
  );

  const getTable = useCallback(
    (workspaceId: WorkspaceId) => {
      const table = states[workspaceId].table;
      if (workspaceId === "overview") {
        return filterOverviewTable(table, overviewFilter);
      }

      if (workspaceId === "tagging") {
        return filterTableBySearch(
          taggingDisplayTable,
          states[workspaceId].tableSearchQuery,
          states[workspaceId].tableSearchColumns,
        );
      }

      if (workspaceId === "batch") {
        return filterBatchTable(table, states[workspaceId].batchFilter, states[workspaceId].batchSpeakerChecks);
      }

      if (workspaceId === "training") {
        return filterTableBySearch(
          withTrainingTableModel(table, settings.training.selectedModel),
          states[workspaceId].tableSearchQuery,
          states[workspaceId].tableSearchColumns,
        );
      }

      return filterTableBySearch(table, states[workspaceId].tableSearchQuery, states[workspaceId].tableSearchColumns);
    },
    [overviewFilter, settings.training.selectedModel, states, taggingDisplayTable],
  );

  const getMetrics = useCallback(
    (workspaceId: WorkspaceId) => buildMetrics(workspaceId, states[workspaceId], settings, workspaceId === "overview" ? getTable(workspaceId) : undefined),
    [getTable, settings, states],
  );

  const selectFileNode = useCallback(
    (workspaceId: WorkspaceId, node: FileTreeNode) => {
      const state = statesRef.current[workspaceId];
      const matchingRow = node.kind === "file" ? findRowForPath(state.table.rows, node.path) : undefined;
      const audioSelection = resolveAudioSelection(workspaceId, matchingRow, isAudioPath(node.path) ? node.path : undefined);

      updateSheetState(workspaceId, {
        selectedFilePath: audioSelection.selectedFilePath ?? node.path,
        selectedRowId: matchingRow?.id,
        selectedRowIds: matchingRow ? [matchingRow.id] : [],
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        tableRevealRequestId: matchingRow ? state.tableRevealRequestId + 1 : state.tableRevealRequestId,
        details: matchingRow ? state.table.columns.map((column) => ({ label: column.label, value: matchingRow.cells[column.key] || "" })) : state.details,
      });
    },
    [updateSheetState],
  );

  const selectRow = useCallback(
    (workspaceId: WorkspaceId, row: DataTableRow, options: { additive?: boolean } = {}) => {
      const state = statesRef.current[workspaceId];
      const audioSelection = resolveAudioSelection(workspaceId, row, state.selectedAudioPath);
      const selectedRowIds = options.additive ? toggleSelectedRowId(state.selectedRowIds, row.id) : [row.id];
      updateSheetState(workspaceId, {
        selectedRowId: row.id,
        selectedRowIds,
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        browserRevealRequestId: state.browserRevealRequestId + 1,
        details: state.table.columns.map((column) => ({ label: column.label, value: row.cells[column.key] || "" })),
      });
    },
    [updateSheetState],
  );

  const selectRows = useCallback(
    (workspaceId: WorkspaceId, rowIds: string[]) => {
      const state = statesRef.current[workspaceId];
      const rowIdSet = new Set(rowIds);
      const selectedRows = state.table.rows.filter((row) => rowIdSet.has(row.id));
      const selectedRow = selectedRows[0];
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);
      updateSheetState(workspaceId, {
        selectedRowId: selectedRow?.id,
        selectedRowIds: selectedRows.map((row) => row.id),
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        browserRevealRequestId: selectedRow ? state.browserRevealRequestId + 1 : state.browserRevealRequestId,
        details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
      });
    },
    [updateSheetState],
  );

  const selectAdjacentRow = useCallback(
    (workspaceId: WorkspaceId, direction: -1 | 1) => {
      const state = statesRef.current[workspaceId];
      if (state.table.rows.length === 0) {
        return;
      }

      const currentIndex = Math.max(0, state.table.rows.findIndex((row) => row.id === state.selectedRowId));
      const nextIndex = Math.min(state.table.rows.length - 1, Math.max(0, currentIndex + direction));
      const nextRow = state.table.rows[nextIndex];
      const audioSelection = resolveAudioSelection(workspaceId, nextRow, state.selectedAudioPath);
      updateSheetState(workspaceId, {
        selectedRowId: nextRow.id,
        selectedRowIds: [nextRow.id],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        browserRevealRequestId: state.browserRevealRequestId + 1,
        details: state.table.columns.map((column) => ({ label: column.label, value: nextRow.cells[column.key] || "" })),
      });
    },
    [updateSheetState],
  );

  const toggleRowExportCheck = useCallback(
    (workspaceId: WorkspaceId, row: DataTableRow) => {
      const state = statesRef.current[workspaceId];
      updateSheetState(workspaceId, {
        rowExportChecks: {
          ...state.rowExportChecks,
          [row.id]: state.rowExportChecks[row.id] === false,
        },
      });
    },
    [updateSheetState],
  );

  const setAllRowExportChecks = useCallback(
    (workspaceId: WorkspaceId, checked: boolean, rows: DataTableRow[]) => {
      const state = statesRef.current[workspaceId];
      updateSheetState(workspaceId, {
        rowExportChecks: {
          ...state.rowExportChecks,
          ...Object.fromEntries(rows.map((row) => [row.id, checked])),
        },
      });
    },
    [updateSheetState],
  );

  const setRowsExportChecks = useCallback(
    (workspaceId: WorkspaceId, checked: boolean, rowIds: string[]) => {
      const state = statesRef.current[workspaceId];
      updateSheetState(workspaceId, {
        rowExportChecks: {
          ...state.rowExportChecks,
          ...Object.fromEntries(rowIds.map((rowId) => [rowId, checked])),
        },
      });
    },
    [updateSheetState],
  );

  const setBatchFilter = useCallback(
    (patch: Partial<BatchFilterState>) => {
      const state = statesRef.current.batch;
      updateState("batch", {
        batchFilter: {
          ...state.batchFilter,
          ...patch,
        },
      });
    },
    [updateState],
  );

  const setTableSearch = useCallback(
    (workspaceId: WorkspaceId, patch: { query?: string; columns?: string[] }) => {
      if (workspaceId === "overview") {
        setOverviewFilter((current) => ({
          ...current,
          textQuery: patch.query ?? current.textQuery,
          textColumns: patch.columns ?? current.textColumns,
        }));
        return;
      }

      if (workspaceId === "batch") {
        updateState("batch", {
          batchFilter: {
            ...statesRef.current.batch.batchFilter,
            query: patch.query ?? statesRef.current.batch.batchFilter.query,
            queryColumns: patch.columns ?? statesRef.current.batch.batchFilter.queryColumns,
          },
        });
        return;
      }

      updateSheetState(workspaceId, {
        tableSearchQuery: patch.query ?? statesRef.current[workspaceId].tableSearchQuery,
        tableSearchColumns: patch.columns ?? statesRef.current[workspaceId].tableSearchColumns,
      });
    },
    [setOverviewFilter, updateSheetState, updateState],
  );

  const toggleBatchSpeaker = useCallback(
    (speaker: string) => {
      const state = statesRef.current.batch;
      updateSheetState("batch", {
        batchSpeakerChecks: {
          ...state.batchSpeakerChecks,
          [speaker]: state.batchSpeakerChecks[speaker] === false,
        },
      });
    },
    [updateSheetState],
  );

  const editBatchCell = useCallback(
    (rowId: string, key: "editedTranscript" | "speaker" | "qcStatus", value: string) => {
      const state = statesRef.current.batch;
      const normalizedValue = key === "qcStatus" ? normalizeBatchQcStatus(value) : value.trim();
      const nextRows = state.table.rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        const raw = { ...(row.raw ?? {}) };
        const cells = { ...row.cells };
        cells[key] = normalizedValue;
        raw[key] = normalizedValue;

        if (key === "editedTranscript") {
          raw.edited_transcript = normalizedValue;
          const autoTranscript = (row.cells.autoTranscript || row.raw?.transcript || "").trim();
          if (normalizedValue && autoTranscript && normalizedValue !== autoTranscript && cells.qcStatus !== "검수됨") {
            cells.qcStatus = "수정됨";
            raw.qcStatus = "수정됨";
            raw.qc_status = "수정됨";
          }
        }

        if (key === "speaker") {
          raw.speaker = normalizedValue;
          raw.speaker_groups = normalizedValue;
        }

        if (key === "qcStatus") {
          raw.qcStatus = normalizedValue;
          raw.qc_status = normalizedValue;
        }

        return { ...row, raw, cells };
      });
      const nextTable = { ...state.table, rows: nextRows };
      const selectedRow = nextRows.find((row) => row.id === state.selectedRowId);
      const nextSpeakers = collectBatchSpeakers(nextRows);

      updateSheetState("batch", {
        table: nextTable,
        batchSpeakerChecks: {
          ...Object.fromEntries(nextSpeakers.map((speaker) => [speaker, state.batchSpeakerChecks[speaker] !== false])),
        },
        details: selectedRow ? nextTable.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
      });
      setSettings((current) => ({
        ...current,
        batch: {
          ...current.batch,
          jobs: buildBatchJobs(nextTable),
        },
      }));
    },
    [setSettings, updateSheetState],
  );

  const mergeEnabledBatchSpeakers = useCallback(() => {
    const state = statesRef.current.batch;
    const speakers = collectBatchSpeakers(state.table.rows).filter((speaker) => state.batchSpeakerChecks[speaker] !== false);
    if (speakers.length < 2) {
      return;
    }

    const primary = speakers[0];
    const merged = new Set(speakers);
    const nextRows = state.table.rows.map((row) => {
      const currentSpeaker = row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "";
      if (!merged.has(currentSpeaker)) {
        return row;
      }

      return {
        ...row,
        raw: {
          ...row.raw,
          speaker: primary,
          speaker_groups: primary,
        },
        cells: {
          ...row.cells,
          speaker: primary,
        },
      };
    });
    const selectedRow = nextRows.find((row) => row.id === state.selectedRowId);

    updateSheetState("batch", {
      table: {
        ...state.table,
        rows: nextRows,
      },
      batchSpeakerChecks: {
        ...Object.fromEntries(collectBatchSpeakers(nextRows).map((speaker) => [speaker, state.batchSpeakerChecks[speaker] !== false])),
        [primary]: true,
      },
      details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
    });
    updateState("batch", { statusText: "Speakers merged" });
    setSettings((current) => ({
      ...current,
      batch: {
        ...current.batch,
        jobs: buildBatchJobs({ ...state.table, rows: nextRows }),
      },
    }));
  }, [setSettings, updateSheetState, updateState]);

  const runBatchSpeakerDiarization = useCallback(async () => {
    const workspaceId: WorkspaceId = "batch";
    const state = statesRef.current.batch;
    const sheet = activeSheet(state);
    const settings = settingsRef.current;
    if (!sheet || !state.inputPath || state.table.rows.length === 0 || state.isRunning || state.isExporting || state.isBatchSpeakerRunning) {
      return;
    }

    updateState(workspaceId, {
      isBatchSpeakerRunning: true,
      statusText: "Speaker diarizing",
      progressPercent: 0,
      progress: undefined,
      error: undefined,
      terminal: createTerminalStartState("batch 화자 구분 시작"),
      terminalOpenRequestId: state.terminalOpenRequestId + 1,
      browserPreferredSection: "input",
    });
    activeRunSessionRef.current[workspaceId] = { sheetId: sheet.id };

    let result: WorkspaceRunResult;
    try {
      result = await studioBackend.runBatchSpeakerDiarization({
        workspaceId,
        paths: createWorkspacePaths(state.inputPath, state.outputPath),
        settings,
        table: state.table,
      });
    } catch (error) {
      delete activeRunSessionRef.current[workspaceId];
      updateState(workspaceId, {
        isBatchSpeakerRunning: false,
        statusText: "Speaker failed",
        error: error instanceof Error ? error.message : String(error),
        terminal: {
          ...statesRef.current[workspaceId].terminal,
          text: error instanceof Error ? error.message : String(error),
          status: "failed",
          updatedAt: new Date().toISOString(),
        },
      });
      return;
    }
    delete activeRunSessionRef.current[workspaceId];

    const latestState = statesRef.current.batch;
    const latestSheet = latestState.sheets.find((item) => item.id === sheet.id) ?? sheet;
    const selectionState = stateWithActiveSheet(latestState, latestSheet);
    const selection = buildTableSelectionPatch(workspaceId, result.table, selectionState, selectionState.selectedAudioPath || findFirstAudioPath(result.inputTree ?? latestState.inputTree));
    const nextBatchSpeakerChecks = Object.fromEntries(collectBatchSpeakers(result.table.rows).map((speaker) => [speaker, latestState.batchSpeakerChecks[speaker] !== false]));
    const finalStatusText = result.cancelled ? "Stopped" : result.ok ? "Speaker completed" : "Speaker failed";
    const finalError = result.cancelled || result.ok ? undefined : formatRunError(result);
    const finalProgressPercent = result.cancelled ? latestState.progressPercent : result.progress?.percent ?? (result.ok ? 100 : latestState.progressPercent);

    updateState(workspaceId, {
      isBatchSpeakerRunning: false,
      statusText: finalStatusText,
      error: finalError,
      progressPercent: finalProgressPercent,
      progress: result.progress,
      terminal: createTerminalFromResult(result, result.cancelled ? "cancelled" : result.ok ? "completed" : "failed"),
    });
    await nextAnimationFrame();

    updateSheetByIdState(workspaceId, sheet.id, {
      inputTree: result.inputTree ?? latestSheet.inputTree,
      table: result.table,
      details: selection.details.length > 0 ? selection.details : result.details,
      selectedRowId: selection.selectedRowId,
      selectedRowIds: selection.selectedRowIds,
      selectedFilePath: selection.selectedFilePath,
      selectedAudioPath: selection.selectedAudioPath,
      selectedResultAudioPath: selection.selectedResultAudioPath,
      browserPreferredSection: "input",
      batchSpeakerChecks: nextBatchSpeakerChecks,
      lastRun: { ...result, table: result.table },
    });
    setSettings((current) => ({
      ...current,
      batch: {
        ...current.batch,
        jobs: buildBatchJobs(result.table),
      },
    }));
  }, [createWorkspacePaths, setSettings, updateSheetByIdState, updateState]);

  const splitOrUnmergeSliceSegment = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow, componentIds: string[]) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const sourceIndex = state.table.rows.findIndex((row) => row.id === sourceRow.id);
      if (sourceIndex < 0) {
        return;
      }

      const currentSourceRow = state.table.rows[sourceIndex];
      const components = readSliceComponents(currentSourceRow);
      const sourceBounds = readSliceRowBounds(currentSourceRow);
      if (components.length === 0 && sourceBounds.endSec <= sourceBounds.startSec) {
        return;
      }

      const groups = components.length <= 1
        ? splitSingleSliceComponent(components[0] ?? sourceBounds)
        : partitionSliceComponents(currentSourceRow.id, components, componentIds);
      if (groups.length === 0) {
        return;
      }

      const allocateRowId = createSliceRowIdAllocator(state.table.rows);
      const replacementRows = groups.map((group, index) => {
        const id = index === 0 ? currentSourceRow.id : allocateRowId();
        return createSliceComponentRow(currentSourceRow, group, id, state.selectedAudioPath);
      });
      const nextRows = reindexSliceRows([
        ...state.table.rows.slice(0, sourceIndex),
        ...replacementRows,
        ...state.table.rows.slice(sourceIndex + 1),
      ]);
      const selectedRow = nextRows.find((row) => row.id === replacementRows[0]?.id) ?? nextRows[0];
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);

      updateSheetState(workspaceId, {
        table: { ...state.table, rows: nextRows },
        selectedRowId: selectedRow?.id,
        selectedRowIds: selectedRow ? [selectedRow.id] : [],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
      });
      updateState(workspaceId, { statusText: components.length <= 1 ? "Marker split" : "Marker unmerged" });
    },
    [updateSheetState, updateState],
  );

  const mergeSliceSegments = useCallback(
    (workspaceId: WorkspaceId) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const selectedIds = new Set(state.selectedRowIds);
      const selectedEntries = state.table.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => selectedIds.has(row.id));
      if (selectedEntries.length < 2) {
        return;
      }

      const activeSelectedRow = selectedEntries.find(({ row }) => row.id === state.selectedRowId)?.row ?? selectedEntries[0]?.row;
      if (!activeSelectedRow) {
        return;
      }

      const basePath = resolveSliceSourceIdentity(activeSelectedRow, state.selectedAudioPath);
      const mergeEntries = selectedEntries.filter(({ row }) => resolveSliceSourceIdentity(row, state.selectedAudioPath) === basePath);
      if (mergeEntries.length < 2) {
        return;
      }

      const mergeIds = new Set(mergeEntries.map(({ row }) => row.id));
      const orderedMergeEntries = mergeEntries.slice().sort((left, right) => numberFromSliceRow(left.row, "startSec") - numberFromSliceRow(right.row, "startSec") || numberFromSliceRow(left.row, "endSec") - numberFromSliceRow(right.row, "endSec") || left.index - right.index);
      const insertIndex = Math.min(...mergeEntries.map(({ index }) => index));
      const mergedComponents = orderedMergeEntries.flatMap(({ row }) => readSliceComponents(row)).sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
      if (mergedComponents.length === 0) {
        return;
      }

      const mergedId = createSliceRowIdAllocator(state.table.rows)();
      const templateRow = mergeEntries.find(({ row }) => row.id === state.selectedRowId)?.row ?? orderedMergeEntries[0].row;
      const mergedRow = createSliceComponentRow(templateRow, mergedComponents, mergedId, state.selectedAudioPath);
      const mergedRows = state.table.rows.flatMap((row, index) => {
        if (!mergeIds.has(row.id)) {
          return [row];
        }

        return index === insertIndex ? [mergedRow] : [];
      });
      const nextRows = reindexSliceRows(mergedRows);
      const selectedRow = nextRows.find((row) => row.id === mergedId) ?? nextRows[0];
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);
      const nextRowExportChecks = { ...state.rowExportChecks };
      const mergedExportChecked = mergeEntries.some(({ row }) => state.rowExportChecks[row.id] !== false);
      for (const rowId of mergeIds) {
        delete nextRowExportChecks[rowId];
      }
      if (selectedRow) {
        nextRowExportChecks[selectedRow.id] = mergedExportChecked;
      }

      updateSheetState(workspaceId, {
        table: { ...state.table, rows: nextRows },
        selectedRowId: selectedRow?.id,
        selectedRowIds: selectedRow ? [selectedRow.id] : [],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
        rowExportChecks: nextRowExportChecks,
      });
      updateState(workspaceId, { statusText: "Markers merged" });
    },
    [updateSheetState, updateState],
  );

  const addSliceSegment = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow | undefined, requestedStartSec?: number, requestedEndSec?: number) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const fallbackPath = firstNonVirtualPath(state.selectedAudioPath, findFirstAudioPath(state.inputTree), state.selectedFilePath);
      const originalPath = resolveSliceSourcePath(sourceRow, fallbackPath);
      if (!originalPath) {
        return;
      }

      const sourceBounds = readSliceRowBounds(sourceRow);
      const sourceStartSec = sourceRow ? sourceBounds.startSec : 0;
      const sourceEndSec = sourceRow ? sourceBounds.endSec : Math.max(0.001, Number.isFinite(requestedEndSec) ? Number(requestedEndSec) : 0.001);
      const startSec = Math.max(0, Number.isFinite(requestedStartSec) ? Number(requestedStartSec) : sourceStartSec);
      const endSec = Math.max(startSec + 0.001, Number.isFinite(requestedEndSec) ? Number(requestedEndSec) : sourceEndSec);
      if (endSec <= startSec) {
        return;
      }

      const nextIndex = state.table.rows.length + 1;
      const nextRowId = createSliceRowIdAllocator(state.table.rows)();
      const fileName = firstNonEmpty(sourceRow?.raw?.fileName, sourceRow?.raw?.file_name, sourceRow?.cells.fileName, shortName(originalPath));
      const durationSec = Math.max(0, endSec - startSec);
      const markerComponents = serializeSliceComponents([{ startSec, endSec }]);
      const newRow: DataTableRow = {
        id: nextRowId,
        sourcePath: originalPath,
        raw: {
          ...(sourceRow?.raw ?? {}),
          index: `${nextIndex}`,
          chunkIndex: `${nextIndex}`,
          fileName,
          file_name: fileName,
          originalPath,
          original_path: originalPath,
          inputPath: originalPath,
          input_path: originalPath,
          absolute_path: originalPath,
          outputPath: "",
          output_path: "",
          startSec: `${startSec}`,
          endSec: `${endSec}`,
          durationSec: `${durationSec}`,
          markerCount: "1",
          markerComponents,
          marker_components: markerComponents,
          status: "edited",
        },
        cells: {
          ...(sourceRow?.cells ?? {}),
          index: `${nextIndex}`,
          fileName,
          startSec: formatSecondsCell(startSec),
          endSec: formatSecondsCell(endSec),
          durationSec: `${durationSec.toFixed(2)}s`,
          markerCount: "1",
          status: "편집됨",
          outputPath: "",
        },
      };
      const nextRows = reindexSliceRows([...state.table.rows, newRow]);
      const selectedRow = nextRows.find((row) => row.id === newRow.id) ?? nextRows[nextRows.length - 1] ?? newRow;
      const nextTable = {
        ...state.table,
        rows: nextRows,
      };
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, originalPath);
      updateSheetState(workspaceId, {
        table: nextTable,
        selectedRowId: selectedRow.id,
        selectedRowIds: [selectedRow.id],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })),
        rowExportChecks: {
          ...state.rowExportChecks,
          [selectedRow.id]: true,
        },
        browserPreferredSection: "input",
        browserSectionRequestId: state.browserSectionRequestId + 1,
        browserRevealRequestId: state.browserRevealRequestId + 1,
        tableRevealRequestId: state.tableRevealRequestId + 1,
      });
      updateState(workspaceId, { statusText: "Marker added" });
    },
    [updateSheetState, updateState],
  );

  const deleteSliceSegment = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const removeIndex = state.table.rows.findIndex((row) => row.id === sourceRow.id);
      if (removeIndex < 0) {
        return;
      }

      const nextRows = reindexSliceRows(state.table.rows.filter((row) => row.id !== sourceRow.id));
      const nextSelectedRow = nextRows[Math.min(removeIndex, Math.max(0, nextRows.length - 1))] ?? nextRows[removeIndex - 1] ?? nextRows[0];
      const nextRowExportChecks = { ...state.rowExportChecks };
      delete nextRowExportChecks[sourceRow.id];
      const audioSelection = resolveAudioSelection(workspaceId, nextSelectedRow, state.selectedAudioPath || findFirstAudioPath(state.inputTree));

      updateSheetState(workspaceId, {
        table: { ...state.table, rows: nextRows },
        selectedRowId: nextSelectedRow?.id,
        selectedRowIds: nextSelectedRow ? [nextSelectedRow.id] : [],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: nextSelectedRow ? state.table.columns.map((column) => ({ label: column.label, value: nextSelectedRow.cells[column.key] || "" })) : state.details,
        rowExportChecks: nextRowExportChecks,
        browserPreferredSection: "input",
        browserRevealRequestId: state.browserRevealRequestId + 1,
        tableRevealRequestId: state.tableRevealRequestId + 1,
      });
      updateState(workspaceId, { statusText: "Marker removed" });
    },
    [updateSheetState, updateState],
  );

  const updateSliceSegmentBounds = useCallback(
    (workspaceId: WorkspaceId, sourceRow: DataTableRow, startSec: number, endSec: number) => {
      if (workspaceId !== "slice" && workspaceId !== "tagging") {
        return;
      }

      const state = statesRef.current[workspaceId];
      const safeStartSec = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
      const safeEndSec = Math.max(safeStartSec + 0.001, Number.isFinite(endSec) ? endSec : safeStartSec + 0.001);
      const durationSec = safeEndSec - safeStartSec;
      let updatedRow: DataTableRow | undefined;
      const nextRows: DataTableRow[] = state.table.rows.map((row): DataTableRow => {
        if (row.id !== sourceRow.id) {
          return row;
        }

        const retimedComponents = retimeSliceComponents(row, safeStartSec, safeEndSec);
        const nextRaw: Record<string, string> = {
          ...(row.raw ?? {}),
          startSec: `${safeStartSec}`,
          endSec: `${safeEndSec}`,
          durationSec: `${durationSec}`,
          status: row.raw?.status || "edited",
        };

        if (retimedComponents) {
          const serializedComponents = serializeSliceComponents(retimedComponents);
          nextRaw.markerComponents = serializedComponents;
          nextRaw.marker_components = serializedComponents;
          nextRaw.markerCount = `${retimedComponents.length}`;
        }

        const nextRow: DataTableRow = {
          ...row,
          raw: nextRaw,
          cells: {
            ...row.cells,
            startSec: formatSecondsCell(safeStartSec),
            endSec: formatSecondsCell(safeEndSec),
            durationSec: `${durationSec.toFixed(2)}s`,
            markerCount: retimedComponents ? `${retimedComponents.length}` : row.cells.markerCount,
          },
        };

        updatedRow = nextRow;
        return nextRow;
      });

      if (!updatedRow) {
        return;
      }

      const selectedRow = updatedRow;
      const nextTable = {
        ...state.table,
        rows: nextRows,
      };
      const audioSelection = resolveAudioSelection(workspaceId, selectedRow, state.selectedAudioPath);
      updateSheetState(workspaceId, {
        table: nextTable,
        selectedRowId: selectedRow.id,
        selectedRowIds: [selectedRow.id],
        selectedFilePath: audioSelection.selectedFilePath,
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        details: state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })),
      });
      updateState(workspaceId, { statusText: "Edited" });
    },
    [updateSheetState, updateState],
  );

  const syncTrainingModelCheckpoints = useCallback(
    (model: TrainingModelSummary | undefined, settingsOverride?: WorkspaceSettings["training"], options: { activate?: boolean } = {}) => {
      const state = statesRef.current.training;
      const settings = settingsOverride ?? settingsRef.current.training;
      const shouldActivate = options.activate !== false;
      const identity = trainingIdentityFromSettings(settings, model?.name);
      if (model && !trainingModelMatchesIdentity(model, identity)) {
        return;
      }

      const discoveredRows = model ? trainingCheckpointRows(model, identity) : [];
      const currentSheet = activeSheet(state);
      const matchingSheet = findTrainingSheetByIdentity(state.sheets, identity);
      const reuseCurrentSheet = Boolean(currentSheet && (!resultSheetHasRows(currentSheet) || trainingSheetMatchesIdentity(currentSheet, identity)));
      const targetSheet = reuseCurrentSheet ? currentSheet : matchingSheet;
      const baseTrainingTable = withTrainingTableModel(targetSheet?.table ?? createTrainingTableForModel(identity.selectedModel), identity.selectedModel);
      const targetTable = discoveredRows.length > 0
        ? mergeTrainingRows(baseTrainingTable, discoveredRows)
        : baseTrainingTable;
      const targetHasSameRows = targetSheet && discoveredRows.length === 0 && trainingSheetMatchesIdentity(targetSheet, identity);
      if (targetHasSameRows) {
        if (targetSheet.id !== state.activeSheetId && shouldActivate) {
          replaceState("training", stateWithActiveSheet({ ...state, activeSheetId: targetSheet.id }, targetSheet));
        } else if (!targetSheet.trainingIdentity && (targetSheet.id === state.activeSheetId || shouldActivate)) {
          updateSheetByIdState("training", targetSheet.id, { trainingIdentity: identity }, shouldActivate);
        }
        return;
      }

      const hasNewRows = !targetSheet || hasNewTrainingRows(targetSheet.table, discoveredRows);
      if (targetSheet && !hasNewRows && trainingSheetMatchesIdentity(targetSheet, identity)) {
        if (targetSheet.id !== state.activeSheetId && shouldActivate) {
          replaceState("training", stateWithActiveSheet({ ...state, activeSheetId: targetSheet.id }, targetSheet));
        }
        return;
      }
      const nextTable = targetTable;
      const selectionState = targetSheet ? stateWithActiveSheet(state, targetSheet) : state;
      const selection = buildTableSelectionPatch("training", nextTable, selectionState);
      const rowExportChecks = Object.fromEntries(nextTable.rows.map((row) => [row.id, targetSheet?.rowExportChecks[row.id] !== false]));
      const patch = {
        table: nextTable,
        details: selection.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
        trainingIdentity: identity,
        rowExportChecks,
      };

      if (targetSheet) {
        updateSheetByIdState("training", targetSheet.id, patch, shouldActivate && (targetSheet.id !== state.activeSheetId || reuseCurrentSheet));
        if (!state.isRunning) {
          updateState("training", { statusText: "Loaded", progressPercent: 0, error: undefined });
        }
        return;
      }

      if (!shouldActivate) {
        return;
      }

      const nextSheet = createWorkspaceResultSheet("training", nextSheetLabel(state.sheets), {
        inputPath: state.inputPath,
        outputPath: state.outputPath,
        inputTree: state.inputTree,
        outputTree: state.outputTree,
        browserPreferredSection: "input",
        table: nextTable,
        details: selection.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
        trainingIdentity: identity,
        rowExportChecks: Object.fromEntries(nextTable.rows.map((row) => [row.id, true])),
      });
      replaceState("training", stateWithActiveSheet({
        ...state,
        statusText: state.isRunning ? state.statusText : "Loaded",
        progressPercent: state.isRunning ? state.progressPercent : 0,
        error: state.isRunning ? state.error : undefined,
        sheets: [...state.sheets, nextSheet],
        activeSheetId: nextSheet.id,
      }, nextSheet));
    },
    [replaceState, updateSheetByIdState, updateState],
  );

  useEffect(() => {
    let disposed = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay = GPT_SOVITS_CHECKPOINT_POLL_MS) => {
      if (!disposed) {
        timer = setTimeout(() => void poll(), delay);
      }
    };

    const poll = async () => {
      if (disposed || polling) {
        return;
      }

      const pollSettings = settingsRef.current.training;
      if (pollSettings.selectedModel !== "gpt-sovits" || !pollSettings.modelName.trim()) {
        schedule();
        return;
      }

      polling = true;
      try {
        const result = await studioBackend.listTrainingModels({ settings: pollSettings });
        if (disposed || result.selectedModel !== "gpt-sovits") {
          return;
        }

        const model = findTrainingModelByName(result.models, pollSettings.modelName);
        if (!model) {
          return;
        }

        syncTrainingModelCheckpoints(model, pollSettings, { activate: false });
        setSettings((current) => {
          if (!sameGptSovitsWatchTarget(current.training, pollSettings)) {
            return current;
          }

          const nextTraining = settingsWithGptSovitsAutoCheckpoints(current.training, model.checkpoints);
          return nextTraining === current.training ? current : { ...current, training: nextTraining };
        });
      } catch {
        // The watcher is best-effort; the next tick will rescan the same folders.
      } finally {
        polling = false;
        schedule();
      }
    };

    schedule(0);
    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [setSettings, syncTrainingModelCheckpoints]);

  const run = useCallback(
    async (workspaceId: WorkspaceId) => {
      const state = statesRef.current[workspaceId];
      const settings = settingsRef.current;
      if (!state.inputPath || state.isRunning || state.isExporting || state.isBatchSpeakerRunning) {
        return;
      }
      const runtimeStatus = await checkRuntimeEnvironment(workspaceId);
      if (runtimeStatus && !runtimeStatus.ok) {
        return;
      }
      const voiceModelStatus = await checkVoiceModelRuntime(workspaceId);
      if (voiceModelStatus && !voiceModelStatus.ok) {
        return;
      }

      const emptyTable = workspaceId === "training"
        ? createTrainingTableForModel(settings.training.selectedModel)
        : createEmptyWorkspaceTable(workspaceId);
      const fallbackAudioPath = workspaceId === "inference" ? state.selectedAudioPath || findFirstAudioPath(state.inputTree) : findFirstAudioPath(state.inputTree);
      const currentSheet = activeSheet(state);
      const trainingIdentity = workspaceId === "training" ? trainingIdentityFromSettings(settings.training) : undefined;
      const matchingTrainingSheet = trainingIdentity ? findTrainingSheetByIdentity(state.sheets, trainingIdentity) : undefined;
      const reuseActiveSheet = Boolean(
        currentSheet
          && (
            !resultSheetHasRows(currentSheet)
            || (trainingIdentity && trainingSheetMatchesIdentity(currentSheet, trainingIdentity))
          ),
      );
      const targetSheet = workspaceId === "training"
        ? reuseActiveSheet
          ? currentSheet
          : matchingTrainingSheet
        : reuseActiveSheet
          ? currentSheet
          : undefined;
      const runBaseTable = workspaceId === "training" && targetSheet && trainingIdentity && trainingSheetMatchesIdentity(targetSheet, trainingIdentity)
        ? targetSheet.table
        : emptyTable;
      const browserSectionRequestId = state.browserSectionRequestId + 1;
      const runSheet = createWorkspaceResultSheet(workspaceId, targetSheet ? targetSheet.label : nextSheetLabel(state.sheets), {
        id: targetSheet?.id,
        inputPath: state.inputPath,
        outputPath: state.outputPath,
        inputTree: state.inputTree,
        outputTree: undefined,
        table: runBaseTable,
        details: runBaseTable.rows.length > 0 ? buildTableSelectionPatch(workspaceId, runBaseTable, stateWithActiveSheet(state, targetSheet ?? currentSheet ?? state.sheets[0])).details : emptyTable.columns.map((column) => ({ label: column.label, value: "-" })),
        selectedFilePath: fallbackAudioPath,
        selectedAudioPath: fallbackAudioPath,
        browserPreferredSection: "input",
        browserSectionRequestId,
        trainingIdentity,
      });
      const sheets = targetSheet
        ? state.sheets.map((sheet) => (sheet.id === runSheet.id ? runSheet : sheet))
        : [...state.sheets, runSheet];
      replaceState(workspaceId, stateWithActiveSheet({
        ...state,
        isRunning: true,
        statusText: "Running",
        progressPercent: 0,
        progress: undefined,
        error: undefined,
        terminal: createTerminalStartState(`${workspaceId} 실행 시작`),
        terminalOpenRequestId: state.terminalOpenRequestId + 1,
        browserPreferredSection: "input",
        browserSectionRequestId,
        sheets,
        activeSheetId: runSheet.id,
      }, runSheet));
      activeRunSessionRef.current[workspaceId] = { sheetId: runSheet.id, baseTable: runBaseTable.rows.length > 0 ? runBaseTable : undefined };
      const runAudioEdits = getAudioEditExportMap(runSheet.id);
      const runSettings = workspaceId === "inference"
        ? {
            ...settings,
            inference: {
              ...settings.inference,
              referenceAudioPath: state.selectedAudioPath || settings.inference.referenceAudioPath,
            },
          }
        : settings;

      let result: WorkspaceRunResult;
      try {
        result = await studioBackend.runWorkspace({
          workspaceId,
          paths: createWorkspacePaths(state.inputPath, state.outputPath),
          settings: runSettings,
          audioEdits: runAudioEdits,
        });
      } catch (error) {
        delete activeRunSessionRef.current[workspaceId];
        updateState(workspaceId, {
          isRunning: false,
          statusText: "Failed",
          error: error instanceof Error ? error.message : String(error),
          terminal: {
            ...statesRef.current[workspaceId].terminal,
            text: error instanceof Error ? error.message : String(error),
            status: "failed",
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
      delete activeRunSessionRef.current[workspaceId];

      const latestState = statesRef.current[workspaceId];
      const finalTable = workspaceId === "training" && runBaseTable.rows.length > 0
        ? mergeTrainingRows(runBaseTable, result.table.rows)
        : result.table;
      const selection = buildTableSelectionPatch(workspaceId, finalTable, latestState, latestState.selectedAudioPath || findFirstAudioPath(result.inputTree));
      const nextBatchSpeakerChecks = workspaceId === "batch"
        ? Object.fromEntries(collectBatchSpeakers(finalTable.rows).map((speaker) => [speaker, latestState.batchSpeakerChecks[speaker] !== false]))
        : latestState.batchSpeakerChecks;
      if (workspaceId === "tagging") {
        setTagScoreRules((current) => mergeTagScoreRulesFromTable(current, finalTable));
      }

      updateSheetByIdState(workspaceId, runSheet.id, {
        inputTree: result.inputTree,
        outputTree: undefined,
        table: finalTable,
        details: selection.details.length > 0 ? selection.details : result.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
        browserPreferredSection: "input",
        batchSpeakerChecks: nextBatchSpeakerChecks,
        lastRun: { ...result, table: finalTable },
        trainingIdentity,
      });
      updateState(workspaceId, {
        isRunning: false,
        statusText: result.cancelled ? "Stopped" : result.ok ? "Completed" : "Failed",
        error: result.cancelled || result.ok ? undefined : formatRunError(result),
        progressPercent: result.cancelled ? latestState.progressPercent : result.progress?.percent ?? (result.ok ? 100 : latestState.progressPercent),
        progress: result.progress,
        terminal: createTerminalFromResult(result, result.cancelled ? "cancelled" : result.ok ? "completed" : "failed"),
      });
      if (workspaceId === "batch") {
        setSettings((current) => ({
          ...current,
          batch: {
            ...current.batch,
            jobs: buildBatchJobs(finalTable),
          },
        }));
      }
    },
    [checkRuntimeEnvironment, checkVoiceModelRuntime, createWorkspacePaths, replaceState, setSettings, updateSheetByIdState, updateState],
  );

  const retry = useCallback(
    async (workspaceId: WorkspaceId) => {
      const state = statesRef.current[workspaceId];
      const sheet = activeSheet(state);
      const settings = settingsRef.current;
      if (!sheet || !state.inputPath || state.isRunning || state.isExporting || state.isBatchSpeakerRunning || !sheetCanRetry(sheet)) {
        return;
      }
      const runtimeStatus = await checkRuntimeEnvironment(workspaceId);
      if (runtimeStatus && !runtimeStatus.ok) {
        return;
      }
      const voiceModelStatus = await checkVoiceModelRuntime(workspaceId);
      if (voiceModelStatus && !voiceModelStatus.ok) {
        return;
      }

      const retryPlan = buildRetryPlan(workspaceId, sheet, state.inputTree);
      const fallbackAudioPath = findFirstAudioPath(state.inputTree);
      const selection = buildTableSelectionPatch(workspaceId, retryPlan.baseTable, stateWithActiveSheet(state, sheet), fallbackAudioPath);
      const browserSectionRequestId = state.browserSectionRequestId + 1;
      updateSheetByIdState(workspaceId, sheet.id, {
        table: retryPlan.baseTable,
        details: selection.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
        browserPreferredSection: "input",
        browserSectionRequestId,
        lastRun: sheet.lastRun,
      }, true);
      updateState(workspaceId, {
        isRunning: true,
        statusText: "Retrying",
        progressPercent: 0,
        progress: undefined,
        error: undefined,
        terminal: createTerminalStartState(`${workspaceId} 재실행 시작`),
        terminalOpenRequestId: state.terminalOpenRequestId + 1,
        browserPreferredSection: "input",
        browserSectionRequestId,
      });
      activeRunSessionRef.current[workspaceId] = {
        sheetId: sheet.id,
        baseTable: retryPlan.baseTable.rows.length > 0 ? retryPlan.baseTable : undefined,
        sourcePathByFileName: retryPlan.sourcePathByFileName,
      };
      const retryAudioEdits = getAudioEditExportMap(sheet.id);
      const retrySettings = workspaceId === "training" ? settingsWithTrainingSheet(settings, sheet) : settings;

      let result: WorkspaceRunResult;
      try {
        result = await studioBackend.runWorkspace({
          workspaceId,
          paths: createWorkspacePaths(state.inputPath, state.outputPath),
          settings: retrySettings,
          retry: workspaceId === "training" ? {} : retryPlan.pendingSourcePaths.length > 0 ? { sourcePaths: retryPlan.pendingSourcePaths } : undefined,
          audioEdits: retryAudioEdits,
        });
      } catch (error) {
        delete activeRunSessionRef.current[workspaceId];
        updateState(workspaceId, {
          isRunning: false,
          statusText: "Retry failed",
          error: error instanceof Error ? error.message : String(error),
          terminal: {
            ...statesRef.current[workspaceId].terminal,
            text: error instanceof Error ? error.message : String(error),
            status: "failed",
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
      delete activeRunSessionRef.current[workspaceId];

      const latestState = statesRef.current[workspaceId];
      const latestSheet = latestState.sheets.find((item) => item.id === sheet.id) ?? sheet;
      const table = retryPlan.baseTable.rows.length > 0
        ? workspaceId === "training"
          ? mergeTrainingRows(retryPlan.baseTable, result.table.rows)
          : mergeRetryTables(workspaceId, retryPlan.baseTable, result.table, retryPlan.sourcePathByFileName)
        : normalizeRetryTable(workspaceId, result.table, retryPlan.sourcePathByFileName);
      const selectionState = stateWithActiveSheet(latestState, latestSheet);
      const nextSelection = buildTableSelectionPatch(workspaceId, table, selectionState, selectionState.selectedAudioPath || fallbackAudioPath);
      const nextBatchSpeakerChecks = workspaceId === "batch"
        ? Object.fromEntries(collectBatchSpeakers(table.rows).map((speaker) => [speaker, latestState.batchSpeakerChecks[speaker] !== false]))
        : latestState.batchSpeakerChecks;
      if (workspaceId === "tagging") {
        setTagScoreRules((current) => mergeTagScoreRulesFromTable(current, table));
      }

      updateSheetByIdState(workspaceId, sheet.id, {
        inputTree: result.inputTree ?? latestSheet.inputTree,
        outputTree: undefined,
        table,
        details: nextSelection.details.length > 0 ? nextSelection.details : result.details,
        selectedRowId: nextSelection.selectedRowId,
        selectedRowIds: nextSelection.selectedRowIds,
        selectedFilePath: nextSelection.selectedFilePath,
        selectedAudioPath: nextSelection.selectedAudioPath,
        selectedResultAudioPath: nextSelection.selectedResultAudioPath,
        browserPreferredSection: "input",
        batchSpeakerChecks: nextBatchSpeakerChecks,
        lastRun: { ...result, table },
      });
      updateState(workspaceId, {
        isRunning: false,
        statusText: result.cancelled ? "Stopped" : result.ok ? "Retry completed" : "Retry failed",
        error: result.cancelled || result.ok ? undefined : formatRunError(result),
        progressPercent: result.cancelled ? latestState.progressPercent : result.progress?.percent ?? (result.ok ? 100 : latestState.progressPercent),
        progress: result.progress,
        terminal: createTerminalFromResult(result, result.cancelled ? "cancelled" : result.ok ? "completed" : "failed"),
      });
      if (workspaceId === "batch") {
        setSettings((current) => ({
          ...current,
          batch: {
            ...current.batch,
            jobs: buildBatchJobs(table),
          },
        }));
      }
    },
    [checkRuntimeEnvironment, checkVoiceModelRuntime, createWorkspacePaths, setSettings, updateSheetByIdState, updateState],
  );

  const exportWorkspace = useCallback(
    async (workspaceId: WorkspaceId) => {
      const state = statesRef.current[workspaceId];
      const table = buildExportTable(workspaceId, state.table, tagScoreRules, settingsRef.current);
      if (!state.inputPath || table.rows.length === 0 || state.isRunning || state.isExporting || state.isBatchSpeakerRunning) {
        return;
      }

      const browserSectionRequestId = state.browserSectionRequestId + 1;
      updateState(workspaceId, {
        isExporting: true,
        statusText: "Exporting",
        progressPercent: 0,
        error: undefined,
        browserPreferredSection: "output",
        browserSectionRequestId,
      });

      let result: WorkspaceExportResult;
      try {
        result = await studioBackend.exportWorkspace({
          workspaceId,
          paths: createWorkspacePaths(state.inputPath, state.outputPath),
          settings: settingsRef.current,
          table,
          rowDecisions: table.rows.map((row) => ({
            rowId: row.id,
            includeAudio: state.rowExportChecks[row.id] !== false,
          })),
          audioEdits: getAudioEditExportMap(activeSheet(state)?.id),
        });
      } catch (error) {
        updateState(workspaceId, {
          isExporting: false,
          statusText: "Export failed",
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      updateSheetState(workspaceId, {
        outputPath: result.outputPath ?? state.outputPath,
        outputTree: result.outputTree ?? state.outputTree,
        details: result.details.length > 0 ? result.details : state.details,
        browserPreferredSection: "output",
      });
      updateState(workspaceId, {
        isExporting: false,
        statusText: result.cancelled ? "Stopped" : result.ok ? "Exported" : "Export failed",
        error: result.cancelled || result.ok ? undefined : result.error,
        progressPercent: result.cancelled ? statesRef.current[workspaceId].progressPercent : result.progress?.percent ?? (result.ok ? 100 : state.progressPercent),
        browserPreferredSection: "output",
      });
    },
    [createWorkspacePaths, tagScoreRules, updateSheetState, updateState],
  );

  return useMemo(
    () => ({
      settings,
      setSettings,
      tagScoreRules,
      setTagScoreRules,
      overviewFilter,
      setOverviewFilter,
      getState: (workspaceId: WorkspaceId) => states[workspaceId],
      getTable,
      getMetrics,
      getClipboardRows: (workspaceId: WorkspaceId) => rowsClipboard?.workspaceId === workspaceId ? rowsClipboard.rows : [],
      selectSheet,
      createSheet,
      deleteSheet,
      copyRows,
      pasteRows,
      canRun: (workspaceId: WorkspaceId) => Boolean(states[workspaceId].inputPath) && !states[workspaceId].isRunning && !states[workspaceId].isExporting && !states[workspaceId].isBatchSpeakerRunning && !runtimeEnvironmentInstalling[workspaceId] && !voiceModelRuntimeInstalling[workspaceId],
      canRetry: (workspaceId: WorkspaceId) => {
        const state = states[workspaceId];
        return Boolean(state.inputPath) && !state.isRunning && !state.isExporting && !state.isBatchSpeakerRunning && !voiceModelRuntimeInstalling[workspaceId] && sheetCanRetry(activeSheet(state));
      },
      canExport: (workspaceId: WorkspaceId) => workspaceId !== "training" && Boolean(states[workspaceId].inputPath) && states[workspaceId].table.rows.length > 0 && !states[workspaceId].isRunning && !states[workspaceId].isExporting && !states[workspaceId].isBatchSpeakerRunning,
      cancelWorkspace,
      cancelBatchSpeakerDiarization,
      clearError,
      clearTerminal,
      selectInputFolder,
      selectOutputFolder,
      loadFileBrowserWindow,
      selectFileNode,
      selectRow,
      selectRows,
      selectAdjacentRow,
      toggleRowExportCheck,
      setAllRowExportChecks,
      setRowsExportChecks,
      setBatchFilter,
      setTableSearch,
      editBatchCell,
      toggleBatchSpeaker,
      runBatchSpeakerDiarization,
      mergeEnabledBatchSpeakers,
      splitOrUnmergeSliceSegment,
      mergeSliceSegments,
      addSliceSegment,
      deleteSliceSegment,
      updateSliceSegmentBounds,
      run,
      retry,
      exportWorkspace,
      getRuntimeEnvironmentStatus: (workspaceId: WorkspaceId) => runtimeEnvironmentStatuses[workspaceId],
      isRuntimeEnvironmentInstalling: (workspaceId: WorkspaceId) => Boolean(runtimeEnvironmentInstalling[workspaceId]),
      checkRuntimeEnvironment,
      installRuntimeEnvironment,
      getVoiceModelRuntimeStatus: (workspaceId: WorkspaceId) => {
        const key = voiceModelRuntimeSettingsKey(workspaceId, settings);
        return key ? voiceModelRuntimeStatuses[key] : undefined;
      },
      isVoiceModelRuntimeInstalling: (workspaceId: WorkspaceId) => Boolean(voiceModelRuntimeInstalling[workspaceId]),
      checkVoiceModelRuntime,
      installVoiceModelRuntime,
      syncTrainingModelCheckpoints,
    }),
    [addSliceSegment, cancelBatchSpeakerDiarization, cancelWorkspace, checkRuntimeEnvironment, checkVoiceModelRuntime, clearError, clearTerminal, copyRows, createSheet, deleteSheet, deleteSliceSegment, editBatchCell, exportWorkspace, getMetrics, getTable, installRuntimeEnvironment, installVoiceModelRuntime, loadFileBrowserWindow, mergeEnabledBatchSpeakers, mergeSliceSegments, overviewFilter, pasteRows, retry, rowsClipboard, run, runBatchSpeakerDiarization, runtimeEnvironmentInstalling, runtimeEnvironmentStatuses, selectAdjacentRow, selectFileNode, selectInputFolder, selectOutputFolder, selectRow, selectRows, selectSheet, setAllRowExportChecks, setBatchFilter, setRowsExportChecks, setTableSearch, settings, splitOrUnmergeSliceSegment, states, syncTrainingModelCheckpoints, tagScoreRules, toggleBatchSpeaker, toggleRowExportCheck, updateSliceSegmentBounds, voiceModelRuntimeInstalling, voiceModelRuntimeStatuses],
  );
}

function normalizeBatchQcStatus(value: string): string {
  const normalized = value.trim();
  if (normalized === "검수됨" || normalized === "수정됨" || normalized === "검수전") {
    return normalized;
  }
  return "검수전";
}

function buildTableSelectionPatch(workspaceId: WorkspaceId, table: DataTable, state: WorkspaceRuntimeState, fallbackAudioPath = "") {
  const rowById = new Map(table.rows.map((row) => [row.id, row]));
  const retainedSelectedRowIds = state.selectedRowIds.filter((rowId) => rowById.has(rowId));
  const selectedRow = (state.selectedRowId ? rowById.get(state.selectedRowId) : undefined) ?? (retainedSelectedRowIds[0] ? rowById.get(retainedSelectedRowIds[0]) : undefined) ?? table.rows[0];
  const selectedRowIds = retainedSelectedRowIds.length > 0 ? retainedSelectedRowIds : selectedRow ? [selectedRow.id] : [];
  const audioSelection = resolveAudioSelection(workspaceId, selectedRow, fallbackAudioPath);

  return {
    selectedRowId: selectedRow?.id,
    selectedRowIds,
    selectedFilePath: audioSelection.selectedFilePath,
    selectedAudioPath: audioSelection.selectedAudioPath,
    selectedResultAudioPath: audioSelection.selectedResultAudioPath,
    details: selectedRow ? table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : table.columns.map((column) => ({ label: column.label, value: "-" })),
  };
}

function toggleSelectedRowId(selectedRowIds: string[], rowId: string): string[] {
  if (!selectedRowIds.includes(rowId)) {
    return [...selectedRowIds, rowId];
  }

  const nextSelectedRowIds = selectedRowIds.filter((selectedRowId) => selectedRowId !== rowId);
  return nextSelectedRowIds.length > 0 ? nextSelectedRowIds : [rowId];
}

function createTrainingTableForModel(
  selectedModel: WorkspaceTrainingIdentity["selectedModel"],
  rows: DataTableRow[] = [],
): DataTable {
  return withTrainingTableModel({ ...createEmptyWorkspaceTable("training"), rows }, selectedModel);
}

function withTrainingTableModel(
  table: DataTable,
  selectedModel: WorkspaceTrainingIdentity["selectedModel"],
): DataTable {
  return {
    ...table,
    columns: trainingColumnsForModel(selectedModel),
    rows: table.rows.map((row) => normalizeTrainingRowForModel(row, selectedModel)),
  };
}

function trainingColumnsForModel(selectedModel: WorkspaceTrainingIdentity["selectedModel"]): DataTable["columns"] {
  const hiddenColumn = selectedModel === "omnivoice" ? "epoch" : "step";
  return workspaceTableColumns.training.filter((column) => column.key !== hiddenColumn);
}

function normalizeTrainingRowForModel(
  row: DataTableRow,
  selectedModel: WorkspaceTrainingIdentity["selectedModel"],
): DataTableRow {
  const epoch = selectedModel === "omnivoice" ? "" : row.cells.epoch || row.raw?.epoch || "";
  const step = selectedModel === "omnivoice" ? row.cells.step || row.raw?.step || "" : "";
  return {
    ...row,
    raw: row.raw ? { ...row.raw, epoch, step } : undefined,
    cells: { ...row.cells, epoch, step },
  };
}

function trainingIdentityFromSettings(settings: WorkspaceSettings["training"], modelNameOverride?: string): WorkspaceTrainingIdentity {
  const selectedModel = settings.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
  return {
    selectedModel,
    toolRoot: settings.toolRoot.trim(),
    modelName: (modelNameOverride ?? settings.modelName).trim(),
    gptVersion: selectedModel === "gpt-sovits" ? settings.gptVersion : undefined,
  };
}

function trainingModelMatchesIdentity(model: TrainingModelSummary, identity: WorkspaceTrainingIdentity): boolean {
  return normalizedIdentityValue(model.name) === normalizedIdentityValue(identity.modelName);
}

function findTrainingModelByName(models: TrainingModelSummary[], modelName: string): TrainingModelSummary | undefined {
  const normalizedName = normalizedIdentityValue(modelName);
  return models.find((model) => normalizedIdentityValue(model.name) === normalizedName);
}

function sameGptSovitsWatchTarget(current: WorkspaceSettings["training"], polled: WorkspaceSettings["training"]): boolean {
  return current.selectedModel === "gpt-sovits"
    && polled.selectedModel === "gpt-sovits"
    && current.gptVersion === polled.gptVersion
    && normalizedIdentityValue(current.modelName) === normalizedIdentityValue(polled.modelName)
    && normalizePathIdentity(current.toolRoot) === normalizePathIdentity(polled.toolRoot);
}

function applyTrainingIdentityToSettings(
  settings: WorkspaceSettings["training"],
  identity: WorkspaceTrainingIdentity,
): WorkspaceSettings["training"] {
  return {
    ...settings,
    selectedModel: identity.selectedModel,
    toolRoot: identity.toolRoot || settings.toolRoot,
    modelName: identity.modelName || settings.modelName,
    gptVersion: identity.selectedModel === "gpt-sovits" && identity.gptVersion ? identity.gptVersion : settings.gptVersion,
  };
}

function findTrainingSheetByIdentity(sheets: WorkspaceResultSheet[], identity: WorkspaceTrainingIdentity): WorkspaceResultSheet | undefined {
  return sheets.find((sheet) => trainingSheetMatchesIdentity(sheet, identity));
}

function trainingSheetMatchesIdentity(sheet: WorkspaceResultSheet | undefined, identity: WorkspaceTrainingIdentity): boolean {
  const sheetIdentity = resolveTrainingIdentityFromSheet(sheet);
  return Boolean(sheetIdentity && trainingIdentityKey(sheetIdentity) === trainingIdentityKey(identity));
}

function resolveTrainingIdentityFromSheet(sheet: WorkspaceResultSheet | undefined): WorkspaceTrainingIdentity | undefined {
  if (!sheet) {
    return undefined;
  }
  if (sheet.trainingIdentity?.modelName.trim()) {
    return sheet.trainingIdentity;
  }

  const row = sheet.table.rows.find((item) => item.raw?.modelName || item.cells.modelName);
  const modelName = row?.raw?.modelName || row?.cells.modelName || "";
  if (!modelName.trim()) {
    return undefined;
  }
  const modelType = row?.raw?.modelType === "omnivoice" ? "omnivoice" : "gpt-sovits";
  const gptVersion = row?.raw?.gptVersion as WorkspaceSettings["training"]["gptVersion"] | undefined;
  return {
    selectedModel: modelType,
    toolRoot: row?.raw?.toolRoot || "",
    modelName,
    gptVersion: modelType === "gpt-sovits" ? gptVersion : undefined,
  };
}

function trainingIdentityKey(identity: WorkspaceTrainingIdentity): string {
  return [
    identity.selectedModel,
    identity.selectedModel === "gpt-sovits" ? identity.gptVersion ?? "" : "",
    normalizePathIdentity(identity.toolRoot),
    normalizedIdentityValue(identity.modelName),
  ].join("|");
}

function trainingCheckpointRows(model: TrainingModelSummary, identity: WorkspaceTrainingIdentity): DataTableRow[] {
  return model.checkpoints
    .filter(isPublishableTrainingCheckpoint)
    .map((checkpoint, index) => trainingCheckpointRow(checkpoint, identity, index));
}

function trainingCheckpointRow(
  checkpoint: TrainingCheckpointSummary,
  identity: WorkspaceTrainingIdentity,
  index: number,
): DataTableRow {
  const checkpointName = shortName(checkpoint.path);
  const stage = trainingCheckpointStageLabel(checkpoint);
  const unit = checkpoint.kind === "omnivoice"
    ? { epoch: "", step: checkpoint.step ?? "" }
    : { epoch: checkpoint.epoch ?? "", step: "" };
  const raw: Record<string, string> = {
    id: checkpoint.path,
    modelType: identity.selectedModel,
    modelName: identity.modelName,
    toolRoot: identity.toolRoot,
    gptVersion: identity.gptVersion ?? "",
    stage: checkpoint.kind,
    checkpointRole: checkpoint.role ?? "",
    checkpointComponent: checkpoint.component ?? "",
    epoch: unit.epoch,
    step: unit.step,
    checkpoint: checkpointName,
    checkpointPath: checkpoint.path,
    status: "completed",
    discoveredCheckpoint: "true",
  };
  return {
    id: checkpoint.path || `${index + 1}`,
    sourcePath: checkpoint.path,
    raw,
    cells: {
      index: `${index + 1}`,
      modelName: identity.modelName,
      stage,
      epoch: unit.epoch,
      step: unit.step,
      elapsed: "",
      checkpoint: checkpointName,
      status: "completed",
    },
  };
}

function isPublishableTrainingCheckpoint(checkpoint: TrainingCheckpointSummary): boolean {
  const normalized = normalizePathIdentity(checkpoint.path);
  if (!normalized) {
    return false;
  }
  return !normalized.includes("/vendor/hf/");
}

function trainingCheckpointStageLabel(checkpoint: TrainingCheckpointSummary): string {
  const roleText = checkpoint.role === "resume" ? "이어하기용" : checkpoint.role === "inference" ? "추론용" : "이어하기/추론용";
  if (checkpoint.kind === "omnivoice") {
    return `OmniVoice ${roleText}`;
  }
  if (checkpoint.kind === "gpt") {
    return `GPT ${roleText}`;
  }
  if (checkpoint.component === "discriminator") {
    return `SoVITS ${roleText} D`;
  }
  if (checkpoint.component === "generator") {
    return `SoVITS ${roleText} G`;
  }
  return `SoVITS ${roleText}`;
}

function mergeTrainingRows(table: DataTable, incomingRows: DataTableRow[]): DataTable {
  const rows = table.rows.map(cloneRow);
  const existingKeys = new Set(rows.map(trainingRowKey).filter(Boolean));
  for (const row of incomingRows) {
    const key = trainingRowKey(row);
    if (key && existingKeys.has(key)) {
      continue;
    }
    rows.push(cloneRow(row));
    if (key) {
      existingKeys.add(key);
    }
  }
  return reindexTable("training", tableWithRows(table, rows));
}

function hasNewTrainingRows(table: DataTable, incomingRows: DataTableRow[]): boolean {
  const existingKeys = new Set(table.rows.map(trainingRowKey).filter(Boolean));
  return incomingRows.some((row) => {
    const key = trainingRowKey(row);
    return !key || !existingKeys.has(key);
  });
}

function trainingRowKey(row: DataTableRow): string {
  const raw = row.raw ?? {};
  const checkpointPath = raw.checkpointPath || raw.checkpoint_path || row.sourcePath;
  if (checkpointPath) {
    return `${raw.modelType || ""}|${raw.modelName || row.cells.modelName || ""}|${raw.stage || row.cells.stage || ""}|${normalizePathIdentity(checkpointPath)}`;
  }
  return `${raw.modelType || ""}|${raw.modelName || row.cells.modelName || ""}|${raw.stage || row.cells.stage || ""}|${row.cells.epoch || raw.epoch || ""}|${row.cells.step || raw.step || ""}`;
}

function normalizedIdentityValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizePathIdentity(value: string | undefined): string {
  return (value ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}

function sheetCanRetry(sheet: ReturnType<typeof activeSheet>): boolean {
  return Boolean(sheet && (sheet.table.rows.length > 0 || sheet.lastRun));
}

function buildRetryPlan(workspaceId: WorkspaceId, sheet: NonNullable<ReturnType<typeof activeSheet>>, inputTree: FileTreeResult | undefined) {
  if (workspaceId === "training" || workspaceId === "inference") {
    return {
      baseTable: sheet.table,
      pendingSourcePaths: [],
      sourcePathByFileName: new Map<string, string>(),
    };
  }

  const allInputPaths = collectInputAudioPaths(inputTree);
  const successful = sheetRunSucceeded(sheet);
  const canResume = !successful && allInputPaths.length > 0;
  const baseTable = canResume ? tableWithRows(sheet.table, sheet.table.rows.filter((row) => rowCompletedSuccessfully(workspaceId, row))) : createEmptyWorkspaceTable(workspaceId);
  const completedSourceKeys = new Set(baseTable.rows.map((row) => normalizedSourceKey(rowSourcePath(workspaceId, row))).filter(Boolean));
  const completedFileNames = new Set(baseTable.rows.map((row) => fileNameKey(rowFileName(row))).filter(Boolean));
  const pendingSourcePaths = !canResume
    ? []
    : allInputPaths.filter((sourcePath) => {
        const sourceKey = normalizedSourceKey(sourcePath);
        const nameKey = fileNameKey(sourcePath);
        const wavNameKey = wavCacheFileNameKey(sourcePath);
        return !completedSourceKeys.has(sourceKey) && !completedFileNames.has(nameKey) && !completedFileNames.has(wavNameKey);
      });

  return {
    baseTable,
    pendingSourcePaths,
    sourcePathByFileName: buildSourcePathLookup(allInputPaths),
  };
}

function buildSourcePathLookup(sourcePaths: string[]): Map<string, string> {
  const pairs: Array<[string, string]> = [];
  for (const sourcePath of sourcePaths) {
    pairs.push([fileNameKey(sourcePath), sourcePath]);
    pairs.push([wavCacheFileNameKey(sourcePath), sourcePath]);
  }
  return new Map(pairs);
}

function mergeRetryTables(workspaceId: WorkspaceId, baseTable: DataTable, retryTable: DataTable, sourcePathByFileName?: Map<string, string>): DataTable {
  return reindexTable(workspaceId, tableWithRows(baseTable, [...baseTable.rows, ...normalizeRetryTable(workspaceId, retryTable, sourcePathByFileName).rows]));
}

function normalizeRetryTable(workspaceId: WorkspaceId, table: DataTable, sourcePathByFileName?: Map<string, string>): DataTable {
  return reindexTable(workspaceId, tableWithRows(table, table.rows.map((row) => normalizeRetryRow(workspaceId, row, sourcePathByFileName))));
}

function normalizeRetryRow(workspaceId: WorkspaceId, row: DataTableRow, sourcePathByFileName?: Map<string, string>): DataTableRow {
  const fileName = rowFileName(row);
  const originalPath = sourcePathByFileName?.get(fileNameKey(fileName));
  if (!originalPath) {
    return row;
  }

  const raw = { ...(row.raw ?? {}) };
  if (workspaceId === "overview") {
    raw.absolute_path = originalPath;
  } else {
    raw.originalPath = originalPath;
    raw.original_path = originalPath;
  }

  return {
    ...row,
    sourcePath: workspaceId === "speaker" ? row.sourcePath : originalPath,
    raw,
  };
}

function tableWithRows(table: DataTable, rows: DataTableRow[]): DataTable {
  return { ...table, rows };
}

function reindexTable(_workspaceId: WorkspaceId, table: DataTable): DataTable {
  return {
    ...table,
    rows: table.rows.map((row, index) => ({
      ...row,
      id: `${index + 1}`,
      cells: {
        ...row.cells,
        index: `${index + 1}`,
      },
    })),
  };
}

function pasteRowsIntoTable(workspaceId: WorkspaceId, targetTable: DataTable, sourceRows: DataTableRow[], duplicateMode: "overwrite" | "skip"): DataTable {
  const nextRows = targetTable.rows.map(cloneRow);
  const indexBySourceKey = new Map(nextRows.map((row, index) => [duplicateKey(workspaceId, row), index]).filter(([key]) => Boolean(key)) as Array<[string, number]>);

  for (const sourceRow of sourceRows) {
    const copiedRow = cloneRow(sourceRow);
    const key = duplicateKey(workspaceId, copiedRow);
    const existingIndex = key ? indexBySourceKey.get(key) : undefined;
    if (existingIndex !== undefined) {
      if (duplicateMode === "overwrite") {
        nextRows[existingIndex] = copiedRow;
      }
      continue;
    }

    indexBySourceKey.set(key, nextRows.length);
    nextRows.push(copiedRow);
  }

  return reindexTable(workspaceId, tableWithRows(targetTable, nextRows));
}

function duplicateKey(workspaceId: WorkspaceId, row: DataTableRow): string {
  return normalizedSourceKey(rowSourcePath(workspaceId, row)) || fileNameKey(rowFileName(row));
}

function cloneRow(row: DataTableRow): DataTableRow {
  return {
    ...row,
    cells: { ...row.cells },
    raw: row.raw ? { ...row.raw } : undefined,
  };
}

function settingsWithTrainingSheet(settings: WorkspaceSettings, sheet: WorkspaceResultSheet): WorkspaceSettings {
  const identity = resolveTrainingIdentityFromSheet(sheet);
  if (!identity) {
    return settings;
  }

  return {
    ...settings,
    training: applyTrainingIdentityToSettings(settings.training, identity),
  };
}

function sheetRunSucceeded(sheet: NonNullable<ReturnType<typeof activeSheet>>): boolean {
  const progress = sheet.lastRun?.progress;
  return Boolean(progress && progress.total > 0 && progress.completed === progress.total && progress.failed === 0 && progress.percent >= 100);
}

function rowCompletedSuccessfully(workspaceId: WorkspaceId, row: DataTableRow): boolean {
  if (workspaceId === "overview") {
    return !String(row.raw?.error ?? row.cells.error ?? "").trim();
  }

  return rawStatus(row) === "completed";
}

function rawStatus(row: DataTableRow): string {
  return String(row.raw?.status ?? row.raw?.audioStatus ?? row.raw?.sessionStatus ?? "").trim().toLowerCase();
}

function rowSourcePath(workspaceId: WorkspaceId, row: DataTableRow): string {
  const raw = row.raw ?? {};
  if (workspaceId === "overview") {
    return raw.absolute_path || row.sourcePath || row.cells.absolute_path || row.cells.file_name || "";
  }

  if (workspaceId === "training") {
    return raw.datasetPath || raw.dataset_path || raw.inputPath || raw.input_path || raw.checkpointPath || row.sourcePath || row.cells.modelName || "";
  }

  return raw.originalPath || raw.original_path || raw.inputPath || raw.input_path || row.sourcePath || row.cells.fileName || row.cells.file_name || "";
}

function rowFileName(row: DataTableRow): string {
  return row.raw?.fileName || row.raw?.file_name || row.cells.fileName || row.cells.file_name || row.sourcePath || row.id;
}

function resolveFileBrowserWindow(windowState: NonNullable<FileTreeResult["window"]>, direction: "reveal" | "sync" | "up" | "down", metrics?: ScrollWindowMetrics): { offset: number; limit: number } | undefined {
  const stepSize = Math.max(1, metrics?.stepSize ?? windowState.limit);
  const chunkSize = Math.max(1, metrics?.chunkSize ?? windowState.limit);

  if (direction === "reveal" || direction === "sync") {
    return {
      offset: Math.min(windowState.offset, Math.max(0, windowState.total - chunkSize)),
      limit: chunkSize,
    };
  }

  if (direction === "up") {
    if (!windowState.hasPrevious) {
      return undefined;
    }
    return {
      offset: Math.max(0, windowState.offset - stepSize),
      limit: chunkSize,
    };
  }

  if (!windowState.hasMore) {
    return undefined;
  }

  return {
    offset: Math.min(windowState.offset + stepSize, Math.max(0, windowState.total - chunkSize)),
    limit: chunkSize,
  };
}

function collectInputAudioPaths(inputTree: FileTreeResult | undefined): string[] {
  if (!inputTree) {
    return [];
  }

  const paths: string[] = [];
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "file" && isAudioPath(node.path)) {
        paths.push(node.path);
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(inputTree.nodes);
  return paths;
}

function isAudioConversionStatusTree(tree: FileTreeResult): boolean {
  const visit = (nodes: FileTreeNode[]): boolean => nodes.some((node) => {
    if (node.meta && (node.meta.includes("\ubcc0\ud658 \ub300\uae30") || node.meta.includes("\ubcc0\ud658 \uc911") || node.meta.includes("\ubcc0\ud658 \uc644\ub8cc") || node.meta.includes("\ubcc0\ud658 \uc900\ube44\ub428"))) {
      return true;
    }

    return node.children ? visit(node.children) : false;
  });

  return visit(tree.nodes);
}

function normalizedSourceKey(value: string | undefined): string {
  return (value ?? "").replace(/\\/gu, "/").trim().toLowerCase();
}

function fileNameKey(value: string | undefined): string {
  const normalized = normalizedSourceKey(value);
  return normalized.split("/").pop() ?? normalized;
}

function buildExportTable(workspaceId: WorkspaceId, table: DataTable, tagScoreRules: TagScoreRule[], settings: WorkspaceSettings): DataTable {
  if (workspaceId === "tagging") {
    return applyTagScoreRulesToTable(table, tagScoreRules, settings.slicer);
  }

  return table;
}

function filterTableBySearch(table: DataTable, query: string, selectedColumns: string[]): DataTable {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return table;
  }

  const columns = selectedColumns.length > 0 ? selectedColumns : table.columns.map((column) => column.key).filter((key) => key !== "index");
  return {
    ...table,
    rows: table.rows.filter((row) =>
      columns
        .map((key) => (key === "sourcePath" ? row.sourcePath ?? "" : row.cells[key] ?? row.raw?.[key] ?? ""))
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    ),
  };
}

function buildMetrics(workspaceId: WorkspaceId, state: WorkspaceRuntimeState, settings: WorkspaceSettings, displayTable?: DataTable): string[] {
  const totalRows = state.table.rows.length;
  const completed = state.table.rows.filter((row) => Object.values(row.cells).some((value) => value === "완료")).length;
  const failed = state.table.rows.filter((row) => Object.values(row.cells).some((value) => value === "실패")).length;

  if (workspaceId === "overview") {
    const enabledModules = [settings.overview.analyzeNoise].filter(Boolean).length;
    return [state.inputPath ? shortName(state.inputPath) : "-", `${totalRows}`, `${displayTable?.rows.length ?? totalRows}`, `${enabledModules}`];
  }

  if (workspaceId === "speaker") {
    return [`${totalRows}`, state.isRunning ? "1" : "0", `${completed}`, modelLabel(settings)];
  }

  if (workspaceId === "batch") {
    const speakers = new Set(state.table.rows.map((row) => row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker).filter(Boolean));
    return [`${totalRows}`, `${totalRows}`, `${speakers.size}`, `${speakers.size}`];
  }

  if (workspaceId === "training") {
    const checkpoints = state.table.rows.filter((row) => row.raw?.checkpointPath || row.raw?.checkpoint_path || row.cells.checkpoint).length;
    return [trainingModelLabel(settings), `${totalRows}`, `${checkpoints}`, trainingStatusText(state.statusText)];
  }

  return [`${totalRows}`, `${completed}`, `${failed}`, `${totalRows}`, "기본값"];
}

function modelLabel(settings: WorkspaceSettings): string {
  const labels = [
    settings.speaker.useVoiceFixer ? "VoiceFixer" : "",
    settings.speaker.useResemble ? "Resemble" : "",
    settings.speaker.useSidon ? "SIDON" : "",
  ].filter(Boolean);
  return labels.length > 0 ? labels.join(" + ") : "-";
}

function trainingModelLabel(settings: WorkspaceSettings): string {
  return settings.training.selectedModel === "omnivoice" ? "OmniVoice" : "GPT-SoVITS";
}

function trainingStatusText(status: string): string {
  switch (status) {
    case "Loaded":
      return "불러옴";
    case "Listing input files":
      return "입력 파일 나열 중";
    case "Loading":
      return "불러오는 중";
    case "Load failed":
      return "불러오기 실패";
    case "Running":
      return "학습 중";
    case "Retrying":
      return "이어하기 중";
    case "Stopping":
      return "중지 중";
    case "Stopped":
      return "중지됨";
    case "Completed":
      return "완료";
    case "Failed":
      return "실패";
    case "Retry completed":
      return "이어하기 완료";
    case "Retry failed":
      return "이어하기 실패";
    default:
      return status || "-";
  }
}

function isVoiceModelWorkspace(workspaceId: WorkspaceId): workspaceId is "training" | "inference" {
  return workspaceId === "training" || workspaceId === "inference";
}

function voiceModelRuntimeSettingsKey(workspaceId: WorkspaceId, settings: WorkspaceSettings): string | undefined {
  if (workspaceId === "training") {
    const selectedModel = settings.training.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return [
      workspaceId,
      selectedModel,
      settings.training.toolRoot.trim(),
      selectedModel === "gpt-sovits" ? settings.training.gptVersion : "",
    ].join("|");
  }

  if (workspaceId === "inference") {
    const selectedModel = settings.inference.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return [
      workspaceId,
      selectedModel,
      settings.inference.toolRoot.trim(),
      selectedModel === "gpt-sovits" ? settings.inference.gptVersion : "",
    ].join("|");
  }

  return undefined;
}

function nextAnimationFrame(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function formatRunError(result: WorkspaceRunResult): string {
  const lines = [result.metadata ? "백엔드 실행이 실패했습니다. 아래 로그 파일을 확인하세요." : result.error || "백엔드 실행이 실패했습니다."];

  if (typeof result.exitCode === "number") {
    lines.push(`종료 코드: ${result.exitCode}`);
  }

  if (result.metadata?.logPath) {
    lines.push(`Electron 로그: ${result.metadata.logPath}`);
  }

  if (result.metadata?.backendLogPath && result.metadata.backendLogPath !== result.metadata.logPath) {
    lines.push(`백엔드 로그: ${result.metadata.backendLogPath}`);
  }

  return Array.from(new Set(lines)).join("\n");
}

function createTerminalStartState(label: string) {
  return {
    text: `[${new Date().toLocaleTimeString()}] ${label}\n콘솔 출력을 기다리는 중입니다.`,
    status: "running" as const,
    updatedAt: new Date().toISOString(),
  };
}

function createTerminalFromUpdate(update: WorkspaceTerminalUpdate, status: WorkspaceTerminalStatus) {
  return terminalStateFromUpdate(
    {
      ...update,
      text: limitTerminalText(update.text),
    },
    status,
  );
}

function createTerminalFromResult(result: WorkspaceRunResult, status: WorkspaceTerminalStatus) {
  const metadata = result.metadata;
  const lines = [
    result.stdout,
    !result.stdout && result.stderr ? result.stderr : "",
    !result.stdout && !result.stderr && result.error ? result.error : "",
  ].filter(Boolean);
  const fallback = metadata
    ? [
        "실행 로그 파일이 준비되었습니다.",
        `Electron 로그: ${metadata.logPath}`,
        metadata.backendLogPath ? `백엔드 로그: ${metadata.backendLogPath}` : "",
      ].filter(Boolean).join("\n")
    : "아직 표시할 터미널 로그가 없습니다.";

  return {
    text: limitTerminalText(lines.join("\n") || fallback),
    status,
    logPath: metadata?.logPath,
    backendLogPath: metadata?.backendLogPath,
    command: metadata?.command,
    updatedAt: new Date().toISOString(),
  };
}

function createTerminalFromEnvironmentInstallResult(result: WorkspaceRuntimeEnvironmentInstallResult) {
  const fallback = result.ok ? "런타임 설치가 완료되었습니다." : result.error ?? "런타임 설치에 실패했습니다.";
  return {
    text: limitTerminalText(result.stdout || result.stderr || fallback),
    status: result.ok ? "completed" as const : result.exitCode === 130 ? "cancelled" as const : "failed" as const,
    logPath: result.logPath,
    backendLogPath: result.logPath,
    command: result.command,
    updatedAt: new Date().toISOString(),
  };
}

function createTerminalFromVoiceModelInstallResult(result: VoiceModelRuntimeInstallResult) {
  const fallback = result.ok ? "모델 설치가 완료되었습니다." : result.error ?? "모델 설치에 실패했습니다.";
  return {
    text: limitTerminalText(result.stdout || result.stderr || fallback),
    status: result.ok ? "completed" as const : result.exitCode === 130 ? "cancelled" as const : "failed" as const,
    logPath: result.logPath,
    backendLogPath: result.logPath,
    command: result.command,
    updatedAt: new Date().toISOString(),
  };
}

function createTerminalFromLogPath(logPath: string | undefined) {
  if (!logPath) {
    return undefined;
  }

  return {
    text: `오디오 변환 로그 파일이 준비되었습니다.\n${logPath}`,
    status: "completed" as const,
    backendLogPath: logPath,
    updatedAt: new Date().toISOString(),
  };
}

function limitTerminalText(text: string): string {
  if (text.length <= TERMINAL_TEXT_LIMIT) {
    return text;
  }

  return `... 이전 로그 생략 ...\n${text.slice(-TERMINAL_TEXT_LIMIT)}`;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? "";
}

function shortName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function formatSecondsCell(value: number): string {
  const minutes = Math.floor(Math.max(0, value) / 60);
  const seconds = Math.max(0, value) % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function createSliceComponentRow(sourceRow: DataTableRow, components: SliceComponent[], id: string, fallbackAudioPath?: string): DataTableRow {
  const sortedComponents = components.slice().sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
  const startSec = Math.min(...sortedComponents.map((component) => component.startSec));
  const endSec = Math.max(...sortedComponents.map((component) => component.endSec));
  const durationSec = Math.max(0, endSec - startSec);
  const originalPath = resolveSliceSourcePath(sourceRow, fallbackAudioPath);
  const fileName = firstNonEmpty(sourceRow.raw?.fileName, sourceRow.raw?.file_name, sourceRow.cells.fileName, shortName(originalPath));
  const markerComponents = serializeSliceComponents(sortedComponents);

  return {
    ...sourceRow,
    id,
    sourcePath: originalPath || sourceRow.sourcePath,
    raw: {
      ...sourceRow.raw,
      fileName,
      file_name: fileName,
      originalPath,
      original_path: originalPath,
      inputPath: originalPath,
      input_path: originalPath,
      absolute_path: originalPath,
      outputPath: "",
      output_path: "",
      startSec: `${startSec}`,
      endSec: `${endSec}`,
      durationSec: `${durationSec}`,
      markerCount: `${sortedComponents.length}`,
      markerComponents,
      marker_components: markerComponents,
      status: "edited",
    },
    cells: {
      ...sourceRow.cells,
      fileName,
      startSec: formatSecondsCell(startSec),
      endSec: formatSecondsCell(endSec),
      durationSec: `${durationSec.toFixed(2)}s`,
      markerCount: `${sortedComponents.length}`,
      status: "edited",
      outputPath: "",
    },
  };
}

function reindexSliceRows(rows: DataTableRow[]): DataTableRow[] {
  const allocateRowId = createSliceRowIdAllocator(rows);
  const usedRowIds = new Set<string>();
  return rows.map((row, index) => {
    const nextIndex = `${index + 1}`;
    const existingId = row.id.trim();
    const id = existingId && !usedRowIds.has(existingId) ? existingId : allocateRowId();
    usedRowIds.add(id);
    return {
      ...row,
      id,
      raw: {
        ...row.raw,
        index: nextIndex,
        chunkIndex: nextIndex,
      },
      cells: {
        ...row.cells,
        index: nextIndex,
      },
    };
  });
}

function createSliceRowIdAllocator(rows: DataTableRow[]): () => string {
  const reservedIds = new Set(rows.map((row) => row.id.trim()).filter(Boolean));
  let nextId = rows
    .map((row) => Number(row.id) || Number(row.raw?.index || row.cells.index))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0) + 1;

  return () => {
    while (reservedIds.has(`${nextId}`)) {
      nextId += 1;
    }

    const id = `${nextId}`;
    reservedIds.add(id);
    nextId += 1;
    return id;
  };
}
