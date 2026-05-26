import { useCallback, useEffect, useState } from "react";
import type { AppUpdateState } from "@shared/ipc";
import { studioBackend } from "@/services/studio-backend";

const initialUpdateState: AppUpdateState = {
  phase: "idle",
  currentVersion: "0.0.0",
};

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(initialUpdateState);

  useEffect(() => {
    let mounted = true;
    void studioBackend.getAppUpdateState().then((nextState) => {
      if (mounted) {
        setState(nextState);
      }
    });
    const unsubscribe = studioBackend.onAppUpdateState(setState);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const check = useCallback(() => {
    void studioBackend.checkAppUpdate().then(setState);
  }, []);

  const install = useCallback(() => {
    void studioBackend.installAppUpdate().then(setState);
  }, []);

  return {
    state,
    check,
    install,
  };
}
