import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { WorkspaceId } from "@shared/ipc";

export const SLICER_OUTPUT_FOLDER = "_slicer_results";
export const TAGGING_OUTPUT_FOLDER = "_tagging_results";
export const SPEAKER_OUTPUT_FOLDER = "_spica_results";
export const OVERVIEW_OUTPUT_FOLDER = "_wav_qc_results";
export const BATCH_OUTPUT_FOLDER = "_batch_qc_results";
export const TRAINING_OUTPUT_FOLDER = "_training_results";
export const INFERENCE_OUTPUT_FOLDER = "_voice_inference_results";

export function resolveWorkspaceOutputPath(workspaceId: WorkspaceId, inputPath: string, outputPath?: string, projectRoot?: string): string {
  return outputPath || resolveDefaultOutputPath(workspaceId, inputPath, projectRoot);
}

export function outputFolderForWorkspace(workspaceId: WorkspaceId): string {
  switch (workspaceId) {
    case "slice":
      return SLICER_OUTPUT_FOLDER;
    case "tagging":
      return TAGGING_OUTPUT_FOLDER;
    case "speaker":
      return SPEAKER_OUTPUT_FOLDER;
    case "overview":
      return OVERVIEW_OUTPUT_FOLDER;
    case "batch":
      return BATCH_OUTPUT_FOLDER;
    case "training":
      return TRAINING_OUTPUT_FOLDER;
    case "inference":
      return INFERENCE_OUTPUT_FOLDER;
  }
}

export function resolveProjectOutputPath(projectRoot: string | undefined, workspaceId: WorkspaceId, expectedLeafName: string): string | undefined {
  const root = projectRoot?.trim();
  return root ? join(root, "outputs", workspaceId, expectedLeafName) : undefined;
}

export function resolveOutputDirectory(inputPath: string, requestedOutputPath: string | undefined, expectedLeafName: string, projectRoot?: string, workspaceId?: WorkspaceId): string {
  const candidate = requestedOutputPath?.trim();
  if (!candidate) {
    if (projectRoot?.trim() && workspaceId) {
      return join(projectRoot.trim(), "outputs", workspaceId, expectedLeafName);
    }

    return join(resolveFallbackInputFolder(inputPath), expectedLeafName);
  }

  const trimmed = candidate.replace(/[\\/]+$/u, "");
  return basename(trimmed).toLowerCase() === expectedLeafName.toLowerCase() ? trimmed : join(trimmed, expectedLeafName);
}

export function resolveFallbackInputFolder(inputPath: string): string {
  if (!inputPath) {
    return process.cwd();
  }

  if (!existsSync(inputPath)) {
    return process.cwd();
  }

  return extname(inputPath) ? dirname(inputPath) : inputPath;
}

function resolveDefaultOutputPath(workspaceId: WorkspaceId, inputPath: string, projectRoot?: string): string {
  const projectOutputPath = resolveProjectOutputPath(projectRoot, workspaceId, outputFolderForWorkspace(workspaceId));
  if (projectOutputPath) {
    return projectOutputPath;
  }

  switch (workspaceId) {
    case "slice":
      return join(inputPath, SLICER_OUTPUT_FOLDER);
    case "tagging":
      return join(inputPath, TAGGING_OUTPUT_FOLDER);
    case "speaker":
      return join(inputPath, SPEAKER_OUTPUT_FOLDER);
    case "overview":
      return join(inputPath, OVERVIEW_OUTPUT_FOLDER);
    case "batch":
      return join(resolveFallbackInputFolder(inputPath), BATCH_OUTPUT_FOLDER);
    case "training":
      return join(dirname(inputPath), TRAINING_OUTPUT_FOLDER);
    case "inference":
      return join(resolveFallbackInputFolder(inputPath), INFERENCE_OUTPUT_FOLDER);
  }
}
