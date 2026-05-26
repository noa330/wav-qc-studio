import { app, type WebContents } from "electron";
import electronUpdater from "electron-updater";
import { IPC_CHANNELS, type AppUpdateState } from "@shared/ipc";

const { autoUpdater } = electronUpdater;

type UpdateInfoLike = {
  version?: string;
  releaseName?: string | null;
  releaseDate?: string | null;
};

type ProgressInfoLike = {
  percent?: number;
  bytesPerSecond?: number;
};

let targetWebContents: WebContents | null = null;
let initialized = false;
let updateState: AppUpdateState = {
  phase: "idle",
  currentVersion: app.getVersion(),
};

function notifyState(next: AppUpdateState): AppUpdateState {
  updateState = next;
  targetWebContents?.send(IPC_CHANNELS.appUpdateStateChanged, updateState);
  return updateState;
}

function setState(patch: Omit<Partial<AppUpdateState>, "currentVersion"> & { phase: AppUpdateState["phase"] }): AppUpdateState {
  return notifyState({
    currentVersion: app.getVersion(),
    ...patch,
  });
}

function updateInfoState(phase: AppUpdateState["phase"], info: UpdateInfoLike): AppUpdateState {
  return setState({
    phase,
    latestVersion: info.version,
    releaseName: info.releaseName ?? undefined,
    releaseDate: info.releaseDate ?? undefined,
    checkedAt: new Date().toISOString(),
  });
}

export function initAppUpdater(webContents: WebContents): void {
  targetWebContents = webContents;

  if (initialized) {
    targetWebContents.send(IPC_CHANNELS.appUpdateStateChanged, updateState);
    return;
  }

  initialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    setState({ phase: "checking", checkedAt: new Date().toISOString() });
  });

  autoUpdater.on("update-not-available", (info: UpdateInfoLike) => {
    updateInfoState("not-available", info);
  });

  autoUpdater.on("update-available", (info: UpdateInfoLike) => {
    updateInfoState("available", info);
  });

  autoUpdater.on("download-progress", (progress: ProgressInfoLike) => {
    setState({
      phase: "downloading",
      latestVersion: updateState.latestVersion,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent ?? 0))),
      bytesPerSecond: progress.bytesPerSecond ?? 0,
      checkedAt: updateState.checkedAt,
      releaseName: updateState.releaseName,
      releaseDate: updateState.releaseDate,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfoLike) => {
    updateInfoState("downloaded", {
      ...info,
      version: info.version ?? updateState.latestVersion,
    });
  });

  autoUpdater.on("error", (error) => {
    setState({
      phase: "error",
      latestVersion: updateState.latestVersion,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  });

  if (app.isPackaged) {
    setTimeout(() => {
      void checkAppUpdate();
    }, 10_000);
  }
}

export function getAppUpdateState(): AppUpdateState {
  return updateState;
}

export async function checkAppUpdate(): Promise<AppUpdateState> {
  if (!app.isPackaged) {
    return setState({
      phase: "idle",
      checkedAt: new Date().toISOString(),
      error: "패키징된 앱에서만 GitHub 릴리즈 업데이트를 확인합니다.",
    });
  }

  try {
    setState({ phase: "checking", checkedAt: new Date().toISOString() });
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return setState({
      phase: "error",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function installAppUpdate(): Promise<AppUpdateState> {
  if (updateState.phase !== "downloaded") {
    return updateState;
  }

  setState({
    phase: "installing",
    latestVersion: updateState.latestVersion,
    checkedAt: updateState.checkedAt,
    releaseName: updateState.releaseName,
    releaseDate: updateState.releaseDate,
  });
  autoUpdater.quitAndInstall();
  return updateState;
}
