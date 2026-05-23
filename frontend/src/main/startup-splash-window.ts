import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS, type StartupSplashProgress, type StartupSplashResult } from "@shared/ipc";
import { createStartupSplashSteps, startupSplashFullRevealAnimationMs } from "@shared/startup-splash";

const minimumVisibleMs = 2000;
const closeFadeMs = 180;
const progressEventName = "wavqc-startup-progress";
const closeEventName = "wavqc-startup-close";
const splashWindowWidthRatio = 0.34;
const splashWindowHeightRatio = 0.52;
const splashWindowMinWidth = 520;
const splashWindowMaxWidth = 660;
const splashWindowMinHeight = 460;
const splashWindowMaxHeight = 560;

const defaultProgress: StartupSplashProgress = {
  progressPercent: 0,
  statusText: "WAV QC Studio 시작 중...",
  detailText: "저장 상태 파일을 확인하고 있습니다.",
  steps: createStartupSplashSteps("state-file"),
};

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let splashLoaded = false;
let splashShownAt = 0;
let mainWindowReady = false;
let rendererReady = false;
let startupCompleted = false;
let finishingStartup = false;
let finishTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let ipcRegistered = false;
let currentProgress: StartupSplashProgress = defaultProgress;
let startupCompletionAnimationWaitMs = 0;

export function createStartupSplashWindow(): BrowserWindow | null {
  if (startupCompleted) {
    return null;
  }

  resetStartupSplashState();
  const splashBounds = getStartupSplashWindowBounds();

  splashWindow = new BrowserWindow({
    width: splashBounds.width,
    height: splashBounds.height,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "WAV QC Studio",
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.setMenuBarVisibility(false);
  splashWindow.setAlwaysOnTop(true, "floating");

  splashWindow.once("ready-to-show", () => {
    if (!splashWindow || splashWindow.isDestroyed()) {
      return;
    }

    splashShownAt = Date.now();
    splashWindow.showInactive();
    publishStartupProgress(currentProgress);
    finishStartupWhenReady();
  });

  splashWindow.webContents.once("did-finish-load", () => {
    splashLoaded = true;
    publishStartupProgress(currentProgress);
  });

  splashWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
    splashLoaded = false;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void splashWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/startup-splash.html?appVersion=${encodeURIComponent(app.getVersion())}`);
  } else {
    void splashWindow.loadFile(join(__dirname, "../renderer/startup-splash.html"), {
      query: {
        appVersion: app.getVersion(),
      },
    });
  }

  return splashWindow;
}

function getStartupSplashWindowBounds(): { width: number; height: number } {
  const { workAreaSize } = screen.getPrimaryDisplay();

  return {
    width: clampValue(Math.round(workAreaSize.width * splashWindowWidthRatio), splashWindowMinWidth, splashWindowMaxWidth),
    height: clampValue(Math.round(workAreaSize.height * splashWindowHeightRatio), splashWindowMinHeight, splashWindowMaxHeight),
  };
}

export function attachStartupMainWindow(window: BrowserWindow): void {
  mainWindow = window;
  mainWindowReady = false;

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }

    if (!startupCompleted) {
      closeStartupSplashWindow();
    }
  });
}

export function markStartupMainWindowReady(): void {
  mainWindowReady = true;
  finishStartupWhenReady();
}

export function registerStartupSplashIpc(): void {
  if (ipcRegistered) {
    return;
  }

  ipcRegistered = true;

  ipcMain.handle(IPC_CHANNELS.updateStartupSplash, (_event, progress: StartupSplashProgress): StartupSplashResult => {
    publishStartupProgress(progress);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.completeStartupSplash, (): StartupSplashResult => {
    rendererReady = true;
    startupCompletionAnimationWaitMs = startupSplashFullRevealAnimationMs;
    publishStartupProgress({
      progressPercent: 100,
      statusText: "초기 화면 준비 완료",
      detailText: "앱 화면을 표시할 준비가 끝났습니다.",
      steps: createStartupSplashSteps(),
    });
    finishStartupWhenReady();
    return { ok: true };
  });

  app.once("will-quit", unregisterStartupSplashIpc);
}

function unregisterStartupSplashIpc(): void {
  if (!ipcRegistered) {
    return;
  }

  ipcRegistered = false;
  ipcMain.removeHandler(IPC_CHANNELS.updateStartupSplash);
  ipcMain.removeHandler(IPC_CHANNELS.completeStartupSplash);
}

function resetStartupSplashState(): void {
  clearStartupTimers();
  splashLoaded = false;
  splashShownAt = 0;
  mainWindowReady = false;
  rendererReady = false;
  finishingStartup = false;
  startupCompletionAnimationWaitMs = 0;
  currentProgress = defaultProgress;
}

export function updateStartupSplashProgress(progress: StartupSplashProgress): void {
  publishStartupProgress(progress);
}

function publishStartupProgress(progress: StartupSplashProgress): void {
  if (currentProgress.progressPercent >= 100 && progress.progressPercent < 100) {
    return;
  }

  const nextProgressPercent = clampProgress(Math.max(currentProgress.progressPercent, progress.progressPercent));

  currentProgress = {
    ...currentProgress,
    ...progress,
    progressPercent: nextProgressPercent,
    steps: progress.steps ?? currentProgress.steps,
  };

  dispatchSplashEvent(progressEventName, currentProgress);
}

function finishStartupWhenReady(): void {
  if (startupCompleted) {
    revealMainWindow();
    return;
  }

  if (!mainWindowReady || !rendererReady || finishingStartup) {
    return;
  }

  if (splashWindow && !splashWindow.isDestroyed() && splashShownAt === 0) {
    return;
  }

  finishingStartup = true;
  const elapsedMs = splashShownAt > 0 ? Date.now() - splashShownAt : 0;
  const waitMs = Math.max(0, minimumVisibleMs - elapsedMs, startupCompletionAnimationWaitMs);

  finishTimer = setTimeout(() => {
    publishStartupProgress(currentProgress.progressPercent >= 100 ? currentProgress : {
      progressPercent: 100,
      statusText: "초기 화면 준비 완료",
      detailText: "앱 화면을 표시할 준비가 끝났습니다.",
    });
    dispatchSplashEvent(closeEventName, {});

    closeTimer = setTimeout(() => {
      startupCompleted = true;
      closeStartupSplashWindow();
      revealMainWindow();
    }, closeFadeMs);
  }, waitMs);
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!mainWindow.isMaximized()) {
    mainWindow.maximize();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function closeStartupSplashWindow(): void {
  clearStartupTimers();

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }

  splashWindow = null;
  splashLoaded = false;
}

function clearStartupTimers(): void {
  if (finishTimer !== undefined) {
    clearTimeout(finishTimer);
    finishTimer = undefined;
  }

  if (closeTimer !== undefined) {
    clearTimeout(closeTimer);
    closeTimer = undefined;
  }
}

function dispatchSplashEvent(name: string, detail: unknown): void {
  if (!splashWindow || splashWindow.isDestroyed() || !splashLoaded) {
    return;
  }

  const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, { detail: ${JSON.stringify(detail)} }));`;
  splashWindow.webContents.executeJavaScript(script).catch(() => undefined);
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
