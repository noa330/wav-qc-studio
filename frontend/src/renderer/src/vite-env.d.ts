/// <reference types="vite/client" />

import type { AppInfo, StudioBackendApi } from "@shared/ipc";

declare global {
  interface Window {
    studioBackend: StudioBackendApi;
    studioShell: {
      getAppInfo: () => AppInfo;
    };
  }
}
