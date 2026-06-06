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
  TrainingModelSummary,
  VoiceModelRuntimeStatus,
  WorkspaceExportProgressEvent,
  WorkspaceExportResult,
  WorkspaceId,
  WorkspaceRunProgressEvent,
  WorkspaceRunResult,
  WorkspaceSettings,
  WorkspaceRuntimeEnvironmentStatus,
} from "@shared/ipc";
import type { ScrollWindowMetrics } from "@shared/scroll-window";
import { useAppPersistence, type PersistedRuntimeSnapshot } from "@/app/app-persistence";
import { createEmptyWorkspaceTable } from "@shared/table-schemas";
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
} from "../model/workspace-runtime-selection";
import {
  numberFromSliceRow,
  partitionSliceComponents,
  readSliceComponents,
  readSliceRowBounds,
  retimeSliceComponents,
  serializeSliceComponents,
  splitSingleSliceComponent,
} from "../model/slice-segments";
import {
  activeSheet,
  createInitialRuntimeStore,
  createWorkspaceResultSheet,
  nextSheetLabel,
  resultSheetHasRows,
  stateWithActiveSheet,
  updateActiveSheet,
  workspaceRuntimeReducer,
  type WorkspaceRuntimeState,
} from "./workspace-runtime-store";
import { createSliceComponentRow, createSliceRowIdAllocator, reindexSliceRows } from "./runtime/slice-table-rows";
import {
  createTerminalFromEnvironmentInstallResult,
  createTerminalFromLogPath,
  createTerminalFromResult,
  createTerminalFromUpdate,
  createTerminalFromVoiceModelInstallResult,
  createTerminalStartState,
  firstNonEmpty,
  formatSecondsCell,
  shortName,
} from "./runtime/terminal-state";
import {
  applyTrainingIdentityToSettings,
  createTrainingTableForModel,
  findTrainingModelByName,
  findTrainingSheetByIdentity,
  hasNewTrainingRows,
  mergeTrainingRows,
  resolveTrainingIdentityFromSheet,
  sameGptSovitsWatchTarget,
  settingsWithTrainingSheet,
  trainingCheckpointRows,
  trainingIdentityFromSettings,
  trainingModelMatchesIdentity,
  trainingSheetMatchesIdentity,
  withTrainingTableModel,
} from "./runtime/training-tables";
import {
  buildMetrics,
  formatRunError,
  isVoiceModelWorkspace,
  nextAnimationFrame,
  voiceModelRuntimeSettingsKey,
} from "./runtime/workspace-runtime-status";
import {
  buildExportTable,
  buildRetryPlan,
  buildTableSelectionPatch,
  cloneRow,
  filterTableBySearch,
  isAudioConversionStatusTree,
  mergeRetryTables,
  normalizeBatchQcStatus,
  normalizeRetryTable,
  pasteRowsIntoTable,
  resolveFileBrowserWindow,
  sheetCanRetry,
  toggleSelectedRowId,
} from "./runtime/workspace-runtime-table-ops";
import { useSliceSegmentActions } from "./runtime/slice-segment-actions";
import { useTrainingCheckpointSync } from "./runtime/training-checkpoint-sync";

export type { WorkspaceRuntimeState } from "./workspace-runtime-store";

export type WorkspaceRuntime = {
  guideMode?: {
    activeStepId: string;
    focusPanelId?: string;
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
  selectInferenceDatasetFile: () => Promise<void>;
  setInferenceMultiReferenceOpen: (open: boolean) => void;
  removeInferenceAuxReferenceAudio: (path: string) => void;
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
  mergeEnabledBatchSpeakers: (speakerNames?: string[]) => void;
  renameBatchSpeaker: (oldName: string, newName: string) => void;
  runSelectedSpeakersDiarization: (selectedSpeakerNames: string[]) => Promise<void>;
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

      if (progress.workspaceId === "inference" && progress.activeAudioPath) {
        const activeAudioPath = progress.activeAudioPath;
        setSettings((current) => {
          const referenceText = progress.referenceText ?? current.inference.referenceText;
          const outputText = progress.outputText ?? current.inference.outputText;
          return {
            ...current,
            inference: {
              ...current.inference,
              referenceAudioPath: activeAudioPath,
              referenceText,
              outputText,
              referenceTextsByAudioPath: referenceText.trim()
                ? { ...current.inference.referenceTextsByAudioPath, [activeAudioPath]: referenceText }
                : current.inference.referenceTextsByAudioPath,
            },
          };
        });
      }

      if (progress.table.rows.length === 0 && !runSession?.baseTable?.rows.length) {
        const activePatch = inferenceActiveSelectionPatch(progress, state);
        if (activePatch) {
          updateSheetState(progress.workspaceId, activePatch);
        }
        updateState(progress.workspaceId, {
          progressPercent: progress.progress.percent,
          progress: progress.progress,
          statusText: progress.workspaceId === "batch" && state.isBatchSpeakerRunning ? "화자 분리 중" : "Running",
          browserPreferredSection: "input",
          ...activePatch,
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
      const activePatch = inferenceActiveSelectionPatch(progress, selectionState);
      const patch = {
        table,
        details: selection.details.length > 0 ? selection.details : progress.details,
        selectedRowId: selection.selectedRowId,
        selectedRowIds: selection.selectedRowIds,
        selectedFilePath: selection.selectedFilePath,
        selectedAudioPath: selection.selectedAudioPath,
        selectedResultAudioPath: selection.selectedResultAudioPath,
        ...activePatch,
      };
      if (targetSheetId) {
        updateSheetByIdState(progress.workspaceId, targetSheetId, patch);
      } else {
        updateSheetState(progress.workspaceId, patch);
      }
      updateState(progress.workspaceId, {
        progressPercent: progress.progress.percent,
        progress: progress.progress,
        statusText: progress.workspaceId === "batch" && state.isBatchSpeakerRunning ? "화자 분리 중" : "Running",
        browserPreferredSection: "input",
        ...activePatch,
        ...(progress.inputTree ? { inputTree: progress.inputTree } : {}),
        ...(progress.terminal ? { terminal: createTerminalFromUpdate(progress.terminal, "running") } : {}),
      });
    },
    [setSettings, updateSheetByIdState, updateSheetState, updateState],
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
        if (workspaceId === "inference") {
          const datasetReferenceTexts = collectDatasetReferenceTexts(loaded.inputTree);
          setSettings((current) => ({
            ...current,
            inference: {
              ...current.inference,
              referenceAudioPath: fallbackAudioPath || current.inference.referenceAudioPath,
              referenceText: fallbackAudioPath
                ? datasetReferenceTexts[fallbackAudioPath] || current.inference.referenceTextsByAudioPath[fallbackAudioPath] || current.inference.referenceText
                : current.inference.referenceText,
              referenceTextsByAudioPath: {
                ...current.inference.referenceTextsByAudioPath,
                ...datasetReferenceTexts,
              },
              batchReferenceAudioPaths: current.inference.inferenceRunMode === "batch" && fallbackAudioPath ? [fallbackAudioPath] : [],
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

      if (workspaceId === "inference") {
        const selected = await studioBackend.selectFolder();
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

  const selectInferenceDatasetFile = useCallback(
    async () => {
      const selected = await studioBackend.selectFile({
        title: "추론 데이터셋 선택",
        filters: [{ name: "추론 데이터셋", extensions: ["list", "jsonl", "json"] }],
      });
      if (selected.canceled || !selected.path) {
        return;
      }

      await loadWorkspace("inference", selected.path, statesRef.current.inference.outputPath);
    },
    [loadWorkspace],
  );

  const setInferenceMultiReferenceOpen = useCallback(
    (open: boolean) => {
      updateSheetState("inference", { inferenceMultiReferenceOpen: open });
    },
    [updateSheetState],
  );

  const removeInferenceAuxReferenceAudio = useCallback(
    (path: string) => {
      updateSheetState("inference", {
        inferenceAuxReferenceAudioPaths: removePath(statesRef.current.inference.inferenceAuxReferenceAudioPaths, path),
      });
    },
    [updateSheetState],
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
      statusText: "화자 분리 중지 중",
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
      if (workspaceId === "inference" && state.inferenceMultiReferenceOpen && settingsRef.current.inference.selectedModel === "gpt-sovits" && audioSelection.selectedAudioPath) {
        updateSheetState("inference", {
          inferenceAuxReferenceAudioPaths: addPath(state.inferenceAuxReferenceAudioPaths, audioSelection.selectedAudioPath),
          reviewedFilePaths: addReviewedSelectionPaths(state.reviewedFilePaths, matchingRow, node.path, audioSelection.selectedFilePath, audioSelection.selectedAudioPath),
        });
        return;
      }

      updateSheetState(workspaceId, {
        selectedFilePath: audioSelection.selectedFilePath ?? node.path,
        selectedRowId: matchingRow?.id,
        selectedRowIds: matchingRow ? [matchingRow.id] : [],
        selectedAudioPath: audioSelection.selectedAudioPath,
        selectedResultAudioPath: audioSelection.selectedResultAudioPath,
        reviewedFilePaths: addReviewedSelectionPaths(state.reviewedFilePaths, matchingRow, node.path, audioSelection.selectedFilePath, audioSelection.selectedAudioPath),
        tableRevealRequestId: matchingRow ? state.tableRevealRequestId + 1 : state.tableRevealRequestId,
        details: matchingRow ? state.table.columns.map((column) => ({ label: column.label, value: matchingRow.cells[column.key] || "" })) : state.details,
      });
      if (workspaceId === "inference" && audioSelection.selectedAudioPath) {
        const audioPath = audioSelection.selectedAudioPath;
        const datasetText = datasetTextForNode(node) || findDatasetReferenceText(state.inputTree, audioPath);
        setSettings((current) => {
          const savedText = current.inference.referenceTextsByAudioPath[audioPath] ?? "";
          const referenceText = datasetText || savedText;
          return {
            ...current,
            inference: {
              ...current.inference,
              referenceAudioPath: audioPath,
              referenceText,
              referenceTextsByAudioPath: referenceText
                ? { ...current.inference.referenceTextsByAudioPath, [audioPath]: referenceText }
                : current.inference.referenceTextsByAudioPath,
            },
          };
        });
      }
    },
    [setSettings, updateSheetState],
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
        reviewedFilePaths: addReviewedSelectionPaths(state.reviewedFilePaths, row, audioSelection.selectedFilePath, audioSelection.selectedAudioPath),
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
        reviewedFilePaths: selectedRows.reduce(
          (paths, row) => addReviewedSelectionPaths(paths, row),
          addReviewedSelectionPaths(state.reviewedFilePaths, selectedRow, audioSelection.selectedFilePath, audioSelection.selectedAudioPath),
        ),
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
        reviewedFilePaths: addReviewedSelectionPaths(state.reviewedFilePaths, nextRow, audioSelection.selectedFilePath, audioSelection.selectedAudioPath),
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

  const mergeEnabledBatchSpeakers = useCallback((speakerNames?: string[]) => {
    const state = statesRef.current.batch;
    const speakers = speakerNames ?? collectBatchSpeakers(state.table.rows).filter((speaker) => state.batchSpeakerChecks[speaker] !== false);
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
    updateState("batch", { statusText: "화자 병합 완료" });
    setSettings((current) => ({
      ...current,
      batch: {
        ...current.batch,
        jobs: buildBatchJobs({ ...state.table, rows: nextRows }),
      },
    }));
  }, [setSettings, updateSheetState, updateState]);

  const renameBatchSpeaker = useCallback((oldName: string, newName: string) => {
    const state = statesRef.current.batch;
    const cleanOldName = oldName.trim();
    const cleanNewName = newName.trim();
    if (!cleanOldName || !cleanNewName || cleanOldName === cleanNewName) {
      return;
    }

    const nextRows = state.table.rows.map((row) => {
      const currentSpeaker = row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "";
      if (currentSpeaker !== cleanOldName) {
        return row;
      }

      return {
        ...row,
        raw: {
          ...row.raw,
          speaker: cleanNewName,
          speaker_groups: cleanNewName,
        },
        cells: {
          ...row.cells,
          speaker: cleanNewName,
        },
      };
    });

    const selectedRow = nextRows.find((row) => row.id === state.selectedRowId);
    const nextSpeakers = collectBatchSpeakers(nextRows);

    updateSheetState("batch", {
      table: {
        ...state.table,
        rows: nextRows,
      },
      batchSpeakerChecks: {
        ...Object.fromEntries(nextSpeakers.map((speaker) => [speaker, state.batchSpeakerChecks[speaker] !== false])),
        [cleanNewName]: state.batchSpeakerChecks[cleanOldName] !== false,
      },
      details: selectedRow ? state.table.columns.map((column) => ({ label: column.label, value: selectedRow.cells[column.key] || "" })) : state.details,
    });

    setSettings((current) => ({
      ...current,
      batch: {
        ...current.batch,
        jobs: buildBatchJobs({ ...state.table, rows: nextRows }),
      },
    }));
  }, [setSettings, updateSheetState]);

  const runSelectedSpeakersDiarization = useCallback(async (selectedSpeakerNames: string[]) => {
    const workspaceId: WorkspaceId = "batch";
    const state = statesRef.current.batch;
    const sheet = activeSheet(state);
    const settings = settingsRef.current;
    if (!sheet || !state.inputPath || state.table.rows.length === 0 || state.isRunning || state.isExporting || state.isBatchSpeakerRunning || selectedSpeakerNames.length === 0) {
      return;
    }

    const speakerSet = new Set(selectedSpeakerNames);
    const filteredRows = state.table.rows.filter((row) => {
      const spk = row.raw?.speaker || row.raw?.speaker_groups || row.cells.speaker || "";
      return speakerSet.has(spk);
    });

    if (filteredRows.length === 0) {
      return;
    }

    updateState(workspaceId, {
      isBatchSpeakerRunning: true,
      statusText: "화자 분리 중",
      progressPercent: 0,
      progress: undefined,
      error: undefined,
      terminal: createTerminalStartState("선택 화자 재분리 시작"),
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
        table: {
          ...state.table,
          rows: filteredRows,
        },
      });
    } catch (error) {
      delete activeRunSessionRef.current[workspaceId];
      updateState(workspaceId, {
        isBatchSpeakerRunning: false,
        statusText: "화자 분리 실패",
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

    // Merge result rows back into the latestState table rows
    const originalRows = latestState.table.rows;
    const updatedRowsMap = new Map(result.table.rows.map((r) => [r.id, r]));
    const mergedRows = originalRows.map((row) => {
      const updated = updatedRowsMap.get(row.id);
      return updated ? updated : row;
    });
    const mergedTable = {
      ...latestState.table,
      rows: mergedRows,
    };

    const selectionState = stateWithActiveSheet(latestState, latestSheet);
    const selection = buildTableSelectionPatch(workspaceId, mergedTable, selectionState, selectionState.selectedAudioPath || findFirstAudioPath(result.inputTree ?? latestState.inputTree));
    const nextBatchSpeakerChecks = Object.fromEntries(collectBatchSpeakers(mergedTable.rows).map((speaker) => [speaker, latestState.batchSpeakerChecks[speaker] !== false]));
    const finalStatusText = result.cancelled ? "Stopped" : result.ok ? "화자 분리 완료" : "화자 분리 실패";
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
      table: mergedTable,
      details: selection.details.length > 0 ? selection.details : result.details,
      selectedRowId: selection.selectedRowId,
      selectedRowIds: selection.selectedRowIds,
      selectedFilePath: selection.selectedFilePath,
      selectedAudioPath: selection.selectedAudioPath,
      selectedResultAudioPath: selection.selectedResultAudioPath,
      browserPreferredSection: "input",
      batchSpeakerChecks: nextBatchSpeakerChecks,
      lastRun: { ...result, table: mergedTable },
    });
    setSettings((current) => ({
      ...current,
      batch: {
        ...current.batch,
        jobs: buildBatchJobs(mergedTable),
      },
    }));
  }, [createWorkspacePaths, setSettings, updateSheetByIdState, updateState]);

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
      statusText: "화자 분리 중",
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
        statusText: "화자 분리 실패",
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
    const finalStatusText = result.cancelled ? "Stopped" : result.ok ? "화자 분리 완료" : "화자 분리 실패";
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

  const {
    splitOrUnmergeSliceSegment,
    mergeSliceSegments,
    addSliceSegment,
    deleteSliceSegment,
    updateSliceSegmentBounds,
  } = useSliceSegmentActions({ statesRef, updateSheetState, updateState });
  const syncTrainingModelCheckpoints = useTrainingCheckpointSync({
    statesRef,
    settingsRef,
    setSettings,
    replaceState,
    updateSheetByIdState,
    updateState,
  });
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

      const inferenceRunAudioPaths = workspaceId === "inference" ? resolveInferenceRunAudioPaths(settings.inference, state) : [];
      const inferredInferenceRunMode: WorkspaceSettings["inference"]["inferenceRunMode"] = workspaceId === "inference" && inferenceRunAudioPaths.length >= 2 ? "batch" : "single";
      const inferenceAuxReferenceAudioPaths = workspaceId === "inference" && settings.inference.selectedModel === "gpt-sovits"
        ? state.inferenceAuxReferenceAudioPaths
        : [];
      const emptyTable = workspaceId === "training"
        ? createTrainingTableForModel(settings.training.selectedModel)
        : createEmptyWorkspaceTable(workspaceId);
      const fallbackAudioPath = workspaceId === "inference" ? inferenceRunAudioPaths[0] || state.selectedAudioPath || findFirstAudioPath(state.inputTree) : findFirstAudioPath(state.inputTree);
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
        inferenceMultiReferenceOpen: false,
        inferenceAuxReferenceAudioPaths,
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
              inferenceRunMode: inferredInferenceRunMode,
              referenceAudioPath: inferenceRunAudioPaths[0] || state.selectedAudioPath || settings.inference.referenceAudioPath,
              referenceText: inferenceRunAudioPaths[0]
                ? settings.inference.referenceTextsByAudioPath[inferenceRunAudioPaths[0]] ?? settings.inference.referenceText
                : settings.inference.referenceText,
              gptAuxReferenceAudioPaths: inferenceAuxReferenceAudioPaths,
              batchReferenceAudioPaths: inferredInferenceRunMode === "batch"
                ? inferenceRunAudioPaths
                : settings.inference.batchReferenceAudioPaths,
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
      selectInferenceDatasetFile,
      setInferenceMultiReferenceOpen,
      removeInferenceAuxReferenceAudio,
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
      renameBatchSpeaker,
      runSelectedSpeakersDiarization,
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
    [
      addSliceSegment,
      cancelBatchSpeakerDiarization,
      cancelWorkspace,
      checkRuntimeEnvironment,
      checkVoiceModelRuntime,
      clearError,
      clearTerminal,
      copyRows,
      createSheet,
      deleteSheet,
      deleteSliceSegment,
      editBatchCell,
      exportWorkspace,
      getMetrics,
      getTable,
      installRuntimeEnvironment,
      installVoiceModelRuntime,
      loadFileBrowserWindow,
      mergeEnabledBatchSpeakers,
      mergeSliceSegments,
      overviewFilter,
      pasteRows,
      retry,
      rowsClipboard,
      run,
      runBatchSpeakerDiarization,
      runSelectedSpeakersDiarization,
      runtimeEnvironmentInstalling,
      runtimeEnvironmentStatuses,
      selectAdjacentRow,
      selectFileNode,
      selectInputFolder,
      selectInferenceDatasetFile,
      setInferenceMultiReferenceOpen,
      removeInferenceAuxReferenceAudio,
      selectOutputFolder,
      selectRow,
      selectRows,
      selectSheet,
      setAllRowExportChecks,
      setBatchFilter,
      setRowsExportChecks,
      setTableSearch,
      settings,
      splitOrUnmergeSliceSegment,
      states,
      syncTrainingModelCheckpoints,
      tagScoreRules,
      toggleBatchSpeaker,
      renameBatchSpeaker,
      toggleRowExportCheck,
      updateSliceSegmentBounds,
      voiceModelRuntimeInstalling,
      voiceModelRuntimeStatuses,
    ],
  );
}

function collectDatasetReferenceTexts(tree: FileTreeResult | undefined): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      const text = datasetTextForNode(node);
      if (node.kind === "file" && text) {
        entries.push([node.path, text]);
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(tree?.nodes ?? []);
  return Object.fromEntries(entries);
}

function inferenceActiveSelectionPatch(progress: WorkspaceRunProgressEvent, state: Pick<WorkspaceRuntimeState, "selectedAudioPath" | "browserRevealRequestId">): Partial<WorkspaceRuntimeState> | undefined {
  if (progress.workspaceId !== "inference" || !progress.activeAudioPath) {
    return undefined;
  }

  const changed = normalizeReferenceAudioPath(progress.activeAudioPath) !== normalizeReferenceAudioPath(state.selectedAudioPath);
  return {
    selectedFilePath: progress.activeAudioPath,
    selectedAudioPath: progress.activeAudioPath,
    browserPreferredSection: "input",
    browserRevealRequestId: changed ? state.browserRevealRequestId + 1 : state.browserRevealRequestId,
  };
}

function resolveInferenceRunAudioPaths(settings: WorkspaceSettings["inference"], state: WorkspaceRuntimeState): string[] {
  const requestedPaths = settings.batchReferenceAudioPaths.length > 0
    ? settings.batchReferenceAudioPaths
    : [state.selectedAudioPath || settings.referenceAudioPath || findFirstAudioPath(state.inputTree)];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of requestedPaths) {
    const normalized = path.trim();
    const key = normalizeReferenceAudioPath(normalized);
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(normalized);
  }
  return paths;
}

function addPath(paths: string[], path: string): string[] {
  const normalizedPath = normalizeReferenceAudioPath(path);
  if (!normalizedPath || paths.some((item) => normalizeReferenceAudioPath(item) === normalizedPath)) {
    return paths;
  }
  return [...paths, path];
}

function addReviewedSelectionPaths(paths: string[], row?: DataTableRow, ...selectedPaths: Array<string | undefined>): string[] {
  const raw = row?.raw ?? {};
  return [
    ...selectedPaths,
    row?.sourcePath,
    raw.originalPath,
    raw.original_path,
    raw.absolute_path,
    raw.inputPath,
    raw.input_path,
    raw.cachedPath,
    raw.cached_path,
    raw.outputPath,
    raw.outputAudioPath,
    raw.output_audio_path,
    raw.referenceAudioPath,
    raw.reference_audio_path,
  ].reduce((reviewedPaths, path) => path ? addPath(reviewedPaths, path) : reviewedPaths, paths);
}

function removePath(paths: string[], path: string): string[] {
  const normalizedPath = normalizeReferenceAudioPath(path);
  return paths.filter((item) => normalizeReferenceAudioPath(item) !== normalizedPath);
}

function findDatasetReferenceText(tree: FileTreeResult | undefined, audioPath: string): string {
  const target = normalizeReferenceAudioPath(audioPath);
  let found = "";
  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (found) {
        return;
      }
      if (normalizeReferenceAudioPath(node.path) === target) {
        found = datasetTextForNode(node);
        return;
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(tree?.nodes ?? []);
  return found;
}

function datasetTextForNode(node: FileTreeNode): string {
  return node.dataset?.text?.trim() ?? "";
}

function normalizeReferenceAudioPath(path: string | undefined): string {
  return (path ?? "").replace(/\\/gu, "/").toLowerCase();
}
