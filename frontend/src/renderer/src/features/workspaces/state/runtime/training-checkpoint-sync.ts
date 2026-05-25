import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createEmptyWorkspaceTable } from "@shared/table-schemas";
import type { TrainingModelSummary, WorkspaceSettings } from "@shared/ipc";
import { studioBackend } from "@/services/studio-backend";
import { settingsWithGptSovitsAutoCheckpoints } from "../../model/voice-training-checkpoints";
import {
  activeSheet,
  createWorkspaceResultSheet,
  nextSheetLabel,
  resultSheetHasRows,
  stateWithActiveSheet,
  updateActiveSheet,
  type WorkspaceRuntimeState,
  type WorkspaceRuntimeStore,
} from "../workspace-runtime-store";
import {
  createTrainingTableForModel,
  findTrainingModelByName,
  findTrainingSheetByIdentity,
  hasNewTrainingRows,
  mergeTrainingRows,
  sameGptSovitsWatchTarget,
  trainingCheckpointRows,
  trainingIdentityFromSettings,
  trainingModelMatchesIdentity,
  trainingSheetMatchesIdentity,
  withTrainingTableModel,
} from "./training-tables";
import { buildTableSelectionPatch } from "./workspace-runtime-table-ops";


const GPT_SOVITS_CHECKPOINT_POLL_MS = 2500;

type TrainingCheckpointSyncDeps = {
  statesRef: MutableRefObject<WorkspaceRuntimeStore>;
  settingsRef: MutableRefObject<WorkspaceSettings>;
  setSettings: Dispatch<SetStateAction<WorkspaceSettings>>;
  replaceState: (workspaceId: "training", state: WorkspaceRuntimeState) => void;
  updateSheetByIdState: (workspaceId: "training", sheetId: string, patch: Parameters<typeof updateActiveSheet>[1], activate?: boolean) => void;
  updateState: (workspaceId: "training", patch: Partial<WorkspaceRuntimeState>) => void;
};

export function useTrainingCheckpointSync({ statesRef, settingsRef, setSettings, replaceState, updateSheetByIdState, updateState }: TrainingCheckpointSyncDeps) {
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

  return syncTrainingModelCheckpoints;
}