import { app, dialog, ipcMain } from "electron";
import { IPC_CHANNELS, type AppInfo, type AppStateSaveRequest, type AudioCropRequest, type AudioEditRequest, type CreateProjectRequest, type DialogFileSelectionOptions, type FileTreeScanOptions, type TensorBoardSessionRequest, type TrainingModelListRequest, type WorkspaceBatchSpeakerDiarizationRequest, type WorkspaceCancelRequest, type WorkspaceCancelResult, type WorkspaceExportRequest, type WorkspaceExportResult, type WorkspaceLoadRequest, type WorkspaceRunRequest, type WorkspaceRunResult } from "@shared/ipc";
import { createEmptyWorkspaceTable } from "@shared/table-schemas";
import { createStartupSplashSteps, progressForStartupStep } from "@shared/startup-splash";
import { loadAppStateSnapshot, loadProjectStateSnapshot, saveAppStateSnapshot, saveAppStateSnapshotSync } from "../backend/app-state-store";
import { cropWaveFileWithBackup, editWaveFileInCache } from "../backend/audio-crop";
import { scanFileTree } from "../backend/file-tree";
import { listTrainingModels } from "../backend/training-models";
import { cleanupTensorBoardSessions, startTensorBoard } from "../backend/voice-tensorboard";
import { readWaveformData } from "../backend/wav-peaks";
import { createManagedProjectFolder } from "../backend/project-workspaces";
import { exportWorkspace } from "../backend/workspace-exporter";
import { checkWorkspaceRuntimeEnvironment, installWorkspaceRuntimeEnvironment } from "../backend/workspace-runtime-installer";
import { cleanupWorkspaceRunCaches, loadWorkspaceFromPath, resolveWorkspaceOutputPath, runBatchSpeakerDiarization, runWorkspace } from "../backend/workspace-runner";
import { updateStartupSplashProgress } from "../startup-splash-window";

const activeWorkspaceOperations = new Map<string, AbortController>();

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"] as const;
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** unitIndex;
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => ({
    platform: process.platform,
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  }));

  ipcMain.handle(IPC_CHANNELS.loadAppState, async () => {
    const result = await loadAppStateSnapshot((progress) => {
      updateStartupSplashProgress({
        progressPercent: progressForStartupStep("state-file", progress.percent),
        statusText: "저장 상태 파일 읽는 중...",
        detailText: `${formatBytes(progress.bytesRead)} / ${formatBytes(progress.totalBytes)}`,
        steps: createStartupSplashSteps("state-file"),
      });
    });

    if (!result.snapshot) {
      updateStartupSplashProgress({
        progressPercent: progressForStartupStep("state-file", 100),
        statusText: "저장 상태 파일 확인 완료",
        detailText: "복원할 저장 상태가 없어 기본 상태로 시작합니다.",
        steps: createStartupSplashSteps("state-file"),
      });
    }

    return result;
  });

  ipcMain.handle(IPC_CHANNELS.saveAppState, async (_event, request: AppStateSaveRequest) => saveAppStateSnapshot(request));

  ipcMain.on(IPC_CHANNELS.saveAppStateSync, (event, request: AppStateSaveRequest) => {
    event.returnValue = saveAppStateSnapshotSync(request);
  });

  ipcMain.handle(IPC_CHANNELS.createProject, async (_event, request: CreateProjectRequest) => createManagedProjectFolder(request));

  ipcMain.handle(IPC_CHANNELS.loadProjectState, async (_event, request) => loadProjectStateSnapshot(request));

  ipcMain.handle(IPC_CHANNELS.selectFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: "폴더 선택",
      properties: ["openDirectory"],
    });

    return {
      canceled: result.canceled,
      path: result.filePaths[0] ?? null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.selectFile, async (_event, options?: DialogFileSelectionOptions) => {
    const result = await dialog.showOpenDialog({
      title: options?.title ?? "Select file",
      properties: ["openFile"],
      filters: options?.filters,
    });

    return {
      canceled: result.canceled,
      path: result.filePaths[0] ?? null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.scanPath, async (_event, path: string, options?: FileTreeScanOptions) => scanFileTree(path, options));

  ipcMain.handle(IPC_CHANNELS.readWaveform, async (_event, path: string, bucketCount?: number) => readWaveformData(path, bucketCount));

  ipcMain.handle(IPC_CHANNELS.cropWave, async (_event, request: AudioCropRequest) => cropWaveFileWithBackup(request));
  ipcMain.handle(IPC_CHANNELS.editWave, async (_event, request: AudioEditRequest) => editWaveFileInCache(request));

  ipcMain.handle(IPC_CHANNELS.loadWorkspace, async (_event, request: WorkspaceLoadRequest) => {
    const loaded = await loadWorkspaceFromPath(request.workspaceId, request.paths.inputPath, request.paths.outputPath, request.settings, request.paths.projectRoot, (progress) => {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send(IPC_CHANNELS.runWorkspaceProgress, progress);
      }
    });
    const inputTree = loaded.inputTree ?? await scanFileTree(loaded.inputPath, { workspaceId: request.workspaceId, purpose: "input", offset: 0, limit: 50 });
    const outputPath = resolveWorkspaceOutputPath(request.workspaceId, request.paths.inputPath, request.paths.outputPath, request.paths.projectRoot);
    return {
      workspaceId: request.workspaceId,
      inputPath: loaded.inputPath,
      originalInputPath: loaded.originalInputPath,
      table: loaded.table,
      details: loaded.details,
      inputTree,
      outputTree: undefined,
      outputPath,
      audioSourceMapPath: loaded.audioSourceMapPath,
      logPath: loaded.logPath,
    };
  });

  ipcMain.handle(IPC_CHANNELS.runWorkspace, async (event, request: WorkspaceRunRequest): Promise<WorkspaceRunResult> => {
    const controller = registerWorkspaceOperation(request.workspaceId, "batchSpeaker");
    try {
      return await runWorkspace(request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.runWorkspaceProgress, progress);
        }
      }, controller.signal);
    } catch (error) {
      return {
        ok: false,
        workspaceId: request.workspaceId,
        error: error instanceof Error ? error.message : String(error),
        table: createEmptyWorkspaceTable(request.workspaceId),
        details: [{ label: "오류", value: error instanceof Error ? error.message : String(error) }],
      };
    } finally {
      unregisterWorkspaceOperation(request.workspaceId, "batchSpeaker", controller);
    }
  });

  ipcMain.handle(IPC_CHANNELS.checkWorkspaceRuntime, async (_event, request) => checkWorkspaceRuntimeEnvironment(request.workspaceId));

  ipcMain.handle(IPC_CHANNELS.installWorkspaceRuntime, async (event, request) => {
    const controller = registerWorkspaceOperation(request.workspaceId, "runtimeInstall");
    try {
      return await installWorkspaceRuntimeEnvironment(request.workspaceId, (terminal) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.runWorkspaceProgress, {
            workspaceId: request.workspaceId,
            table: createEmptyWorkspaceTable(request.workspaceId),
            details: [{ label: "Runtime", value: "Installing" }],
            progress: { total: 0, completed: 0, failed: 0, percent: 0 },
            terminal,
          });
        }
      }, controller.signal);
    } finally {
      unregisterWorkspaceOperation(request.workspaceId, "runtimeInstall", controller);
    }
  });

  ipcMain.handle(IPC_CHANNELS.listTrainingModels, async (_event, request: TrainingModelListRequest) => listTrainingModels(request));

  ipcMain.handle(IPC_CHANNELS.startTensorBoard, async (_event, request: TensorBoardSessionRequest) => startTensorBoard(request));

  ipcMain.handle(IPC_CHANNELS.runBatchSpeakerDiarization, async (event, request: WorkspaceBatchSpeakerDiarizationRequest): Promise<WorkspaceRunResult> => {
    const controller = registerWorkspaceOperation(request.workspaceId, "run");
    try {
      return await runBatchSpeakerDiarization(request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.runWorkspaceProgress, progress);
        }
      }, controller.signal);
    } catch (error) {
      return {
        ok: false,
        workspaceId: request.workspaceId,
        error: error instanceof Error ? error.message : String(error),
        table: request.table,
        details: [{ label: "오류", value: error instanceof Error ? error.message : String(error) }],
      };
    } finally {
      unregisterWorkspaceOperation(request.workspaceId, "run", controller);
    }
  });

  ipcMain.handle(IPC_CHANNELS.exportWorkspace, async (event, request: WorkspaceExportRequest): Promise<WorkspaceExportResult> => {
    const controller = registerWorkspaceOperation(request.workspaceId, "export");
    try {
      return await exportWorkspace(request, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.exportWorkspaceProgress, progress);
        }
      }, controller.signal);
    } catch (error) {
      return {
        ok: false,
        workspaceId: request.workspaceId,
        error: error instanceof Error ? error.message : String(error),
        table: createEmptyWorkspaceTable(request.workspaceId),
        details: [{ label: "오류", value: error instanceof Error ? error.message : String(error) }],
      };
    } finally {
      unregisterWorkspaceOperation(request.workspaceId, "export", controller);
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelWorkspace, async (_event, request: WorkspaceCancelRequest): Promise<WorkspaceCancelResult> => {
    if (request.operation) {
      cancelWorkspaceOperation(request.workspaceId, request.operation);
    } else {
      cancelWorkspaceOperation(request.workspaceId, "run");
      cancelWorkspaceOperation(request.workspaceId, "export");
      cancelWorkspaceOperation(request.workspaceId, "batchSpeaker");
      cancelWorkspaceOperation(request.workspaceId, "runtimeInstall");
    }
    return {
      ok: true,
      workspaceId: request.workspaceId,
    };
  });

  app.on("will-quit", () => {
    cleanupWorkspaceRunCaches();
    cleanupTensorBoardSessions();
    ipcMain.removeHandler(IPC_CHANNELS.appInfo);
    ipcMain.removeHandler(IPC_CHANNELS.loadAppState);
    ipcMain.removeHandler(IPC_CHANNELS.saveAppState);
    ipcMain.removeAllListeners(IPC_CHANNELS.saveAppStateSync);
    ipcMain.removeHandler(IPC_CHANNELS.createProject);
    ipcMain.removeHandler(IPC_CHANNELS.loadProjectState);
    ipcMain.removeHandler(IPC_CHANNELS.selectFolder);
    ipcMain.removeHandler(IPC_CHANNELS.selectFile);
    ipcMain.removeHandler(IPC_CHANNELS.scanPath);
    ipcMain.removeHandler(IPC_CHANNELS.readWaveform);
    ipcMain.removeHandler(IPC_CHANNELS.cropWave);
    ipcMain.removeHandler(IPC_CHANNELS.editWave);
    ipcMain.removeHandler(IPC_CHANNELS.loadWorkspace);
    ipcMain.removeHandler(IPC_CHANNELS.runWorkspace);
    ipcMain.removeHandler(IPC_CHANNELS.checkWorkspaceRuntime);
    ipcMain.removeHandler(IPC_CHANNELS.installWorkspaceRuntime);
    ipcMain.removeHandler(IPC_CHANNELS.listTrainingModels);
    ipcMain.removeHandler(IPC_CHANNELS.startTensorBoard);
    ipcMain.removeHandler(IPC_CHANNELS.runBatchSpeakerDiarization);
    ipcMain.removeHandler(IPC_CHANNELS.exportWorkspace);
    ipcMain.removeHandler(IPC_CHANNELS.cancelWorkspace);
  });
}

type WorkspaceOperation = "run" | "export" | "batchSpeaker" | "runtimeInstall";

function operationKey(workspaceId: string, operation: WorkspaceOperation): string {
  return `${workspaceId}:${operation}`;
}

function registerWorkspaceOperation(workspaceId: string, operation: WorkspaceOperation): AbortController {
  cancelWorkspaceOperation(workspaceId, operation);
  const controller = new AbortController();
  activeWorkspaceOperations.set(operationKey(workspaceId, operation), controller);
  return controller;
}

function unregisterWorkspaceOperation(workspaceId: string, operation: WorkspaceOperation, controller: AbortController): void {
  const key = operationKey(workspaceId, operation);
  if (activeWorkspaceOperations.get(key) === controller) {
    activeWorkspaceOperations.delete(key);
  }
}

function cancelWorkspaceOperation(workspaceId: string, operation: WorkspaceOperation): void {
  const controller = activeWorkspaceOperations.get(operationKey(workspaceId, operation));
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
}
