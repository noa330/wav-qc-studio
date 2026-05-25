import type { VoiceModelRuntimeStatus, WorkspaceId, WorkspaceSettings } from "@shared/ipc";

export type VoiceModelRuntimeKey = Pick<VoiceModelRuntimeStatus, "selectedModel" | "toolRoot" | "gptVersion" | "settingsKey">;

export function voiceModelRuntimeKeyForWorkspace(workspaceId: WorkspaceId, settings: WorkspaceSettings): VoiceModelRuntimeKey | undefined {
  if (workspaceId === "training") {
    const selectedModel = settings.training.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return {
      selectedModel,
      toolRoot: settings.training.toolRoot,
      gptVersion: selectedModel === "gpt-sovits" ? settings.training.gptVersion : undefined,
      settingsKey: [
        workspaceId,
        selectedModel,
        settings.training.toolRoot.trim(),
        selectedModel === "gpt-sovits" ? settings.training.gptVersion : "",
      ].join("|"),
    };
  }

  if (workspaceId === "inference") {
    const selectedModel = settings.inference.selectedModel === "omnivoice" ? "omnivoice" : "gpt-sovits";
    return {
      selectedModel,
      toolRoot: settings.inference.toolRoot,
      gptVersion: selectedModel === "gpt-sovits" ? settings.inference.gptVersion : undefined,
      settingsKey: [
        workspaceId,
        selectedModel,
        settings.inference.toolRoot.trim(),
        selectedModel === "gpt-sovits" ? settings.inference.gptVersion : "",
      ].join("|"),
    };
  }

  return undefined;
}

export function voiceModelRuntimeStatusMatchesKey(status: VoiceModelRuntimeStatus, key: VoiceModelRuntimeKey): boolean {
  return status.settingsKey === key.settingsKey;
}
