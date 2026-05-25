import type { FileTreeNode } from "@shared/ipc";
import { isAudioPath } from "./workspace-runtime-selection";

export function collectInferenceReferenceAudioNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "directory") {
      return collectInferenceReferenceAudioNodes(node.children ?? []);
    }

    return isAudioPath(node.path) ? [node] : [];
  });
}

export function toggleInferenceReferencePath(paths: string[], path: string): string[] {
  const normalizedPath = normalizeInferenceReferencePath(path);
  if (!normalizedPath) {
    return paths;
  }

  if (paths.some((item) => normalizeInferenceReferencePath(item) === normalizedPath)) {
    return paths.filter((item) => normalizeInferenceReferencePath(item) !== normalizedPath);
  }

  return [...paths, path];
}

export function setInferenceReferencePathsChecked(paths: string[], targetPaths: string[], checked: boolean): string[] {
  const targetSet = new Set(targetPaths.map(normalizeInferenceReferencePath).filter(Boolean));
  if (targetSet.size === 0) {
    return paths;
  }

  if (!checked) {
    return paths.filter((path) => !targetSet.has(normalizeInferenceReferencePath(path)));
  }

  const existingSet = new Set(paths.map(normalizeInferenceReferencePath));
  return [
    ...paths,
    ...targetPaths.filter((path) => {
      const normalizedPath = normalizeInferenceReferencePath(path);
      if (!normalizedPath || existingSet.has(normalizedPath)) {
        return false;
      }
      existingSet.add(normalizedPath);
      return true;
    }),
  ];
}

export function normalizeInferenceReferencePath(path: string): string {
  return path.trim().replace(/\\/gu, "/").toLowerCase();
}
