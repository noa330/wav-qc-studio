import type { WorkspaceId } from "@shared/ipc";

export type WorkspaceOperation = "run" | "export" | "batchSpeaker" | "runtimeInstall" | "modelInstall";

const activeWorkspaceOperations = new Map<string, AbortController>();

export function registerWorkspaceOperation(workspaceId: WorkspaceId, operation: WorkspaceOperation): AbortController {
  cancelWorkspaceOperation(workspaceId, operation);
  const controller = new AbortController();
  activeWorkspaceOperations.set(operationKey(workspaceId, operation), controller);
  return controller;
}

export function unregisterWorkspaceOperation(workspaceId: WorkspaceId, operation: WorkspaceOperation, controller: AbortController): void {
  const key = operationKey(workspaceId, operation);
  if (activeWorkspaceOperations.get(key) === controller) {
    activeWorkspaceOperations.delete(key);
  }
}

export function cancelWorkspaceOperation(workspaceId: WorkspaceId, operation: WorkspaceOperation): void {
  const controller = activeWorkspaceOperations.get(operationKey(workspaceId, operation));
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
}

export function cancelAllWorkspaceOperations(): void {
  for (const controller of activeWorkspaceOperations.values()) {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }
}

function operationKey(workspaceId: WorkspaceId, operation: WorkspaceOperation): string {
  return `${workspaceId}:${operation}`;
}
