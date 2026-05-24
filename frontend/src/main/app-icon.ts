import { app } from "electron";
import { join } from "node:path";

export function getAppIconPath(): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return join(app.getAppPath(), "build", "icon.ico");
  }

  return join(process.resourcesPath, "icon.ico");
}
