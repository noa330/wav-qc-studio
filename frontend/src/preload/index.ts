import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type AppStateSaveRequest, type AudioCropRequest, type AudioEditRequest, type DialogFileSelectionOptions, type FileTreeScanOptions, type StartupSplashProgress, type StudioBackendApi, type TensorBoardSessionRequest, type WorkspaceBatchSpeakerDiarizationRequest, type WorkspaceCancelRequest, type WorkspaceExportProgressEvent, type WorkspaceExportRequest, type WorkspaceLoadRequest, type WorkspaceRunProgressEvent, type WorkspaceRunRequest } from "@shared/ipc";

const studioBackend: StudioBackendApi = {
  getAppInfo: () => ({
    platform: process.platform,
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  }),
  loadAppState: () => ipcRenderer.invoke(IPC_CHANNELS.loadAppState),
  saveAppState: (request: AppStateSaveRequest) => ipcRenderer.invoke(IPC_CHANNELS.saveAppState, request),
  saveAppStateSync: (request: AppStateSaveRequest) => ipcRenderer.sendSync(IPC_CHANNELS.saveAppStateSync, request),
  updateStartupSplash: (progress: StartupSplashProgress) => ipcRenderer.invoke(IPC_CHANNELS.updateStartupSplash, progress),
  completeStartupSplash: () => ipcRenderer.invoke(IPC_CHANNELS.completeStartupSplash),
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectFolder),
  selectFile: (options?: DialogFileSelectionOptions) => ipcRenderer.invoke(IPC_CHANNELS.selectFile, options),
  scanPath: (path: string, options?: FileTreeScanOptions) => ipcRenderer.invoke(IPC_CHANNELS.scanPath, path, options),
  readWaveform: (path: string, bucketCount?: number) => ipcRenderer.invoke(IPC_CHANNELS.readWaveform, path, bucketCount),
  cropWave: (request: AudioCropRequest) => ipcRenderer.invoke(IPC_CHANNELS.cropWave, request),
  editWave: (request: AudioEditRequest) => ipcRenderer.invoke(IPC_CHANNELS.editWave, request),
  loadWorkspace: (request: WorkspaceLoadRequest) => ipcRenderer.invoke(IPC_CHANNELS.loadWorkspace, request),
  runWorkspace: (request: WorkspaceRunRequest) => ipcRenderer.invoke(IPC_CHANNELS.runWorkspace, request),
  listTrainingModels: (request) => ipcRenderer.invoke(IPC_CHANNELS.listTrainingModels, request),
  startTensorBoard: (request: TensorBoardSessionRequest) => ipcRenderer.invoke(IPC_CHANNELS.startTensorBoard, request),
  runBatchSpeakerDiarization: (request: WorkspaceBatchSpeakerDiarizationRequest) => ipcRenderer.invoke(IPC_CHANNELS.runBatchSpeakerDiarization, request),
  onWorkspaceRunProgress: (callback: (event: WorkspaceRunProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WorkspaceRunProgressEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.runWorkspaceProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runWorkspaceProgress, listener);
  },
  exportWorkspace: (request: WorkspaceExportRequest) => ipcRenderer.invoke(IPC_CHANNELS.exportWorkspace, request),
  onWorkspaceExportProgress: (callback: (event: WorkspaceExportProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WorkspaceExportProgressEvent) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.exportWorkspaceProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.exportWorkspaceProgress, listener);
  },
  cancelWorkspace: (request: WorkspaceCancelRequest) => ipcRenderer.invoke(IPC_CHANNELS.cancelWorkspace, request),
};

contextBridge.exposeInMainWorld("studioBackend", studioBackend);

contextBridge.exposeInMainWorld("studioShell", {
  getAppInfo: studioBackend.getAppInfo,
});
