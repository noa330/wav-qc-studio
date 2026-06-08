import { join, relative } from "node:path";
import type { WorkspaceId } from "@shared/ipc";

const SHEETS_FOLDER = "sheets";
const AUDIO_CACHE_FOLDER = "audio-cache";
const OUTPUTS_FOLDER = "outputs";
const SHEET_STATE_FILE = "sheet-state.json";

export function resolveProjectSheetRoot(projectRoot: string | undefined, workspaceId: WorkspaceId | string, sheetId: string | undefined): string | undefined {
  const root = projectRoot?.trim();
  const workspace = sanitizePathSegment(workspaceId);
  const sheet = sanitizePathSegment(sheetId);
  return root && workspace && sheet ? join(root, SHEETS_FOLDER, workspace, sheet) : undefined;
}

export function resolveProjectSheetAudioCachePath(projectRoot: string | undefined, workspaceId: WorkspaceId, sheetId: string | undefined): string | undefined {
  const sheetRoot = resolveProjectSheetRoot(projectRoot, workspaceId, sheetId);
  return sheetRoot ? join(sheetRoot, AUDIO_CACHE_FOLDER) : undefined;
}

export function resolveProjectSheetOutputPath(projectRoot: string | undefined, workspaceId: WorkspaceId, sheetId: string | undefined, expectedLeafName: string): string | undefined {
  const sheetRoot = resolveProjectSheetRoot(projectRoot, workspaceId, sheetId);
  return sheetRoot ? join(sheetRoot, OUTPUTS_FOLDER, expectedLeafName) : undefined;
}

export function resolveProjectSheetStatePath(projectRoot: string, workspaceId: WorkspaceId | string, sheetId: string): string {
  return join(resolveProjectSheetRoot(projectRoot, workspaceId, sheetId) ?? projectRoot, SHEET_STATE_FILE);
}

export function projectRelativePath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replace(/\\/gu, "/");
}

export function sanitizePathSegment(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/gu, "_")
    .replace(/\s+/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 96);
}
