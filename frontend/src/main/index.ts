import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { getAppIconPath } from "./app-icon";
import { initAppUpdater } from "./app-updater";
import { registerIpcHandlers } from "./ipc/handlers";
import { attachStartupMainWindow, createStartupSplashWindow, markStartupMainWindowReady, registerStartupSplashIpc } from "./startup-splash-window";

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    title: "WAV QC Studio",
    icon: getAppIconPath(),
    backgroundColor: "#111111",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachStartupMainWindow(mainWindow);
  initAppUpdater(mainWindow.webContents);

  mainWindow.setMenuBarVisibility(false);

  ipcMain.removeAllListeners("set-menu-bar-visibility");
  ipcMain.on("set-menu-bar-visibility", (_event, visible: boolean) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.setMenuBarVisibility(visible);
    }
  });

  mainWindow.once("ready-to-show", () => {
    markStartupMainWindowReady();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  registerStartupSplashIpc();
  createStartupSplashWindow();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
